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
import { isImeComposing } from '../shared/utils.js';
import { langOf, highlightLine } from '../shared/highlight.js';
import { renderMarkdown } from '../shared/markdown.js';
import { loadMdTheme, mdThemeVars } from '../shared/md-theme.js';
import { highlightMatch } from '../shared/highlight-match.js';
import { MiniIcon, IconServer, IconPin } from '../ui/icons.js';
import { ContextMenu } from '../ui/context-menu.js';
import { PickDirModal } from './pick-dir.js';
import { CheckoutDialog } from './checkout.js';
import { useCheckoutTask, CheckoutAuthModal } from './checkout-task.js';
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
  /** 检出完成收录进「最近项目」后通知刷新侧栏列表（传刚检出的路径——完成动画据此定位目标项） */
  onHistoryAdded?: (dir: string) => void;
  /** 统一提示入口（检出转后台任务后，"已在后台运行"这类提示不再有弹窗可承载） */
  onToast?: (m: string, err?: boolean) => void;
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
  /** md 文件：预览（渲染版，同主界面）↔ 源码——换文件自动回源码 */
  const [mdPreview, setMdPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [maxed, setMaxed] = useState(false);
  // 树右键菜单（目录行 + 空白 = 仓库根；文件行不给）与「检出到本地」弹窗
  const [menu, setMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [checkout, setCheckout] = useState<{ url: string } | null>(null);
  /** 检出：后台任务发起器 + 认证失败凭据框（实现在 checkout-task，弹窗一关就靠它接管） */
  const onToast = (m: string, err?: boolean) => props.onToast?.(m, err);
  const { start: startCheckout, auth: checkoutAuth, closeAuth: closeCheckoutAuth } = useCheckoutTask({
    // 检出完成**不切换当前项目**（用户定稿：不打扰正在做的事）——只收录进「最近项目」列表
    // （显示上排在当前项目之后）；想打开时从列表里点开
    onCreated: (dir) => {
      void post
        .history(dir, 'svn')
        .then(() => props.onHistoryAdded?.(dir))
        .catch(() => {
          /* 收录失败不打扰（工作副本本身已检出成功） */
        });
    },
    onToast,
  });
  // 「定位到该项目」（用户定稿 A）：located=📍 钉子所在目录 url（**常驻**——点别处也不消失，
  // 再定位才换，当"工作副本在哪"的书签用）；locatedHL=蓝框高亮是否还亮（点任何地方即灭——
  // 与"点击选中"区分开）。locating=防连点
  const [located, setLocated] = useState<string | null>(null);
  const [locatedHL, setLocatedHL] = useState(false);
  /** 右键/单击选中行（用户定稿：右键时要选中该文件或目录）——与 file 共用 active 高亮 */
  const [ctxSel, setCtxSel] = useState<string | null>(null);
  /** 搜索范围的行来源（见 selectRow）：只有**树里点选**才更新它——搜索结果定位会改 ctxSel 但不动它，
   *  否则"点开一个结果"会把下次搜索的范围悄悄换到那个文件所在的目录，用户完全没察觉 */
  const [scopeSel, setScopeSel] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // kids 的 ref 镜像：locate 的异步循环里要读"最新已加载状态"（闭包里的 state 会陈旧）
  const kidsRef = useRef<Record<string, RepoEntry[] | 'loading'>>({});
  // 左右宽度（%）：可拖动（容器基准，防弹窗不全屏时比例失真）
  const [leftRatio, setLeftRatio] = useState(45);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startRatio: number; width: number } | null>(null);
  // ---- 远程搜索（"搜索/列出该目录下所有文件"）：范围=树中选中目录（文件取其父目录；无选中=弹窗根）----
  const [q, setQ] = useState('');
  /** 下拉是否展示（点树/点结果后收起；再输入或聚焦重新打开） */
  const [qOpen, setQOpen] = useState(true);
  /** 搜索中（含 400ms 防抖期）：打字即置位（大目录上几秒没反应像卡死——与主界面搜索同语义） */
  const [qBusy, setQBusy] = useState(false);
  const [qErr, setQErr] = useState('');
  const [qItems, setQItems] = useState<{ path: string; isDir: boolean }[] | null>(null);
  /** 结果不完整的两种情形（后端标记）：limit=匹配已满上限；time=目录大搜索超时 */
  const [qTrunc, setQTrunc] = useState<'limit' | 'time' | null>(null);
  const [qIdx, setQIdx] = useState(0);
  const [qAll, setQAll] = useState(false);
  /** 发起这次搜索时的范围（结果行的"在 xx 下 N 个匹配"用它——范围后来变了也不误导出处） */
  const [qScopeUrl, setQScopeUrl] = useState(root);
  /** 请求序号：只认最新一次响应（先后请求可能乱序返回，防旧结果覆盖新查询） */
  const qSeq = useRef(0);
  const qAbort = useRef<AbortController | null>(null);
  const qDebounce = useRef<ReturnType<typeof setTimeout>>();
  /** 搜索行容器（输入框+下拉）：点容器之外的任何地方都收起下拉 */
  const qWrapRef = useRef<HTMLDivElement | null>(null);

  // 点下拉之外的任何地方（树/预览/标题栏）→ 收起下拉，让位给被挡的内容
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!qWrapRef.current || qWrapRef.current.contains(e.target as Node)) return;
      setQOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  /** 换文件回源码视图时一并重置（见 cat effect）；md 判定 */
  const isMd = !!file && /\.(md|markdown)$/i.test(file.name);

  /** 「下载」：优先**浏览器原生「另存为」**（showSaveFilePicker——Electron/Chrome；用户定稿
   *  "下载文件而已，打开浏览器的下载弹窗就行"）；不支持（Firefox 等）降级回目录选择弹窗。
   *  取消保存框（AbortError）静默返回 */
  const downloadFile = async () => {
    if (!file) return;
    const pickerFn = (
      window as unknown as {
        showSaveFilePicker?: (o: { suggestedName?: string }) => Promise<{ name: string; createWritable: () => Promise<WritableStream<Uint8Array>> }>;
      }
    ).showSaveFilePicker;
    if (!pickerFn) {
      setPicker(true); // 降级：现有目录选择弹窗（后端写盘）
      return;
    }
    try {
      const handle = await pickerFn({ suggestedName: file.name });
      // 全量字节端点（预览 cat 有 2MB 上限，下载不受限）
      const res = await fetch(`/api/repo-download?url=${encodeURIComponent(file.url)}`);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const w = await handle.createWritable();
      await res.body.pipeTo(w);
      // 已保存到 {path}
      setMsg(t('repo.browse.saved', { path: handle.name }));
      setMsgErr(false);
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === 'AbortError') return; // 用户取消保存框——静默
      setMsg(err.message);
      setMsgErr(true);
    }
  };

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
    setMdPreview(/\.(md|markdown)$/i.test(file.name)); // md **默认预览模式**（用户定稿）；其他回源码
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
        // 只展开到目标的**父级**——目标自身保持折叠（用户定稿：定位到它即可；
        // 把它标成展开态但没有子项数据、也不拉，反而让下面同级的行看起来像它的内容）
        setExpanded((prev) => new Set([...prev, ...toExpand.slice(0, -1)]));
        selectRow(null); // 定位接管高亮（清掉可能挂着的行选中）
        setLocated(cur);
        setLocatedHL(true);
        // 等树渲染完再滚动居中（350ms 覆盖一帧渲染）
        window.setTimeout(() => {
          document.querySelector(`.repo-row[data-url="${CSS.escape(cur)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 350);
      }
    } finally {
      setLocating(false);
    }
  };

  /** 树行选中（空白 = null）：选中什么就搜什么——同时作为搜索范围。
   *  搜索结果定位（pickResult）刻意不走这里：定位不改变搜索范围 */
  const selectRow = (url: string | null) => {
    setCtxSel(url);
    setScopeSel(url);
  };

  /** 搜索范围：树里点选的行是目录 → 它；是文件 → 其父目录；没点过 → 弹窗根 */
  const scopeUrl = (() => {
    if (!scopeSel) return root;
    const i = scopeSel.lastIndexOf('/');
    const list = kids[scopeSel.slice(0, i)];
    const e = Array.isArray(list) ? list.find((x) => x.name === scopeSel.slice(i + 1)) : undefined;
    return e && !e.isDir ? scopeSel.slice(0, i) : scopeSel;
  })();
  /** 范围显示名（占位符/结果计数用；弹窗根 = "仓库根"） */
  const scopeLabel = (u: string): string => (u === root ? t('repo.search.rootName') : u.slice(u.lastIndexOf('/') + 1));
  // effect 里读最新范围（依赖里不放 scopeUrl：换选中不自动重搜——避免下拉自己冒出来盖住树）
  const scopeRef = useRef(scopeUrl);
  scopeRef.current = scopeUrl;

  // 远程搜索（防抖 400ms；与主界面搜索同门槛：≥2 字符或 1 个汉字）
  useEffect(() => {
    const query = q.trim();
    const isCn = /[一-鿿]/.test(query); // i18n-ignore: 判定输入是否含中文的逻辑正则（非界面文案）
    if (!query || query.length < (isCn ? 1 : 2)) {
      qSeq.current += 1; // 门槛不满足：在途请求作废（它的 svn 进程由后端杀掉）
      qAbort.current?.abort();
      qAbort.current = null;
      setQBusy(false);
      setQErr('');
      setQItems(null);
      setQTrunc(null);
      return;
    }
    setQBusy(true);
    if (qDebounce.current) clearTimeout(qDebounce.current);
    qDebounce.current = setTimeout(() => {
      qAbort.current?.abort(); // 上一个查询还没回来：作废（后端随之杀掉它的 svn）
      const ac = new AbortController();
      qAbort.current = ac;
      const seq = ++qSeq.current;
      const scope = scopeRef.current; // 发起时的范围
      get
        .repoSearch(scope, query, ac.signal)
        .then((r) => {
          if (seq !== qSeq.current) return; // 迟到的旧响应：丢弃
          setQBusy(false);
          setQScopeUrl(scope);
          if (!r.ok) {
            setQErr(r.error ?? '');
            setQItems(null);
            setQTrunc(null);
            return;
          }
          setQErr('');
          setQItems(r.items ?? []);
          setQTrunc(r.truncated ?? null);
          setQIdx(0);
          setQAll(false);
        })
        .catch((e: Error & { cancelled?: boolean }) => {
          if (seq !== qSeq.current || e.cancelled) return; // 自己取消的（清空/换词）：静默
          setQBusy(false);
          setQErr(e.message);
        });
    }, 400);
    return () => {
      if (qDebounce.current) clearTimeout(qDebounce.current);
    };
  }, [q]);

  // 弹窗关闭：掐掉在途搜索（后端随之杀掉它的 svn）
  useEffect(() => () => qAbort.current?.abort(), []);

  /** 点搜索结果：展开树定位到目标并预览——文件=展开父链+选中预览；目录=展开父链后再展开自身 */
  const pickResult = async (it: { path: string; isDir: boolean }) => {
    setQOpen(false); // 收起下拉，让位给树（定位要看树）
    setMsg('');
    // 结果路径相对【发起搜索的范围】：拼上范围相对弹窗根的段，才是从树根展开的完整路径
    const baseRel = qScopeUrl === root ? '' : qScopeUrl.slice(root.length + 1);
    const segs = [...(baseRel ? baseRel.split('/') : []), ...it.path.split('/')].filter(Boolean);
    if (segs.length === 0) return;
    const urlOf = (n: number) => (n === 0 ? root : `${root}/${segs.slice(0, n).join('/')}`);
    // 逐级确保父链已加载（含目标的父目录——文件行要有父目录展开才可见）
    for (let i = 0; i < segs.length; i++) {
      const ok = await ensureKids(urlOf(i));
      if (!ok) {
        // 定位失败（{s} 读取不到，可能无权限）
        setMsg(t('repo.browse.locateFail', { s: segs[i] ?? '' }));
        setMsgErr(true);
        return;
      }
    }
    const targetUrl = urlOf(segs.length);
    const expand = new Set<string>();
    for (let i = 1; i < segs.length; i++) expand.add(urlOf(i));
    if (it.isDir) {
      await ensureKids(targetUrl); // 目录：展开自身（搜到目录多半想进去看）
      expand.add(targetUrl);
    }
    setExpanded((prev) => new Set([...prev, ...expand]));
    setCtxSel(targetUrl);
    setLocatedHL(false);
    if (it.isDir) setFile(null);
    else setFile({ name: segs[segs.length - 1]!, url: targetUrl });
    // 等树渲染完再滚动居中（同"定位到该项目"）
    window.setTimeout(() => {
      document.querySelector(`.repo-row[data-url="${CSS.escape(targetUrl)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 350);
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
      <ResizableModal width={1130} height={500} maxed={maxed} onToggleMax={() => setMaxed((m) => !m)} onEsc={props.onClose}>
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
                {locating ? (
                  // 定位中…
                  t('repo.browse.locating')
                ) : (
                  // 定位到该项目（彩色图钉，与树里的钉子同款）
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <IconPin size={12} />
                    {t('repo.browse.locate')}
                  </span>
                )}
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
            {/* 左列 = 搜索行 + 树（搜索下拉相对搜索行定位，浮在树上方） */}
            <div style={{ flex: `0 0 ${leftRatio}%`, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div ref={qWrapRef} style={{ position: 'relative', flexShrink: 0, paddingBottom: 6 }}>
                <input
                  type="text"
                  // 🔍 搜索该目录下所有文件…（占位符即当前范围：选中哪个目录就搜哪个）
                  placeholder={t('repo.search.placeholder', { scope: scopeLabel(scopeUrl) })}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setQOpen(true);
                    setQIdx(0);
                    setQAll(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setQIdx((i) => Math.min((qItems?.length ?? 1) - 1, i + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setQIdx((i) => Math.max(0, i - 1));
                    } else if (e.key === 'Enter' && !isImeComposing(e)) {
                      const it = qItems?.[Math.min(qIdx, (qItems?.length ?? 1) - 1)];
                      if (it) void pickResult(it);
                    }
                    // Esc 由弹窗外壳接管（关闭弹窗），清空用右侧 ×
                  }}
                  // 聚焦即重开下拉（点过树/结果后下拉收起，点回输入框能接着看结果列表）
                  onFocus={() => setQOpen(true)}
                  style={{ width: '100%', paddingRight: 24 }}
                />
                {/* 右侧同一位置：搜索中转圈 / 否则是清空按钮（同主界面搜索框） */}
                {qBusy ? (
                  // 正在搜索…
                  <span className="search-spin search-box-spin" title={t('fs.search.searching')} />
                ) : (
                  q && (
                    <button
                      className="search-clear"
                      // 清空
                      title={t('fs.search.clear')}
                      onClick={() => {
                        setQ('');
                        setQOpen(false);
                        setQIdx(0);
                      }}
                    >
                      ×
                    </button>
                  )
                )}
                {/* 结果下拉（点树/点结果后收起；再输入重开） */}
                {qOpen && q.trim() && (qBusy || qErr || qItems) && (
                  <div className="search-drop" style={{ width: '100%', maxHeight: 'min(60vh, 420px)' }}>
                    {qBusy ? (
                      // 搜索中不显示上一轮结果（对应当前输入之外的字，显示只会误导）
                      <div className="dim row" style={{ padding: '6px 10px', gap: 6, alignItems: 'center' }}>
                        <span className="search-spin" /> {t('fs.search.searching')}
                      </div>
                    ) : qErr ? (
                      <div className="error small" style={{ padding: '6px 10px', wordBreak: 'break-all' }}>{qErr}</div>
                    ) : (qItems?.length ?? 0) === 0 ? (
                      // 无匹配（超时的小目录外情况：0 条也说明"没搜完"，别显示成"真没有"）
                      qTrunc ? (
                        <div className="small" style={{ padding: '6px 10px', color: 'var(--warn)' }}>
                          ⚠ {t(qTrunc === 'limit' ? 'repo.search.truncated' : 'repo.search.timeout', { n: 200 })}
                        </div>
                      ) : (
                        <div className="dim" style={{ padding: '6px 10px' }}>{t('fs.search.none')}</div>
                      )
                    ) : (
                      <>
                        {/* 顶部固定块：出处 + 截断说明（sticky——长列表滚动时这两行常驻可见；
                            否则"结果可能不全"的提示会被挤出视野，用户误以为拿到的是全部） */}
                        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--panel2)' }}>
                          <div className="dim small" style={{ padding: '4px 10px' }}>
                            {t('repo.search.count', { scope: scopeLabel(qScopeUrl), n: qItems?.length ?? 0 })}
                          </div>
                          {qTrunc && (
                            <div className="small" style={{ padding: '0 10px 4px', color: 'var(--warn)' }}>
                              {/* 仅显示前 N 个匹配（目录较大…） / 搜索超时（目录较大），结果可能不全 */}
                              ⚠ {t(qTrunc === 'limit' ? 'repo.search.truncated' : 'repo.search.timeout', { n: 200 })}
                            </div>
                          )}
                        </div>
                        {(qAll ? qItems ?? [] : (qItems ?? []).slice(0, 10)).map((it, i) => (
                          <div
                            key={it.path}
                            className={`search-item ${i === qIdx ? 'active' : ''}`}
                            onClick={() => void pickResult(it)}
                          >
                            <span className="dim" style={{ flexShrink: 0 }}>{i + 1}.</span>
                            <MiniIcon isDir={it.isDir} name={it.path.slice(it.path.lastIndexOf('/') + 1)} />
                            <span className="search-path" title={it.path}>{highlightMatch(it.path, q.trim())}</span>
                          </div>
                        ))}
                        {(qItems?.length ?? 0) > 10 && (
                          <div
                            className="search-item"
                            style={{ justifyContent: 'center' }}
                            // 收起列表 / 点击展开全部匹配
                            title={qAll ? t('fs.search.collapse') : t('fs.search.expand')}
                            onClick={() => setQAll(!qAll)}
                          >
                            <span className="dim">
                              {qAll ? t('fs.search.collapsed', { n: qItems?.length ?? 0 }) : t('fs.search.expandAll', { n: qItems?.length ?? 0 })}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div
                className="vcs-list repo-list"
                style={{ flex: 1, minHeight: 0 }}
                // 空白处右键 = 仓库根（行内已 stopPropagation，不会冒到这里）；顺带清掉行选中与定位高亮
                // （📍 钉子常驻不清——只灭蓝框）
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  selectRow(null);
                  setLocatedHL(false);
                  setMenu({ x: ev.clientX, y: ev.clientY, url: root });
                }}
                // 空白左键（行内点击由行自己处理，冒泡来的直接跳过）：取消选择与定位高亮
                // （搜索下拉的收起由"点外部"的全局监听统一处理，不在这里做）
                onClick={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  selectRow(null);
                  setLocatedHL(false);
                }}
              >
                {rootLoading && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>}
                {rootErr && (
                  <div className="error small" style={{ padding: '10px 6px', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{rootErr}</span>
                    {/* ×：关掉这条提示 */}
                    <button
                      className="mini"
                      style={{ flexShrink: 0 }}
                      title={t('common.close')}
                      onClick={() =>
                        setErrs((e) => {
                          const n = { ...e };
                          delete n[root];
                          return n;
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                )}
                {/* 这个目录是空的 */}
                {Array.isArray(kids[root]) && kids[root].length === 0 && (
                  <div className="dim small" style={{ padding: '10px 6px' }}>{t('repo.browse.empty')}</div>
                )}
                {rows.map(({ e, url, depth }) => {
                  const active = file?.url === url || (located === url && locatedHL) || ctxSel === url;
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
                        onClick={() => {
                          // 单击选中（与右键一致）；定位蓝框是"一次性指路"——点任何地方就让它让位
                          selectRow(url);
                          setLocatedHL(false);
                          if (e.isDir) {
                            toggleDir(url);
                            setFile(null); // 点目录 = 取消文件的选中与预览（焦点只有一个——用户定稿）
                          } else {
                            setFile({ name: e.name, url });
                          }
                        }}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          selectRow(url); // 右键即选中该行（用户定稿）
                          setLocatedHL(false); // 定位蓝框让位（📍 钉子常驻）
                          if (e.isDir) {
                            setFile(null); // 右键目录同样收敛焦点（避免文件+目录两个蓝框并存）
                            setMenu({ x: ev.clientX, y: ev.clientY, url });
                          } else {
                            // 文件行不给菜单（检出只对目录/仓库根有意义，不弹浏览器原生菜单）；
                            // 只选中、不清预览之外的东西
                            setFile(null);
                          }
                        }}
                      >
                        <span className="repo-arrow">{e.isDir ? (busy ? '…' : open ? '▾' : '▸') : ''}</span>
                        <MiniIcon isDir={e.isDir} name={e.name} />
                        <span className="mono small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.name}
                        </span>
                        {/* 📍 定位钉子（彩色 SVG 图钉）：**常驻**（"工作副本在哪"的书签；再定位才换）——紧跟文件名后（用户定稿） */}
                        {located === url && (
                          <span style={{ flexShrink: 0, display: 'inline-flex' }} title={t('repo.browse.locate')}>
                            <IconPin size={12} />
                          </span>
                        )}
                        {/* 弹性占位：把大小/修订列推到行尾（替代 name 原本的 flex:1） */}
                        <span style={{ flex: 1 }} />
                        <span className="dim small nowrap" style={{ flexShrink: 0, width: 60, textAlign: 'right' }}>{fmtSize(e.size)}</span>
                        <span className="dim small nowrap" style={{ flexShrink: 0, width: 70 }} title={`${e.author ?? ''} ${e.date?.slice(0, 10) ?? ''}`}>
                          {e.rev ? `r${e.rev}` : ''}
                        </span>
                      </div>
                      {/* 展开失败：该目录下就地报错（如无权限）；× 关掉这条提示 */}
                      {subErr && (
                        <div className="error small" style={{ padding: `2px 6px 4px ${20 + depth * 14}px`, wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ flex: 1, minWidth: 0 }}>{subErr}</span>
                          <button
                            className="mini"
                            style={{ flexShrink: 0 }}
                            title={t('common.close')}
                            onClick={() =>
                              setErrs((e) => {
                                const n = { ...e };
                                delete n[url];
                                return n;
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            {/* 可拖分隔（并排对比同款；宽度收窄为 4px——用户定稿"再小点"） */}
            <div className="sb-resizer" style={{ width: 4 }} onMouseDown={startDrag} title={t('repo.browse.dragTip')} />
            {/* 预览区：文件名+工具行**固定**（不随内容滚动——用户定稿），内容区独立滚动 */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* 选中文件即出文件名行（复制/下载按钮立即可用——loading/出错/二进制时下载都需要） */}
              {file && (
                <div className="row" style={{ flexShrink: 0, padding: '4px 6px', borderBottom: '1px solid var(--border2)', marginBottom: 6, gap: 8 }}>
                    <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                    {/* 预览 / 源码切换（md 文件；在复制按钮**左侧**——用户定稿） */}
                    {isMd && text !== null && (
                      <button className="mini" onClick={() => setMdPreview((v) => !v)}>
                        {mdPreview ? t('repo.browse.mdSource') : t('repo.browse.mdPreview')}
                      </button>
                    )}
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
                    {/* 下载（浏览器原生「另存为」；不支持时降级回目录选择） */}
                  <button className="mini" onClick={() => void downloadFile()}>{t('repo.browse.download')}</button>
                </div>
              )}
              {/* 内容区：独立滚动（工具行固定在上面——用户定稿） */}
              <div className="vcs-list" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {!file && <div className="dim small" style={{ padding: '10px 6px' }}>{t('repo.browse.pickFile')}</div>}
                {file &&
                  (fileBin ? (
                    // 不支持浏览，请下载后再浏览
                    <div className="small" style={{ padding: '10px 6px', color: 'var(--warn)' }}>⚠ {t('repo.browse.binary')}</div>
                  ) : fileErr ? (
                    <div className="error small" style={{ padding: '2px 6px', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{fileErr}</span>
                      {/* ×：关掉这条提示 */}
                      <button className="mini" style={{ flexShrink: 0 }} title={t('common.close')} onClick={() => setFileErr('')}>
                        ×
                      </button>
                    </div>
                  ) : text === null ? (
                    <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>
                  ) : mdPreview && isMd ? (
                    // md 渲染预览（同主界面：renderMarkdown + md 主题变量 + 代码块复制按钮事件代理）
                    <div
                      className="md-render"
                      style={{ ...mdThemeVars(loadMdTheme()), padding: '0 8px 10px' }}
                      onClick={(ev) => {
                        // 代码块「复制」（按钮由 renderMarkdown 输出的 HTML 生成，事件代理；
                        // 就地反馈：短暂变「已复制」）
                        const el = ev.target as HTMLElement;
                        if (!el.classList.contains('md-copy')) return;
                        const code = el.closest('pre')?.querySelector('code')?.textContent ?? '';
                        void navigator.clipboard?.writeText(code).then(() => {
                          el.textContent = t('fs.pv.copied');
                          setTimeout(() => (el.textContent = t('fs.pv.copyCode')), 1500);
                        });
                      }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { copyBtn: true }) }}
                    />
                  ) : (
                    <pre className="mono" style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                      {text.split('\n').map((l, i) => (
                        <div key={i} dangerouslySetInnerHTML={{ __html: highlightLine(l, langOf(file.name)) || '&nbsp;' }} />
                      ))}
                    </pre>
                  ))
                }
              </div>
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
      {/* 检出到本地（URL 直连检出）：点确认后弹窗即关，任务在后台跑（顶栏沙漏可取消），
          完成自动打开工作副本；认证失败弹下面的凭据框重试 */}
      {checkout && <CheckoutDialog url={checkout.url} onClose={() => setCheckout(null)} onStart={startCheckout} />}
      {checkoutAuth && <CheckoutAuthModal auth={checkoutAuth} onClose={closeCheckoutAuth} onToast={onToast} />}
    </div>
  );
}
