/** 终端弹窗：非交互 git / svn 命令的快捷通道。
 *
 *  **护栏在后端**（routes/terminal.ts）：只放行 git/svn、不走 shell（管道/重定向拒绝）、
 *  交互式命令拒绝、危险命令先确认、30 秒超时。这里只负责把结果讲清楚。
 *
 *  交互：
 *   - Enter 执行；↑↓ 翻历史（localStorage 持久化，与工具其他偏好一致）
 *   - **Ctrl+C 中断**执行中的命令（abort fetch → 后端 res 'close' → 杀子进程，与 pull/push 同一套）
 *   - 危险命令：后端返回 needConfirm（**尚未执行**）→ 本组件弹确认框，
 *     并附「当前 N 个文件未提交」—— 让用户知道这一下会丢什么
 */
import React, { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get, post } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { ConfirmModal } from '../ui/prompt.js';

/** 状态码配色：与文件列表里的状态徽标同一套色（M 橙 / A 绿 / D 红 / ? 灰 …） */
const STATUS_COLOR: Record<string, string> = {
  M: 'var(--warn)',
  A: 'var(--ok)',
  D: 'var(--err)',
  R: 'var(--warn)',
  C: 'var(--err)',
  U: 'var(--err)',
  '?': 'var(--dim)',
  '!': 'var(--err)',
};

/** 按行首模式给一行着色（**svn 1.10 自己不输出颜色**，只能看内容猜；git 的输出已经带 ANSI，走 renderAnsi）。
 *  规则刻意保守 —— 只认最常看的两类，误判面小：
 *   - 状态行：`M path` / ` M path`（svn status、git status --short）—— 允许前导空格，因为
 *     git 的 `XY path` 里 X（暂存区）常常是空格
 *   - diff 行：`+` / `-` / `@@`（svn diff、git diff；`+++`/`---` 是文件头，另色）
 *  其余一律原样。**代价**：某条日志里恰好出现这种行首也会被上色（概率低，属可接受）。 */
function renderLine(line: string): React.ReactNode {
  const m = /^(\s*)([MADRCU?!])(\s)/.exec(line);
  if (m) {
    return (
      <>
        {m[1]}
        <span style={{ color: STATUS_COLOR[m[2]!] }}>{m[2]}</span>
        {renderAnsi(line.slice(m[1]!.length + 1))}
      </>
    );
  }
  if (/^\+\+\+|^---/.test(line)) return <span style={{ color: 'var(--dim)' }}>{line}</span>;
  if (line.startsWith('@@')) return <span style={{ color: 'var(--accent)' }}>{line}</span>;
  if (line.startsWith('+')) return <span style={{ color: 'var(--ok)' }}>{line}</span>;
  if (line.startsWith('-')) return <span style={{ color: 'var(--err)' }}>{line}</span>;
  return renderAnsi(line);
}

/** ANSI 前景色 → 工具的主题变量（不直接用终端那套 ANSI 原色：浅色主题下会看不清） */
const ANSI_COLOR: Record<number, string> = {
  30: 'var(--dim)', 31: 'var(--err)', 32: 'var(--ok)', 33: 'var(--warn)',
  34: 'var(--accent)', 35: 'var(--purple)', 36: 'var(--accent)', 37: 'var(--text)',
  90: 'var(--dim)', 91: 'var(--err)', 92: 'var(--ok)', 93: 'var(--warn)',
  94: 'var(--accent)', 95: 'var(--purple)', 96: 'var(--accent)', 97: 'var(--text)',
};

/** 把输出里的 ANSI 序列渲染成彩色 span。
 *  **刻意只做 SGR**（`\x1b[<数字>m`）：git 输出颜色/粗体就这几种，为它引 ansi-to-html 不划算。
 *  其余 CSI 序列（如清行的 `\x1b[K`）**一律吃掉** —— 留着会在 pre 里显示成 `^[[K` 这种乱字符。 */
function renderAnsi(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  // eslint-disable-next-line no-control-regex -- 要匹配的就是 ESC(0x1b) 本身，不用控制字符没法写这个正则
  const re = /\x1b\[[0-9;]*[A-Za-z]/g; // 所有 CSI 加一个结尾字母
  let color: string | undefined;
  let bold = false;
  let last = 0;
  let key = 0;
  const push = (s: string) => {
    if (!s) return;
    out.push(
      <span key={key++} style={color || bold ? { color, fontWeight: bold ? 700 : undefined } : undefined}>
        {s}
      </span>
    );
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const seq = m[0];
    if (seq.endsWith('m')) {
      // `\x1b[m` 与 `\x1b[0m` 等价（空参数按 Number('') = 0 走重置）
      for (const code of seq.slice(2, -1).split(';').map(Number)) {
        if (!code) {
          color = undefined;
          bold = false;
        } else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 39) color = undefined;
        else if (ANSI_COLOR[code]) color = ANSI_COLOR[code];
      }
    }
    last = re.lastIndex;
  }
  push(text.slice(last));
  return out;
}

/** 一条执行记录（命令 + 它的输出） */
interface Entry {
  cmd: string;
  /** 这条命令在哪个目录跑的（相对仓库根；'' = 仓库根）。回显时当前缀，免得记录里分不清在哪跑的 */
  dir?: string;
  stdout: string;
  stderr: string;
  ok: boolean;
  /** 补充说明：被护栏拒绝的原因 / 已中断 / 超时 */
  note?: string;
  /** 被护栏拒绝（区别于"命令本身失败"）——回显时用提示色而不是错误色 */
  rejected?: boolean;
}

const HIST_KEY = 'svngit-term-history';
const HIST_MAX = 100;

function loadHistory(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]') as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 执行记录（命令 + 结果）存 **sessionStorage** —— 浏览器存储，但只活在本次会话：
 *  关标签页就没了，不会像 localStorage 那样长期堆积（用户："不要一直堆积，浏览器存储就行"）。
 *  再叠一层**服务实例校验**：服务重启后 instanceId 变了 → 旧记录作废（用户："重启服务历史消失"）。*/
const ENTRIES_KEY = 'svngit-term-entries';
const INSTANCE_KEY = 'svngit-term-instance';
/** 最多留多少条（超出的从最旧丢）——"太多就滚动"是界面的事，这里是防存储无限涨 */
const ENTRIES_MAX = 50;
/** 单条输出上限：一条 git log 就可能几十 KB */
const OUT_MAX = 4000;

function clip(s: string): string {
  // …（输出过长，仅保留前 {n} 字符）
  return s.length > OUT_MAX ? `${s.slice(0, OUT_MAX)}\n${t('term.outputTruncated', { n: OUT_MAX })}` : s;
}

/** 读本次会话的记录：服务重启过（实例标识变了）就把旧的丢掉，从头开始 */
async function loadEntries(): Promise<Entry[]> {
  let cur = '';
  try {
    cur = (await get.info()).instanceId ?? '';
  } catch {
    /* 拿不到标识就不校验 —— 宁可留着，也别误删用户刚跑出来的东西 */
  }
  if (cur) {
    if (sessionStorage.getItem(INSTANCE_KEY) !== cur) sessionStorage.removeItem(ENTRIES_KEY); // 服务重启过
    sessionStorage.setItem(INSTANCE_KEY, cur);
  }
  try {
    const a = JSON.parse(sessionStorage.getItem(ENTRIES_KEY) ?? '[]') as unknown;
    return Array.isArray(a) ? (a as Entry[]).slice(-ENTRIES_MAX) : [];
  } catch {
    return [];
  }
}

export function TerminalModal(props: {
  initialDir?: string;
  repoRoot?: string;
  /** 仓库类型（'svn' | 'git' | ''）：决定空状态示例和输入框提示给哪套命令 ——
   *  在 SVN 项目里提示 git 命令会误导（用户实报） */
  repoType?: string;
  /** 命令**真的执行过**就回调（成功/失败/超时/中断都算）——让宿主重拉界面。
   *  终端能改的东西比分支弹窗还宽（分支名 / 工作区 / 索引 / 标签），不刷界面就会一直显示旧状态
   *  （用户实报：`git branch -m master main` 跑成功，顶栏还挂着 `[master]`）。
   *  **没执行的不调**：被后端拒绝、危险命令待确认 —— 那时压根没跑，刷了是假动作。 */
  onChanged?: () => void;
  onClose: () => void;
}) {
  /** 执行目录（相对仓库根；'' = 仓库根）。初值 = 打开终端时文件浏览器停在哪（后端会做越界校验）。
   *  「回根目录」只改这个值、**不清已有记录** —— 记录是历史，跟当前在哪跑是两回事。 */
  const [cwd, setCwd] = useState(props.initialDir ?? '');
  /** 仓库目录名：路径前缀（`svn-git/src/server/routes`）。只显示相对路径的话，
   *  在根目录时写"仓库根"看不出是哪个仓库（用户要求根目录也把名字显出来）。 */
  const repoName = (props.repoRoot ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  /** 标题里显示**完整磁盘路径**（用户要求：一眼知道这仓库在本机哪里）。
   *  记录前缀仍用 `仓库名/相对路径` 的短形式 —— 完整路径太长，会把命令挤到看不见。 */
  // 仓库根
  const fullPath = props.repoRoot ? `${props.repoRoot}${cwd ? '/' + cwd : ''}` : cwd || t('term.repoRoot');
  /** 按仓库类型给示例/提示（SVN 项目里提示 git 命令会误导 —— 用户实报） */
  const isSvn = props.repoType === 'svn';
  const binName = isSvn ? 'svn' : 'git';
  const examples: [string, string][] = isSvn
    ? [
        // 看工作副本信息
        ['svn info', t('term.ex.svnInfo')],
        // 看工作区状态
        ['svn status', t('term.ex.status')],
        // 看最近 10 条提交
        ['svn log -l 10', t('term.ex.svnLog')],
      ]
    : [
        // 看最近提交
        ['git log --oneline -10', t('term.ex.gitLog')],
        // 看工作区状态
        ['git status', t('term.ex.status')],
        // git branch -m 旧名 新名 / 重命名分支
        [t('term.ex.gitRenameCmd'), t('term.ex.gitRename')],
      ];
  const [entries, setEntries] = useState<Entry[]>([]);
  // 打开时读记录（含"服务是否重启过"的校验）—— modal 每次打开都是重新挂载，跑一次就够
  useEffect(() => {
    void loadEntries().then(setEntries);
  }, []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [hIdx, setHIdx] = useState(-1); // 历史游标：-1 = 不在翻历史
  const [cfm, setCfm] = useState<{ cmd: string; reason: string; changed: number } | null>(null);
  const [cmdPreview, setCmdPreview] = useState(false); // 底部命令预览条（显示将执行的完整命令）
  const abortRef = useRef<AbortController | null>(null);
  const outRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 有新输出就滚到底（跟系统终端一致）
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Ctrl+C 中断：挂在 window 上而不是输入框上 —— 执行中如果禁用输入框就收不到按键了；
  // 而且终端的直觉是"任何时候按 Ctrl+C 都能打断"，不该取决于焦点在哪
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && abortRef.current) {
        e.preventDefault();
        abortRef.current.abort();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 追加一条记录并同步落盘（输出先截断，防一条大输出把会话存储顶爆） */
  const pushEntry = (e: Entry) => {
    const item: Entry = { ...e, stdout: clip(e.stdout), stderr: clip(e.stderr) };
    setEntries((prev) => {
      const next = [...prev, item].slice(-ENTRIES_MAX);
      try {
        sessionStorage.setItem(ENTRIES_KEY, JSON.stringify(next));
      } catch {
        // 超额：退一步只留最近 10 条再试，还不行就放弃存储（不影响本次会话使用）
        try {
          sessionStorage.setItem(ENTRIES_KEY, JSON.stringify(next.slice(-10)));
        } catch {
          /* 放弃 */
        }
      }
      return next;
    });
  };

  const saveHistory = (cmd: string) => {
    const next = [cmd, ...history.filter((h) => h !== cmd)].slice(0, HIST_MAX);
    setHistory(next);
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(next));
    } catch {
      /* 配额满等：不致命，忽略 */
    }
  };

  const runCmd = async (cmd: string, confirm = false) => {
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await post.terminalRun(cmd, cwd, confirm, ac.signal);
      if (r.error) {
        pushEntry({ cmd, dir: cwd, stdout: '', stderr: '', note: r.error, ok: false, rejected: true });
        return;
      }
      if (r.needConfirm) {
        // 后端**没有执行**：先问用户。顺手拿"当前几个文件未提交"，让后果具体化
        let changed = 0;
        try {
          const st = await get.status();
          changed = st.items.filter((f) => f.code && f.code !== ' ').length;
        } catch {
          /* 拿不到就不显示条数，不影响确认 */
        }
        // 这是危险操作
        setCfm({ cmd, reason: r.reason ?? t('term.danger.reason'), changed });
        return;
      }
      pushEntry({
        cmd,
        dir: cwd,
        stdout: r.stdout,
        stderr: r.stderr,
        ok: r.ok,
        // 已中断 / 超过 30 秒，已终止
        note: r.aborted ? t('term.noteAborted') : r.timedOut ? t('term.noteTimeout') : undefined,
      });
      props.onChanged?.(); // 失败也算跑过：命令可能已经改了工作区/index（如 add 成功、commit 失败）
    } catch (e) {
      // 中断时 api() 会把 AbortError 转成 ApiError（cancelled=true，消息随语言，见 api.ts），
      // 所以这里拿不到 AbortError —— 直接显示它的措辞，与推送/更新被取消时的提示保持一致
      pushEntry({ cmd, dir: cwd, stdout: '', stderr: '', note: (e as Error).message, ok: false });
      props.onChanged?.(); // 中断同样可能改了一半（如 git 改完文件才被 Ctrl+C）：不能还显示旧状态
    } finally {
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  const submit = () => {
    const cmd = input.trim();
    if (!cmd || busy) return;
    saveHistory(cmd);
    setInput('');
    setHIdx(-1);
    void runCmd(cmd);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      return; // Ctrl+C 由 window 上的监听统一处理（见上面的 useEffect）
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const i = Math.min(hIdx + 1, history.length - 1);
      setHIdx(i);
      setInput(history[i]!);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIdx <= 0) {
        setHIdx(-1);
        setInput('');
        return;
      }
      const i = hIdx - 1;
      setHIdx(i);
      setInput(history[i]!);
    }
  };

  return (
    <>
      <ModalShell
        title={
          <>
            {/* 终端 */}
            {t('term.title')}
            {/* 执行目录显示在标题旁（用户要求）：一眼看到命令会在哪跑 */}
            <span
              className="dim small"
              style={{ marginLeft: 10, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              · {fullPath}
            </span>
            {cwd !== '' && (
              <button
                className="mini"
                style={{ marginLeft: 10, fontWeight: 400 }}
                // 把执行目录切回仓库根（已经跑过的记录保留，只影响后面的命令）
                title={t('term.backToRootTitle')}
                onClick={() => setCwd('')}
              >
                {/* 回根目录 */}
                {t('term.backToRoot')}
              </button>
            )}
          </>
        }
        width={880}
        height={560}
        onClose={props.onClose}
        foot={
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span className="dim small">
              {/* 只支持 git / svn · Enter 执行 · ↑↓ 历史 · Ctrl+C 中断 */}
              {t('term.footHint')}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              {entries.length > 0 && (
                <button
                  // 清掉上面这些执行记录（本次会话内的）
                  title={t('term.clearTitle')}
                  onClick={() => {
                    setEntries([]);
                    try {
                      sessionStorage.removeItem(ENTRIES_KEY);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {/* 清空记录 */}
                  {t('term.clear')}
                </button>
              )}
              {/* 关闭 */}
              <button onClick={props.onClose}>{t('common.close')}</button>
            </span>
          </div>
        }
      >
        {/* 输出区 */}
        <div
          ref={outRef}
          className="mono"
          style={{
            // flex:1 + minHeight:0 —— 吃掉 .body 的剩余空间，输入行才能**始终贴底**（弹窗拉高时也是）。
            // 第一版写死 380px，拉高弹窗后输入行就悬在中间、下面空一大片（用户带截图实报）
            flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--panel)', borderRadius: 8,
            padding: '10px 12px', fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {!entries.length && (
            <div className="dim">
              {/* 输入要执行的 {bin} 命令，例如： */}
              <div>{t('term.emptyIntro', { bin: binName })}</div>
              <div style={{ margin: '12px 0' }}>
                {examples.map(([cmd, desc]) => (
                  <div key={cmd} style={{ display: 'flex', gap: 18, lineHeight: 1.9 }}>
                    <span style={{ color: 'var(--accent)', minWidth: isSvn ? 130 : 210 }}>{cmd}</span>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
              {/* 不支持管道 / 重定向 / 串联；需要交互的命令（如 git rebase -i）请用系统终端。 */}
              <div>{t('term.emptyGuard')}</div>
            </div>
          )}
          {entries.map((e, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              {/* 前缀**始终显示**（仓库名 [相对路径]，与标题栏一致）——用户要求根目录也显出来，
                  否则记录里只有相对路径、看不出是哪个仓库的；
                  前缀用暗色、命令用主题色，两者区分开（用户实报"颜色不要和命令一样"） */}
              <div style={{ color: 'var(--accent)' }}>
                <span style={{ color: 'var(--dim)' }}>
                  {/* 仓库 */}
                  {repoName || t('term.repoFallback')}
                  {e.dir ? `/${e.dir}` : ''}
                </span>{' '}
                $ {e.cmd}
              </div>
              {/* 用 trim 判"有没有内容"：有些命令成功时只吐一个空行（如根目录下的 git rev-parse --show-prefix），
                  按非空字符串判会渲染出一个空白 div、用户看不到任何反馈 */}
              {/* 逐行渲染：状态码/diff 的着色是按行首判断的（见 renderLine） */}
              {e.stdout.trim() && (
                <div style={{ color: 'var(--text)' }}>
                  {e.stdout.replace(/\n$/, '').split('\n').map((line, li) => (
                    <div key={li} style={line ? undefined : { minHeight: '1.65em' }}>{renderLine(line)}</div>
                  ))}
                </div>
              )}
              {e.stderr.trim() && <div style={{ color: 'var(--err)' }}>{renderAnsi(e.stderr.replace(/\n$/, ''))}</div>}
              {e.note && <div style={{ color: e.rejected ? 'var(--dim)' : 'var(--warn)' }}>■ {e.note}</div>}
              {/* 成功但没输出的命令（如 git branch -m）也要给个回执，否则用户不知道成没成 */}
              {!e.note && !e.stdout.trim() && !e.stderr.trim() && (
                <div style={{ color: e.ok ? 'var(--ok)' : 'var(--warn)' }}>
                  {/* ✓ 完成（无输出） / ■ 命令没有输出 */}
                  {e.ok ? t('term.doneNoOutput') : t('term.noOutput')}
                </div>
              )}
            </div>
          ))}
          {/* …执行中（Ctrl+C 可中断） */}
          {busy && <div className="dim">{t('term.running')}</div>}
        </div>

        {/* 输入行 */}
        <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ color: 'var(--accent)', flexShrink: 0 }}>$</span>
          {/* type="text" 必须有：全局输入框样式挂在 input[type=text] 上，不写这属性就吃不到
              （第一版漏了，落成浏览器默认样子，又小又土 —— 用户实报"又丑又小"） */}
          <input
            ref={inputRef}
            type="text"
            className="mono"
            style={{ flex: 1 }}
            placeholder={isSvn ? 'svn info' : 'git log --oneline -10'}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (cmdPreview) setCmdPreview(false);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setCmdPreview(true)}
            onBlur={() => setCmdPreview(false)}
          />
          <button className="primary" disabled={busy || !input.trim()} onClick={submit}>
            {/* 执行 */}
            {t('term.run')}
          </button>
        </div>
        {/* 命令预览（教学/透明层，与工具栏确认框的 confirmCmd 同一思路）：让人看清"回车后会真正执行什么" */}
        {cmdPreview && input.trim() && (
          <div className="dim small mono" style={{ marginTop: 6 }}>
            {/* 将执行： */}
            {t('term.preview')}
            {input.trim().split(/\s+/)[0] === 'git' ? 'git --no-pager ' : 'svn --non-interactive '}
            {input.trim().replace(/^\S+\s*/, '')}
          </div>
        )}
      </ModalShell>

      {cfm && (
        <ConfirmModal
          // ⚠ 危险命令
          title={t('term.danger.title')}
          danger
          // 仍要执行
          confirmLabel={t('term.danger.confirm')}
          width={520}
          message={
            <>
              <div style={{ marginBottom: 8 }}>{cfm.reason}</div>
              <div className="dim small">
                {/* 当前有 {n} 个文件未提交。 / 当前工作区没有未提交的改动。 */}
                {cfm.changed > 0 ? t('term.danger.changed', { n: cfm.changed }) : t('term.danger.clean')}
              </div>
            </>
          }
          confirmCmd={cfm.cmd}
          onConfirm={() => {
            const c = cfm;
            setCfm(null);
            void runCmd(c.cmd, true); // 用户确认过，带 confirm 重发
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </>
  );
}
