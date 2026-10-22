/** 项目迁移面板（SVN）：把当前工作副本独立成一个平级项目（自带 trunk/branches/tags）。
 *  「独立开发线」入口已下线：那等同于「新建分支 → 从当前目录复制」，统一到新建分支里做。 */
import React, { useEffect, useRef, useState } from 'react';
import type { BranchInfo } from '../../shared/api.js';
import { get, post } from '../../shared/api.js';
import { ConfirmModal } from '../../ui/prompt.js';
import { CommandPreview } from '../../ui/command-preview.js';
import { ModalShell } from '../../shell/modal-shell.js';
import { useTasks } from '../../shared/tasks.js';
import { startTaskDeferred } from '../../shell/bg-defer.js';
import { isImeComposing } from '../../shared/utils.js';
import { launchMagicFlight } from '../../animations/index.js';
import { t } from '../../../shared/i18n/index.js';
import { currentLabelOf } from './branch-shared.js';

export function ProjectMigratePanel(props: {
  data: BranchInfo;
  /** 当前工作副本本地根：预览要复制的一级内容（只读列举，不递归） */
  workDir: string;
  onClose: () => void;
  /** 结果写回容器的底部结果行 */
  onResult: (msg: string, err: boolean) => void;
  /** 迁移成功：刷新分支列表/工作区 */
  onChanged: () => void;
  /** 超过 3 秒转后台：收起弹窗、飞线、轻提示（由容器统一处理） */
  onBackground: (title: string, from?: DOMRect) => void;
}) {
  const { data } = props;
  const [name, setName] = useState(data.current || '');
  /** 内容放到 trunk 下的子目录（空 = trunk 根）与 trunk 下额外创建的空目录 */
  const [subPathInput, setSubPathInput] = useState('');
  const [extras, setExtras] = useState<Set<string>>(new Set());
  const STANDARD_EXTRAS = ['doc', 'package', 'ThirdPart'];
  const [switchAfter, setSwitchAfter] = useState(true);
  const [cfm, setCfm] = useState<{ cmd: string; confirmLabel: string; action: () => void } | null>(null);
  const fromRef = useRef<DOMRect | null>(null);
  const bgTasks = useTasks();
  const busy = bgTasks.some((tk) => tk.kind === 'branch' && tk.status === 'running');
  /** 当前工作副本根目录的一级内容（预览用；读取失败静默，不影响迁移） */
  const [rootEntries, setRootEntries] = useState<{ name: string; isDir: boolean }[]>([]);  useEffect(() => {
    const dir = props.workDir.trim();
    if (!dir) return;
    let alive = true;
    get
      .browse(dir)
      .then((r) => {
        if (alive) setRootEntries(r.entries.filter((e) => e.name !== '..'));
      })
      .catch(() => {
        if (alive) setRootEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [props.workDir]);

  /** 目标路径预览：与原项目平级的 <name>/trunk */
  const trimmedName = name.trim();
  const rootUrl = data.projectRoot ?? '';
  const newRoot = rootUrl && trimmedName ? `${rootUrl.replace(/\/[^/]+$/, '')}/${trimmedName}` : '';
  const target = newRoot ? `${newRoot}/trunk` : '';
  /** 内容子目录（规整掉首尾斜杠）与勾选的附加目录 */
  const sub = subPathInput.trim().replace(/^\/+|\/+$/g, '');
  const extrasArr = STANDARD_EXTRAS.filter((d) => extras.has(d));
  const contentTarget = newRoot ? (sub ? `${newRoot}/trunk/${sub}` : `${newRoot}/trunk`) : '';
  /** 自动识别：当前工作副本根是否**本身已是标准结构**（含 src，或标准目录 ≥2 个）。
   *  是 → 整体复制到 trunk 根即可；再套 src / 建同名目录只会得到 trunk/src/src 这类重复层级。 */
  const rootDirs = rootEntries.filter((e) => e.isDir).map((e) => e.name);
  const standardPresent = ['src', ...STANDARD_EXTRAS].filter((d) => rootDirs.includes(d));
  const isStandardStructure = rootDirs.includes('src') || standardPresent.length >= 2;
  /** 迁移后结构预览（trunk 下的内容子目录 + 附加目录） */
  const parentName = newRoot ? (newRoot.replace(/\/[^/]+$/, '').split('/').pop() ?? '') : '';
  /** 内容行下方列出的一级条目：目录（最多 8 个）+ 文件/剩余项概括 */
  const contentPreviewLines = (() => {
    if (rootEntries.length === 0) return [];
    const dirs = rootEntries.filter((e) => e.isDir).map((e) => e.name);
    const fileCount = rootEntries.length - dirs.length;
    const shown = dirs.slice(0, 8);
    const lines = shown.map((n) => `${n}/`);
    const more = dirs.length - shown.length + fileCount;
    if (more > 0) lines.push(t('ops.branch.migrateTreeMore', { n: more }));
    return lines;
  })();
  const migrateTree = (() => {
    if (!trimmedName || !parentName) return '';
    const contentLabel = t('ops.branch.migrateTreeTrunk');
    type Child = { label: string; note?: string; kids?: string[] };
    const trunkChildren: Child[] = [];
    if (sub) {
      // 内容放 trunk/src：一级条目列在 src 下面
      trunkChildren.push({ label: `${sub}/`, note: contentLabel, kids: contentPreviewLines });
    } else {
      // 内容直接放 trunk 根：一级条目与附加目录并列
      for (const l of contentPreviewLines) trunkChildren.push({ label: l });
    }
    for (const d of extrasArr) trunkChildren.push({ label: `${d}/` });
    const lines = [`${parentName}/${trimmedName}/`];
    lines.push(sub ? `├── trunk/` : `├── trunk/      ← ${contentLabel}`);
    trunkChildren.forEach((c, i) => {
      const last = i === trunkChildren.length - 1;
      lines.push(`│   ${last ? '└──' : '├──'} ${c.label}${c.note ? `      ← ${c.note}` : ''}`);
      const kids = c.kids ?? [];
      if (kids.length > 0) {
        const pad = last ? '│       ' : '│   │   ';
        kids.forEach((k, j) => lines.push(`${pad}${j === kids.length - 1 ? '└──' : '├──'} ${k}`));
      }
    });
    lines.push(`├── branches/`);
    lines.push(`└── tags/`);
    return lines.join('\n');
  })();
  /** 本次迁移会执行的全部命令（含勾选切换时的 svn switch）——面板与确认框共用。
   *  显示用 ^/ 简写 + ①②③ 序号（避免完整 URL 折成一坨）；悬浮每条看完整命令。 */
  const reposRoot = (data.reposRootUrl ?? '').replace(/\/+$/, '');
  /** 提交信息里的来源：相对版本库根的完整路径（projects/CWBS-SCA/tags/SCA_HB），
   *  只写 tags/SCA_HB 看不出属于哪个项目 */
  const fromRel =
    reposRoot && data.currentUrl?.startsWith(reposRoot)
      ? data.currentUrl.slice(reposRoot.length).replace(/^\/+/, '')
      : currentLabelOf(data) || data.current || '';
  const shortUrl = (url: string) => (reposRoot && url.startsWith(reposRoot) ? `^${url.slice(reposRoot.length)}` : url);
  const migrateCmds = (() => {
    if (!trimmedName || !newRoot) return { short: [], full: [], confirm: [] };
    // 骨架顺序与后端一致：sub 非空时先建 trunk 与附加目录；sub 为空时附加目录要等 copy 之后
    const build = (urlOf: (u: string) => string) => {
      const skeleton = [`${newRoot}/branches`, `${newRoot}/tags`];
      if (sub) {
        skeleton.push(`${newRoot}/trunk`);
        for (const d of extrasArr) skeleton.push(`${newRoot}/trunk/${d}`);
      }
      const cmds = [
        `svn mkdir --parents ${skeleton.map(urlOf).join(' ')} -m "${t('vcs.commitMsg.migrateProjectSkeleton', { name: trimmedName })}"`,
        `svn copy ${urlOf(data.currentUrl ?? '')} ${urlOf(contentTarget)} -m "${t('vcs.commitMsg.migrateProject', { name: trimmedName, from: fromRel })}"`,
      ];
      if (!sub && extrasArr.length > 0) {
        cmds.push(
          `svn mkdir --parents ${extrasArr.map((d) => urlOf(`${newRoot}/trunk/${d}`)).join(' ')} -m "${t('vcs.commitMsg.migrateProjectSkeletonExtra', { name: trimmedName })}"`,
        );
      }
      if (switchAfter) cmds.push(`svn switch ${urlOf(`${newRoot}/trunk`)}`);
      return cmds;
    };
    const ordinal = (i: number) => `${'①②③④⑤⑥⑦⑧⑨'[i] ?? `${i + 1}.`} `;
    const full = build((u) => u);
    // short/full 不含序号（CommandPreview 负责 ①②③）；confirm 保留序号给确认框
    return { short: build(shortUrl), full, confirm: full.map((c, i) => ordinal(i) + c) };
  })();

  const runMigrate = (n: string) => {
    const title = t('shell.tasks.projectMigrate', { name: n });
    const from = fromRef.current ?? undefined;
    fromRef.current = null;
    // 与「更新」一致：点击确认当下就飞线（任务再快也能看到反馈）；
    // 转后台时只收弹窗 + 轻提示，不再重复飞
    if (from) launchMagicFlight(from);
    // 阶段进度通道：任务详情/面板按它轮询「骨架 → 复制 → 切换」
    const chan = newRoot || `migrate:${n}`;
    startTaskDeferred({
      kind: 'branch',
      title,
      chan,
      run: async (signal) => {
        const r = await post.projectMigrate('project', n, switchAfter, signal, sub || undefined, extrasArr.length ? extrasArr : undefined, chan);
        props.onResult(r.message, !r.ok);
        if (r.ok) {
          props.onClose();
          props.onChanged();
        }
        return { ok: r.ok, message: r.message };
      },
      // 飞线已在点确认时飞过，转后台只收弹窗 + 提示
      onSlow: () => props.onBackground(title),
    });
  };

  /** 迁移确认：列出将执行的全部 SVN 命令（含切换） */
  const confirmMigrate = () => {
    if (!trimmedName || !newRoot) return;
    setCfm({ cmd: migrateCmds.confirm.join('\n'), confirmLabel: t('ops.branch.migrateRun'), action: () => runMigrate(trimmedName) });
  };

  return (
    <>
      <ModalShell
        // 项目迁移
        title={t('ops.branch.migrateTitle')}
        width={680}
        onClose={props.onClose}
        foot={
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <button onClick={props.onClose}>{t('common.cancel')}</button>
            <button className="primary" disabled={busy || !name.trim()} onClick={confirmMigrate}>
              {/* 开始迁移 */}
              {t('ops.branch.migrateRun')}
            </button>
          </div>
        }
      >
        {/* 把当前工作副本独立成一个平级项目（自带 trunk/branches/tags）。 */}
        <div className="small dim" style={{ margin: '6px 0' }}>{t('ops.branch.migrateIntro')}</div>
        <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
          {/* 来源：{url} */}
          {t('ops.branch.migrateSource', { url: data.currentUrl ?? '' })}
        </div>
        <div style={{ margin: '8px 0 2px' }}>
          <strong>{t('ops.branch.migrateProjectTitle')}</strong>
          <span className="small dim" style={{ display: 'block' }}>{t('ops.branch.migrateProjectDesc')}</span>
        </div>
        {/* 想基于当前分支再开一条分支？请用「新建分支」（从当前目录复制），与本面板的“独立项目”不同。 */}
        <div className="small" style={{ color: 'var(--accent)', margin: '4px 0' }}>{t('ops.branch.migrateBranchTip')}</div>
        <div className="row" style={{ gap: 6, margin: '8px 0 4px' }}>
          {/* 新名称 */}
          <span className="small">{t('ops.branch.migrateNameLabel')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter' && name.trim()) confirmMigrate();
            }}
            style={{ flex: 1 }}
          />
        </div>
        {/* 内容放到 trunk 下（可选）：留空 = trunk 根；填 src 则生成 trunk/src 结构 */}
        <div className="row" style={{ gap: 6, margin: '4px 0', alignItems: 'center' }}>
          <span className="small">{t('ops.branch.migrateSubPathLabel')}</span>
          <input
            type="text"
            value={subPathInput}
            onChange={(e) => setSubPathInput(e.target.value)}
            placeholder={t('ops.branch.migrateSubPathPlaceholder')}
            style={{ flex: 1 }}
          />
          {/* 一键套用标准结构：内容放 src，并创建 doc/package/ThirdPart。
              当前工作副本本身已是标准结构时禁用——再套 src 会得到 trunk/src/src */}
          <button
            className="mini"
            disabled={isStandardStructure}
            title={isStandardStructure ? t('ops.branch.migrateStandardAlready') : t('ops.branch.migrateStdStructureTip')}
            onClick={() => {
              if (isStandardStructure) return;
              setSubPathInput('src');
              setExtras(new Set(STANDARD_EXTRAS));
            }}
          >
            {t('ops.branch.migrateStdStructure')}
          </button>
        </div>
        {isStandardStructure && (
          <div className="small" style={{ color: 'var(--accent)', margin: '2px 0' }}>
            {/* 已检测到当前工作副本已是标准结构（含 {dirs}），将整体复制到 trunk 根。 */}
            {t('ops.branch.migrateStandardDetected', { dirs: standardPresent.join(' / ') })}
          </div>
        )}
        {isStandardStructure && (sub || extrasArr.length > 0) && (
          <div className="small" style={{ color: 'var(--warn)', margin: '2px 0' }}>
            {/* 当前目录已含同名结构，继续套用可能生成 trunk/src/src 或重复的 doc/package 目录。 */}
            {t('ops.branch.migrateStandardConflict')}
          </div>
        )}
        {/* 同时创建目录：trunk 下的空目录（doc/package/ThirdPart） */}
        <div className="row small" style={{ gap: 12, margin: '4px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{t('ops.branch.migrateExtrasLabel')}</span>
          {STANDARD_EXTRAS.map((d) => (
            <label key={d} className="row" style={{ alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={extras.has(d)}
                onChange={(e) =>
                  setExtras((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(d);
                    else next.delete(d);
                    return next;
                  })
                }
              />
              <span>{d}</span>
            </label>
          ))}
        </div>
        <div className="small" style={{ wordBreak: 'break-all' }}>
          {/* 目标路径：{target} */}
          {t('ops.branch.migrateTarget', { target: target || '…' })}
        </div>
        {migrateTree && (
          <>
            {/* 迁移后结构 */}
            <div className="small" style={{ marginTop: 8 }}>{t('ops.branch.migrateTreeTitle')}</div>
            <pre className="mono small" style={{ margin: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--dim)' }}>{migrateTree}</pre>
          </>
        )}
        <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
          <input type="checkbox" checked={switchAfter} onChange={(e) => setSwitchAfter(e.target.checked)} />
          {/* 迁移完成后把当前工作副本切换过去 */}
          {t('ops.branch.migrateSwitch')}
        </label>
        {migrateCmds.short.length > 0 && (
          <CommandPreview
            commands={migrateCmds.short}
            fullCommands={migrateCmds.full}
            marker="circled"
            compact
          />
        )}
      </ModalShell>
      {cfm && (
        <ConfirmModal
          // 项目迁移
          title={t('ops.branch.migrateTitle')}
          message={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, whiteSpace: 'normal' }}>
              <div>{t('ops.branch.migrateProjectConfirm', { name: name.trim() })}</div>
              <pre className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{cfm.cmd}</pre>
              {switchAfter && <div className="dim small">{t('ops.branch.migrateSwitchNote')}</div>}
            </div>
          }
          confirmLabel={cfm.confirmLabel}
          onConfirm={(e) => {
            fromRef.current = e.currentTarget.getBoundingClientRect();
            const action = cfm.action;
            setCfm(null);
            action();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </>
  );
}
