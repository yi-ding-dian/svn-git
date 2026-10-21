/** 目录浏览器：「打开项目」与「所在目录」选择共用的浏览视图 —— 路径输入 + 拖拽切换 + 面包屑/上级 + 图标网格。
 *
 *  为什么这么拆：两处原先各写一套（OpenBrowser / DirPicker），浏览体验越走越远（一边有路径输入、
 *  拖拽、文件灰显，一边只列文件夹）。这里把「怎么浏览」收成一份，父层只保留「数据与语义」：
 *  各自 get.browse（打开项目要吃 entries 做仓库识别、选择器要在重命名后 reload），
 *  目录切换、拖拽取路径、上级判定等一律走本组件，避免再各写一套漂移。 */
import React, { useState } from 'react';
import { get, type BrowseResult } from '../shared/api.js';
import { GridIcon } from '../ui/icons.js';
import { joinPath, parentPath, pathFromFile, isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

/** 网格条目（/api/browse entries 的子集） */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

export function DirBrowser(props: {
  /** 当前浏览目录（受控；空串 = startDir 尚未就绪：渲染骨架但不转圈） */
  dir: string;
  /** 父层取回的目录内容（null = 读取中） */
  data: BrowseResult | null;
  /** 父层业务错误（读取失败 / 未识别到仓库…），与组件内交互错误同处展示 */
  error?: string;
  /** 组件内交互失败的出口（拖拽取不到路径、系统选择器不可用）→ 父层并入 error 展示 */
  onError?: (msg: string) => void;
  /** 目录切换：双击目录 / `..` / ←上级 —— 目标路径由组件算好（`..` 走 parentPath，避免残留 `D:\x\..` 段） */
  onDirChange: (dir: string) => void;
  /** 路径输入行；不传 = 不渲染该行 */
  pathInput?: {
    value: string;
    onChange: (v: string) => void;
    /** 回车提交（语义由父层定：打开项目=识别/打开仓库；选择器=切换目录） */
    onSubmit: () => void;
    placeholder?: string;
    /** 输入行下方提示（拖拽说明） */
    hint?: string;
    /** 显示「📁 选择目录…」系统选择按钮（打开项目 / 选择所在目录共用；选到的路径走 onPathPicked）。
     *  仅 Electron 桌面版有效，纯浏览器模式点了走 onError 提示不支持 */
    pickDir?: boolean;
    /** 行内按钮插槽（打开项目：「打开」；排在 📁选择目录… 之后，保持原有按钮顺序） */
    extra?: React.ReactNode;
  };
  /** 拖入 / 系统选择器拿到的路径（语义由父层定）；传了才启用拖拽与兜底 */
  onPathPicked?: (path: string) => void;
  /** 浏览下界：到了这个目录就不再显示「上级」与 `../`（合并范围等场景限制在本项目内） */
  rootDir?: string;
  /** 允许点选文件（合并范围的文件级合并）：单击选中/取消，选中名由父层保存；不传 = 文件不可选 */
  fileSelect?: { selected: string | null; onSelect: (name: string | null) => void };
  /** 插槽：top=最近项目，toolbar=面包屑行右侧（新建文件夹），notice=识别条/操作反馈，footer=底部操作行 */
  slots?: { top?: React.ReactNode; toolbar?: React.ReactNode; notice?: React.ReactNode; footer?: React.ReactNode };
  /** 空判定（默认 entries.length === 0） */
  isEmpty?: (data: BrowseResult) => boolean;
  /** 空提示文案（默认「空目录」） */
  emptyText?: string;
  /** 项悬浮提示（默认：目录 = 双击进入并给出名字，文件 = 名字本身） */
  tipFor?: (e: DirEntry) => string;
  /** 目录项右键（`..` 不触发：重命名它等于去改父目录，服务端 rename 是裸调用，必须挡住） */
  onDirContextMenu?: (e: React.MouseEvent, name: string) => void;
  /** 行内重命名（选择器专用；不传即无此能力）。onSubmit(oldName, newName)，Esc → onCancel */
  rename?: { name: string; onSubmit: (oldName: string, newName: string) => void; onCancel: () => void };
}) {
  const [dragOver, setDragOver] = useState(false);

  /** 系统目录选择对话框（输入行按钮与拖拽兜底共用） */
  const pickDir = async () => {
    const pick = props.onPathPicked;
    if (!pick) return;
    try {
      const r = await get.pickDir();
      if (r.path) pick(r.path);
      // 浏览器模式下不支持系统目录选择，请手动输入路径
      else if (r.unsupported) props.onError?.(t('repo.open.pickUnsupported'));
    } catch (e) {
      props.onError?.((e as Error).message);
    }
  };

  /** 拖入文件夹 → 绝对路径（Electron webUtils → 浏览器 File.path）。
   *  取不到路径（Firefox 等）：提示 + 自动开系统目录选择，一步到位 */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const pick = props.onPathPicked;
    if (!pick) return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return; // 拖的是文本/链接等：没路径可谈，静默忽略
    const p = pathFromFile(f);
    if (p) {
      pick(p);
      return;
    }
    props.onError?.(t('repo.browser.dragUnsupported'));
    void pickDir();
  };

  // 有浏览下界时，到下界就当作「已在根」：不显示 ←上级，也不渲染 `../`
  const atRoot = Boolean(props.rootDir) && props.dir === props.rootDir;
  const entries = (props.data?.entries ?? []).filter((e) => !(atRoot && e.name === '..'));
  const empty = props.data ? (props.isEmpty ? props.isEmpty(props.data) : entries.length === 0) : false;
  // 上级：到根返回自身（`/`、`D:\`）—— 顺带修掉旧 OpenBrowser 用 `dir !== '/'` 时
  // Windows 盘根也会显示「←上级」、点了没反应的问题
  const upTarget = props.dir ? parentPath(props.dir) : '';
  const canUp = Boolean(props.dir) && upTarget !== props.dir && !atRoot;

  const tipOf = (it: DirEntry): string => {
    // `..` 无右键（见 onDirContextMenu 注释），提示里也不提重命名
    if (it.name === '..') return t('repo.open.dblClickDir', { name: it.name });
    if (props.tipFor) return props.tipFor(it);
    // 双击进入目录 {name}
    return it.isDir ? t('repo.open.dblClickDir', { name: it.name }) : it.name;
  };

  return (
    <div
      onDragOver={(e) => {
        if (!props.onPathPicked) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={dragOver ? 'drop-zone dragover' : 'drop-zone'}
    >
      {props.slots?.top}
      {props.pathInput && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              type="text"
              style={{ flex: 1 }}
              placeholder={props.pathInput.placeholder ?? t('repo.open.pathPlaceholder')}
              value={props.pathInput.value}
              onChange={(e) => props.pathInput!.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === 'Enter') props.pathInput!.onSubmit();
              }}
            />
            {props.pathInput.pickDir && (
              // 打开系统目录选择框
              <button onClick={() => void pickDir()} title={t('repo.open.pickDirTip')}>{t('repo.open.pickDirBtn')}</button>
            )}
            {props.pathInput.extra}
          </div>
          {props.pathInput.hint && <div className="dim small" style={{ marginBottom: 8 }}>{props.pathInput.hint}</div>}
        </>
      )}
      {/* 面包屑行：当前路径（超长省略，悬浮看全）+ ←上级；右侧 toolbar 插槽（选择器：新建文件夹） */}
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <div
          className="breadcrumb"
          title={props.dir}
          style={{ flex: 1, minWidth: 0, marginBottom: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {props.dir}
          {canUp && (
            <a href="#" onClick={(e) => { e.preventDefault(); props.onDirChange(upTarget); }}>
              {/* ← 上级 */}
              {' '}{t('repo.up')}
            </a>
          )}
        </div>
        {props.slots?.toolbar}
      </div>
      {props.error && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{props.error}</span>
          {/* ×：关掉这条提示（走 onError 通道清父层状态——父层都是 setError 直传） */}
          <button className="mini" style={{ flexShrink: 0 }} title={t('common.close')} onClick={() => props.onError?.('')}>
            ×
          </button>
        </div>
      )}
      {props.slots?.notice}
      {/* ⏳ 读取目录… */}
      {props.dir && !props.data && !props.error && <div className="loading">{t('repo.open.loading')}</div>}
      {props.data && (
        // 文件浏览形式：图标网格，目录在前（蓝字）、文件灰显在后（只帮认位置，不可进入）
        <div className="open-grid">
          {empty && <div className="empty" style={{ gridColumn: '1 / -1' }}>{props.emptyText ?? t('repo.open.emptyDir')}</div>}
          {entries.map((it) => {
            if (!it.isDir) {
              const selected = props.fileSelect?.selected === it.name;
              return (
                <div
                  key={it.name}
                  className={`open-grid-item${selected ? ' selected' : ''}`}
                  title={props.fileSelect ? t('repo.picker.fileTip', { name: it.name }) : tipOf(it)}
                  // 文件级合并：单击选中/取消，双击也选中（不自动确认，仍走底部按钮）
                  onClick={props.fileSelect ? () => props.fileSelect!.onSelect(selected ? null : it.name) : undefined}
                  onDoubleClick={props.fileSelect ? () => props.fileSelect!.onSelect(it.name) : undefined}
                >
                  <GridIcon isDir={false} name={it.name} size={38} />
                  <span className="open-grid-name">{it.name}</span>
                </div>
              );
            }
            if (props.rename && props.rename.name === it.name) {
              return (
                // 重命名输入框：自动全选原文件名，回车确认
                <div key={it.name} className="open-grid-item dir" style={{ padding: '10px 6px 2px' }}>
                  <GridIcon isDir name={it.name} size={38} />
                  <input
                    autoFocus
                    type="text"
                    defaultValue={it.name}
                    style={{ width: '100%', padding: '3px 5px', fontSize: 12, textAlign: 'center' }}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (isImeComposing(e)) return;
                      if (e.key === 'Enter') props.rename!.onSubmit(it.name, e.currentTarget.value);
                      if (e.key === 'Escape') props.rename!.onCancel();
                    }}
                  />
                </div>
              );
            }
            const isUp = it.name === '..';
            return (
              <div
                key={it.name}
                className="open-grid-item dir"
                title={tipOf(it)}
                // `..` 是服务端给的上级条目：走 parentPath（否则路径里会留下 `D:\x\..` 这种段）
                onDoubleClick={() => props.onDirChange(isUp ? parentPath(props.dir) : joinPath(props.dir, it.name))}
                onContextMenu={isUp || !props.onDirContextMenu ? undefined : (e) => props.onDirContextMenu!(e, it.name)}
              >
                <GridIcon isDir name={it.name} size={38} />
                <span className="open-grid-name">{it.name}/</span>
              </div>
            );
          })}
        </div>
      )}
      {props.slots?.footer}
    </div>
  );
}
