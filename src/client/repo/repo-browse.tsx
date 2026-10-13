/** SVN 仓库浏览弹窗（不 checkout 直接看远程，Tortoise Repo-Browser 的角色）：
 *  左=**文件树**（可折叠展开、懒加载——第一次展开才拉子项）；右=文件预览（cat，按扩展名语法高亮）
 *  +「复制」「下载到…」；左右宽度可拖动调整（沿用并排对比的 sb-resizer 模式）。
 *  浏览器自身对远程只读（没有任何写远程的入口）；唯一会写磁盘的是右键「检出到本地…」
 *  （目录行 + 空白 = 仓库根；文件行不给）→ 走 CheckoutDialog → 后端 URL 直连检出。
 *  cat 内容超过 2MB 由后端拒绝（提示用下载）。
 *  入口：最近项目里 SVN 项目右键「浏览仓库」（app 用 repo-root 接口取仓库根 URL 后打开）。 */
import React, { useEffect, useRef, useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { get, post } from '../shared/api.js';
import { langOf, highlightLine } from '../shared/highlight.js';
import { MiniIcon, IconServer } from '../ui/icons.js';
import { ContextMenu } from '../ui/context-menu.js';
import { PickDirModal } from './pick-dir.js';
import { CheckoutDialog } from './checkout.js';
import { ResultLine } from '../ui/result-line.js';
import { t } from '../../shared/i18n/index.js';

interface RepoEntry {
  name: string;
  isDir: boolean;
  size?: number;
  rev?: string;
  author?: string;
  date?: string;
}

/** 字节 → 人类可读（文件列表右列） */
function fmtSize(n?: number): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function RepoBrowseModal(props: {
  url: string;
  wcRel?: string;
  onClose: () => void;
  /** 右键检出的工作副本「打开项目」（modal-host 接 openHistoryItem，先关本弹窗） */
  onOpenProject?: (dir: string) => void;
}) {
  const root = props.url.replace(/\/+$/, '');
  // ——树状态：已加载的子项（root 也在里面；'loading' = 正在拉）+ 展开集合 + 各自的错误
  const [kids, setKids] = useState<Record<string, RepoEntry[] | 'loading'>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState('');
  /** 二进制文件（后端判定）：不渲染内容、显示"请下载后再浏览"，且不给「复制」 */
  const [fileBin, setFileBin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [maxed, setMaxed] = useState(false);
  // 树右键菜单（目录行 + 空白 = 仓库根；文件行不给）与「检出到本地」弹窗
  const [menu, setMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [checkout, setCheckout] = useState<{ url: string } | null>(null);
  // 「定位到该项目」（用户定稿 A：只高亮不深入）：located=高亮的目录 url；locating=防连点
  const [located, setLocated] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // kids 的 ref 镜像：locate 的异步循环里要读"最新已加载状态"（闭包里的 state 会陈旧）
  const kidsRef = useRef<Record<string, RepoEntry[] | 'loading'>>({});
  // 左右宽度（%）：可拖动（容器基准，防弹窗不全屏时比例失真）
  const [leftRatio, setLeftRatio] = useState(45);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startRatio: number; width: number } | null>(null);

  /** 拉某个目录的子项（懒加载：展开才调；重复调用直接返回） */
  const loadDir = (dirUrl: string) => {
    setKids((k) => {
      if (k[dirUrl]) return k;
      return { ...k, [dirUrl]: 'loading' };
    });
    get
      .repoList(dirUrl)
      .then((r) => {
        if (r.ok) {
          setKids((k) => ({ ...k, [dirUrl]: r.entries ?? [] }));
          return;
        }
        setKids((k) => {
          const n = { ...k };
          delete n[dirUrl];
          return n;
        });
        setErrs((e) => ({ ...e, [dirUrl]: r.error ?? '' }));
      })
      .catch((e: Error) => {
        setKids((k) => {
          const n = { ...k };
          delete n[dirUrl];
          return n;
        });
        setErrs((e2) => ({ ...e2, [dirUrl]: e.message }));
      });
  };

  // 打开即拉仓库根目录（重复调用由 loadDir 内部的 kids 缓存挡住）
  useEffect(() => {
    loadDir(root);
  }, [root]);

  // 选中文件 → cat（二进制文件后端带 binary 标记：不渲染乱码内容，提示下载）
  useEffect(() => {
    if (!file) {
      setText(null);
      setFileErr('');
      setFileBin(false);
      return;
    }
    let alive = true;
    setText(null);
    setFileErr('');
    setFileBin(false);
    get
      .repoCat(file.url)
      .then((r) => {
        if (!alive) return;
        if (r.binary) setFileBin(true);
        else if (r.ok) setText(r.text ?? '');
        else setFileErr(r.error ?? '');
      })
      .catch((e: Error) => alive && setFileErr(e.message));
    return () => {
      alive = false;
    };
  }, [file]);

  const toggleDir = (dirUrl: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(dirUrl)) n.delete(dirUrl);
      else {
        n.add(dirUrl);
        loadDir(dirUrl); // 首次展开才拉（已在缓存里的会被 loadDir 直接挡掉）
      }
      return n;
    });
  };

  // kids 的实况镜像（locate 的异步循环里读最新；state 闭包会陈旧）
  kidsRef.current = kids;

  /** 确保某目录已加载（已加载立即返回 true；否则拉取，失败记到该目录的 errs） */
  const ensureKids = async (dirUrl: string): Promise<boolean> => {
    if (Array.isArray(kidsRef.current[dirUrl])) return true;
    try {
      const r = await get.repoList(dirUrl);
      if (!r.ok) {
        setErrs((e) => ({ ...e, [dirUrl]: r.error ?? '' }));
        return false;
      }
      setKids((k) => ({ ...k, [dirUrl]: r.entries ?? [] }));
      return true;
    } catch (e) {
      setErrs((es) => ({ ...es, [dirUrl]: (e as Error).message }));
      return false;
    }
  };

  /** 定位到该项目（用户定稿 A：只高亮不深入）：按工作副本相对路径逐级展开树，
   *  到达后高亮 + 滚动居中（树深时目标可能在视口外）；中途某级读取失败就停在已展开处并提示。 */
  const locate = async () => {
    const segs = (props.wcRel ?? '').split('/').filter(Boolean);
    if (segs.length === 0 || locating) return;
    setLocating(true);
    setMsg('');
    try {
      let cur = root;
      const toExpand: string[] = [];
      for (const s of segs) {
        const ok = await ensureKids(cur);
        if (!ok) {
          // 定位失败（{s} 读取不到，可能无权限）
          setMsg(t('repo.browse.locateFail', { s }));
          setMsgErr(true);
          break;
        }
        cur = `${cur}/${s}`;
        toExpand.push(cur);
      }
      if (toExpand.length > 0) {
        setExpanded((prev) => new Set([...prev, ...toExpand]));
        setLocated(cur);
        // 等树渲染完再滚动居中（350ms 覆盖一帧渲染）
        window.setTimeout(() => {
          document.querySelector(`.repo-row[data-url="${CSS.escape(cur)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 350);
      }
    } finally {
      setLocating(false);
    }
  };

  // 左右拖拽（同并排对比的 sb-resizer 模式；delta 以弹窗内容宽为基准）
  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startRatio: leftRatio,
      width: bodyRef.current?.clientWidth ?? window.innerWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const pct = ((e.clientX - d.startX) / d.width) * 100;
      setLeftRatio(Math.min(75, Math.max(20, d.startRatio + pct)));
    };
    const up = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  /** 面包屑：仓库根之后逐级（可点回跳） */
  const host = root.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? root;

  // 扁平化可见行：根列表 + 每个"展开目录"的子项续排（树渲染的输入；规模小，每轮重建无压力）
  const rows: { e: RepoEntry; url: string; depth: number }[] = [];
  const walk = (dirUrl: string, depth: number) => {
    const list = kids[dirUrl];
    if (!Array.isArray(list)) return;
    for (const e of list) {
      const u = `${dirUrl}/${e.name}`;
      rows.push({ e, url: u, depth });
      if (e.isDir && expanded.has(u)) walk(u, depth + 1);
    }
  };
  walk(root, 0);
  const rootLoading = kids[root] === 'loading';
  const rootErr = errs[root];

  return (
    <div className="modal-mask">
      <ResizableModal width={1130} height={500} maxed={maxed} onToggleMax={() => setMaxed((m) => !m)}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 仓库浏览（IconServer：远程仓库在服务器上） */}
          <span style={{ flex: 1 }}>
            <IconServer size={15} /> {t('repo.browse.title')} <span className="dim small mono">{host}</span>
            {/* 定位到该项目：逐级展开树并高亮工作副本所在目录（只在从项目右键进入时有 wcRel） */}
            {!!props.wcRel && (
              <button
                className="mini"
                style={{ marginLeft: 8 }}
                disabled={locating}
                title={t('repo.browse.locateTip')}
                onClick={() => void locate()}
              >
                {locating ? t('repo.browse.locating') : `📍 ${t('repo.browse.locate')}`}
              </button>
            )}
          </span>
          <button className="mini" onClick={() => setMaxed((m) => !m)}>
            {/* 还原窗口 / 最大化 */}
            {maxed ? '🗗' : '⛶'}
          </button>
          {/* 关闭 */}
          <button className="mini danger" onClick={props.onClose}>✕</button>
        </h3>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* 主区：左树 / 可拖分隔（比并排对比的 6px 更窄，用户定稿）/ 右预览。
              面包屑已去掉（树本身表达层级；用户定稿） */}
          <div ref={bodyRef} style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div
              className="vcs-list repo-list"
              style={{ flex: `0 0 ${leftRatio}%`, minWidth: 0 }}
              // 空白处右键 = 仓库根（行内已 stopPropagation，不会冒到这里）
              onContextMenu={(ev) => {
                ev.preventDefault();
                setMenu({ x: ev.clientX, y: ev.clientY, url: root });
              }}
            >
              {rootLoading && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>}
              {rootErr && <div className="error small" style={{ padding: '10px 6px', wordBreak: 'break-all' }}>{rootErr}</div>}
              {/* 这个目录是空的 */}
              {Array.isArray(kids[root]) && kids[root].length === 0 && (
                <div className="dim small" style={{ padding: '10px 6px' }}>{t('repo.browse.empty')}</div>
              )}
              {rows.map(({ e, url, depth }) => {
                const active = file?.url === url || located === url;
                const open = e.isDir && expanded.has(url);
                const busy = e.isDir && kids[url] === 'loading';
                const subErr = e.isDir && open ? errs[url] : undefined;
                return (
                  <React.Fragment key={url}>
                    <div
                      className={`changed-row repo-row${active ? ' active' : ''}`}
                      data-url={url}
                      style={{ cursor: 'pointer', paddingLeft: 4 + depth * 14 }}
                      // 单击展开 / 收起 / 单击预览
                      title={`${e.name}\n${t(e.isDir ? 'repo.browse.clickDir' : 'repo.browse.clickFile')}`}
                      onClick={() => (e.isDir ? toggleDir(url) : setFile({ name: e.name, url }))}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        // 文件行不给菜单（检出只对目录/仓库根有意义，不弹浏览器原生菜单）；
                        // 目录行右键 → 「检出到本地…」（该目录 URL）
                        if (e.isDir) setMenu({ x: ev.clientX, y: ev.clientY, url });
                      }}
                    >
                      <span className="repo-arrow">{e.isDir ? (busy ? '…' : open ? '▾' : '▸') : ''}</span>
                      <MiniIcon isDir={e.isDir} name={e.name} />
                      <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.name}
                      </span>
                      <span className="dim small nowrap" style={{ flexShrink: 0, width: 60, textAlign: 'right' }}>{fmtSize(e.size)}</span>
                      <span className="dim small nowrap" style={{ flexShrink: 0, width: 70 }} title={`${e.author ?? ''} ${e.date?.slice(0, 10) ?? ''}`}>
                        {e.rev ? `r${e.rev}` : ''}
                      </span>
                    </div>
                    {/* 展开失败：该目录下就地报错（如无权限） */}
                    {subErr && (
                      <div className="error small" style={{ padding: `2px 6px 4px ${20 + depth * 14}px`, wordBreak: 'break-all' }}>{subErr}</div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            {/* 可拖分隔（并排对比同款；宽度收窄为 4px——用户定稿"再小点"） */}
            <div className="sb-resizer" style={{ width: 4 }} onMouseDown={startDrag} title={t('repo.browse.dragTip')} />
            {/* 预览区 */}
            <div className="vcs-list" style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
              {!file && <div className="dim small" style={{ padding: '10px 6px' }}>{t('repo.browse.pickFile')}</div>}
              {/* 选中文件即出文件名行（复制/下载按钮立即可用——loading/出错/二进制时下载都需要） */}
              {file && (
                <>
                  <div className="row" style={{ padding: '4px 6px', borderBottom: '1px solid var(--border2)', marginBottom: 6, gap: 8 }}>
                    <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                    {/* 「复制」只有文本预览才给——二进制"不支持浏览"没有可复制的内容（用户定稿） */}
                    {text !== null && (
                      <button
                        className="mini"
                        onClick={() => {
                          void navigator.clipboard?.writeText(text).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          });
                        }}
                      >
                        {/* 已复制 / 复制 */}
                        {copied ? t('fs.pv.copied') : t('fs.pv.copyCode')}
                      </button>
                    )}
                    {/* 下载到…（文件太大/二进制提示"请下载"时就在旁边，用户实报曾找不到） */}
                    <button className="mini" onClick={() => setPicker(true)}>{t('repo.browse.saveTo')}</button>
                  </div>
                  {fileBin ? (
                    // 不支持浏览，请下载后再浏览
                    <div className="small" style={{ padding: '10px 6px', color: 'var(--warn)' }}>⚠ {t('repo.browse.binary')}</div>
                  ) : fileErr ? (
                    <div className="error small" style={{ padding: '2px 6px', wordBreak: 'break-all' }}>{fileErr}</div>
                  ) : text === null ? (
                    <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>
                  ) : (
                    <pre className="mono" style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                      {text.split('\n').map((l, i) => (
                        <div key={i} dangerouslySetInnerHTML={{ __html: highlightLine(l, langOf(file.name)) || '&nbsp;' }} />
                      ))}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
          <div style={{ flexShrink: 0, marginTop: 6 }}>
            <ResultLine msg={msg} err={msgErr} />
          </div>
        </div>
      </ResizableModal>
      {/* 下载目录选择（同名文件由后端拒绝，不覆盖）——与「打开项目」共用的目录浏览器（pick 模式） */}
      {picker && file && (
        <PickDirModal
          // 📂 下载到…
          title={t('repo.browse.saveTo')}
          startDir=""
          onPick={(p) => {
            setPicker(false);
            void post.repoSave(file.url, p).then((r) => {
              setMsg(r.ok ? t('repo.browse.saved', { path: r.path ?? '' }) : r.error ?? '');
              setMsgErr(!r.ok);
            });
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {/* 树右键菜单：目录行 / 空白（= 仓库根）→「检出到本地…」 */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          onClose={() => setMenu(null)}
          items={[
            {
              icon: '⬇',
              // 检出到本地…
              label: t('repo.co.menu'),
              action: () => setCheckout({ url: menu.url }),
            },
          ]}
        />
      )}
      {/* 检出到本地（URL 直连检出；认证失败弹凭据框重试） */}
      {checkout && (
        <CheckoutDialog url={checkout.url} onClose={() => setCheckout(null)} onOpenProject={props.onOpenProject} />
      )}
    </div>
  );
}
