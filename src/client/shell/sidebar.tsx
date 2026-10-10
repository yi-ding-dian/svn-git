/** 侧边栏：视图导航 + 最近项目列表（右键设常用/备注/删除）+ 版本号 */
import React, { useState } from 'react';
import { IconClock, IconFolder, IconRename } from '../ui/icons.js';
// import { IconDiff } from '../ui/icons.js'; // 差异入口隐藏，恢复时连同 NAV 项一起打开
import { ContextMenu } from '../ui/context-menu.js';
import { RemarkModal } from '../repo/remark.js';
import { THEMES, THEME_PINNED } from './header.js';
import type { HistoryItem } from '../shared/api.js';
import { baseName } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

/** 主视图类型（侧边栏导航目标） */
export type View = 'log' | 'diff' | 'browse';

/** 侧边栏最近项目最多列这么多，其余收进「…」面板（项目多时不撑长侧边栏） */
export const RECENT_LIMIT = 10;

/** 最近打开时间（列表第二行的小字）：越近越具体、越远越粗略——侧边栏只有 160px 宽，省着用 */
function relTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const mins = Math.floor((now.getTime() - ts) / 60000);
  // 刚刚
  if (mins < 1) return t('shell.time.justNow');
  // {n} 分钟前
  if (mins < 60) return t('shell.time.minutesAgo', { n: mins });
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayKey = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  // 今天 {time}
  if (dayKey(d) === dayKey(now)) return t('shell.time.today', { time: hm });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  // 昨天 {time}
  if (dayKey(d) === dayKey(y)) return t('shell.time.yesterday', { time: hm });
  const days = Math.floor((now.getTime() - ts) / 86400000);
  // {n} 天前
  if (days < 7) return t('shell.time.daysAgo', { n: days });
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return d.getFullYear() === now.getFullYear() ? mmdd : `${d.getFullYear()}-${mmdd}`;
}

export function Sidebar(props: {
  view: View;
  history: HistoryItem[];
  version?: string;
  /** 当前打开的仓库根：匹配的最近项目高亮选中，标明正在操作的项目 */
  currentRoot?: string | null;
  onNav: (v: View) => void;
  onOpenHistory: (h: { path: string }) => void;
  onRemoveHistory: (path: string) => void;
  /** 设置/取消常用项目（星号标记，启动时优先打开） */
  onSetFav: (path: string, fav: boolean) => void;
  /** 设置/清除项目备注（显示在第二行、时间前面）；传空串 = 清除备注 */
  onSetRemark: (path: string, remark: string) => void;
  /** 外观区：主题色块（位于最近项目上方；字体设置在顶栏 ⋯ 菜单） */
  theme: string;
  setTheme: (t: string) => void;
  /** 打开主题气泡（参数为「…」按钮的屏幕坐标，气泡贴其下方展开） */
  onOpenThemePop: (x: number, y: number) => void;
  /** 主题气泡是否打开（「…」按钮高亮态） */
  themePopOpen: boolean;
  /** 点最近项目末尾的「…」：在按钮右侧展开其余项目（参数为锚点坐标） */
  onOpenRecentMore: (x: number, y: number) => void;
  /** 该面板是否打开（「…」按钮高亮态） */
  recentMoreOpen: boolean;
  /** 点开过但打不开的项目：路径 → 错误消息（这些项上常驻 ×，悬浮时显示同一条消息） */
  invalidPaths: Record<string, string>;
  /** 悬浮失效项时显示提示（复用点击后那套浮层） */
  onShowTip: (msg: string) => void;
  /** 最近项目下方的「＋ 打开项目」：打开项目选择弹窗（与顶栏 ⋯ 菜单里那个同一入口） */
  onOpenProject: () => void;
}) {
  // 最近项目右键菜单（设常用 / 备注 / 删除 / 取消）。remark 一并带出：菜单项要用它预填备注弹窗
  const [rmMenu, setRmMenu] = useState<{ x: number; y: number; path: string; fav: boolean; remark: string } | null>(null);
  // 备注弹窗（右键「备注」打开）：null = 关闭
  const [remarkFor, setRemarkFor] = useState<{ path: string; name: string; current: string } | null>(null);
  // 项目超过一屏（要折叠成「…」）时用**单行紧凑**模式：两行式每项 ~51px，10 项就把侧边栏撑满了，
  // 时间那行这时只能让位——它是锦上添花，项目名才是要认的
  const compact = props.history.length > RECENT_LIMIT;

  const NAV = [
    // 历史
    { key: 'log' as View, label: t('shell.nav.history'), icon: <IconClock size={16} /> },
    // 差异入口隐藏：提交弹窗双击文件/冲突界面仍可进入差异视图
    // { key: 'diff' as View, label: '差异', icon: <IconDiff size={16} /> },
    // 文件夹
    { key: 'browse' as View, label: t('shell.nav.files'), icon: <IconFolder size={16} /> },
  ];

  return (
    <div className="sidebar" style={{ display: props.view === 'diff' ? 'none' : undefined }}>
      {NAV.map((n) => (
        <div
          key={n.key}
          className={`item ${props.view === n.key ? 'active' : ''}`}
          onClick={() => props.onNav(n.key)}
        >
          <span style={{ display: 'flex', width: 20, justifyContent: 'center' }}>{n.icon}</span>
          <span>{n.label}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {/* 外观区：前 5 套主题为快捷圆点，其余全部在「…」气泡里（含自定义配色/我的主题） */}
      <div className="row small dim nowrap" style={{ gap: 5, padding: '2px 20px 4px' }}>
        {/* map 参数名用 th：本文件 import 了 i18n 的 t()，同名会遮蔽 */}
        {THEMES.slice(0, THEME_PINNED).map((th) => (
          <button
            key={th.key}
            className={`theme-btn ${props.theme === th.key ? 'active' : ''}`}
            title={t(th.nameKey)}
            style={{ background: th.color, width: 18, height: 18 }}
            onClick={() => props.setTheme(th.key)}
          />
        ))}
        <button
          className={`theme-more ${props.themePopOpen ? 'active' : ''}`}
          // 更多主题 · 自定义配色
          title={t('shell.theme.more')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            props.onOpenThemePop(r.left, r.bottom + 6);
          }}
        >
          ⋯
        </button>
      </div>
      {/* 最近项目：底部区域（版本号上方） */}
      {props.history.length > 0 && (
        <>
          {/* 最近项目 */}
          <div className="sidebar-title">{t('shell.recent.title')}</div>
          <div className="history-list">
            {props.history.slice(0, RECENT_LIMIT).map((h) => {
              const invalidMsg = props.invalidPaths[h.path];
              const invalid = Boolean(invalidMsg);
              return (
                <div
                  key={h.path}
                  className={`history-item ${h.path === props.currentRoot ? 'active' : ''}${invalid ? ' invalid' : ''}`}
                  title={
                    invalidMsg
                      // {path}（打不开，目录已删除或不是工作副本）
                      ? t('shell.recent.invalid', { path: h.path })
                      // 备注：{remark} / （当前操作的项目） / （常用项目） / 点击打开 · 右键设常用/备注/删除
                      : `${h.path}${h.remark ? `\n${t('shell.recent.tipRemark', { remark: h.remark })}` : ''}${h.path === props.currentRoot ? `\n${t('shell.recent.tipCurrent')}` : ''}${h.fav ? `\n${t('shell.recent.tipFav')}` : ''}\n${t('shell.recent.tipClick')}`
                  }
                  onClick={() => props.onOpenHistory(h)}
                  onMouseEnter={() => {
                    if (invalidMsg) props.onShowTip(invalidMsg); // 悬浮失效项：提示和点击后完全一致
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setRmMenu({ x: e.clientX, y: e.clientY, path: h.path, fav: Boolean(h.fav), remark: h.remark ?? '' });
                  }}
                >
                  <span className={`badge ${h.type}`} style={{ fontSize: 9, padding: '0 5px' }}>
                    {h.type.toUpperCase()}
                  </span>
                  {/* 两行式：第一行=名字（徽标与星号之间），第二行=备注+时间。
                      第二行改由 flex-basis:100% 换行、**占满整行**（含徽标下方那块）——原先它缩进在
                      名字下方，徽标底下那 30 多 px 白空着；160px 的侧边栏里这是很大一块
                      （用户实报「左边那么多空位」，备注"git仓库"因此被压成 "g…"） */}
                  <span className="history-path">{baseName(h.path)}</span>
                  {/* 常用项目（启动时优先打开） */}
                  {h.fav && <span className="fav-star" title={t('shell.recent.favStar')}>★</span>}
                  {/* 点开过但打不开：常驻 × 直接移除（不必再右键或悬浮）。
                      必须排在第二行**之前**——第二行 flex-basis:100% 会换行，× 写在它后面会被挤到第二行 */}
                  {invalid && (
                    <button
                      className="history-remove"
                      // 该项目已打不开，点击从最近项目中移除
                      title={t('shell.recent.removeInvalid')}
                      // 移除 {path}
                      aria-label={t('shell.recent.removeAria', { path: h.path })}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRemoveHistory(h.path);
                      }}
                    >
                      ×
                    </button>
                  )}
                  {/* 第二行 = 备注 + 时间。时间 flex:0 0 auto 钉死不被压缩，备注吃掉剩余宽度、超长截断成
                      「…」——所以备注写多长都挤不掉时间（用户要求"保证时间正常显示"），全文靠悬浮看 */}
                  {!compact && (
                    <span className="history-time">
                      {h.remark && <span className="history-remark">{h.remark}</span>}
                      <span className="history-time-text">{relTime(h.lastOpened)}</span>
                    </span>
                  )}
                </div>
              );
            })}
            {/* 超出上限：末行「…」居中，点击在右侧展开其余项目 */}
            {props.history.length > RECENT_LIMIT && (
              <div
                className={`history-item history-more ${props.recentMoreOpen ? 'active' : ''}`}
                // 还有 {n} 个最近项目
                title={t('shell.recent.moreTitle', { n: props.history.length - RECENT_LIMIT })}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  props.onOpenRecentMore(r.right + 6, r.top);
                }}
              >
                {/* …（{n} 条） */}
                <span className="history-more-dots">{t('shell.recent.moreDots', { n: props.history.length - RECENT_LIMIT })}</span>
              </div>
            )}
            {/* 右键菜单：设为常用 / 删除 / 取消 */}
            {rmMenu && (
              <ContextMenu
                x={rmMenu.x}
                y={rmMenu.y}
                mask
                onClose={() => setRmMenu(null)}
                items={
                  // 失效项（已打不开）：只留「删除」——设为常用没意义，"取消"项也多余（点外面即可关）
                  props.invalidPaths[rmMenu.path]
                    // 删除
                    ? [{ icon: '🗑', label: t('common.delete'), danger: true, action: () => props.onRemoveHistory(rmMenu.path) }]
                    : [
                        {
                          icon: rmMenu.fav ? '★' : '☆',
                          // 取消常用 / 设为常用
                          label: rmMenu.fav ? t('shell.recent.unsetFav') : t('shell.recent.setFav'),
                          action: () => props.onSetFav(rmMenu.path, !rmMenu.fav),
                        },
                        {
                          // 铅笔用项目里的 SVG（IconRename），不引 emoji——没装彩色 emoji 字体的桌面会渲染成单色
                          icon: <IconRename size={14} />,
                          // 编辑备注 / 备注
                          label: rmMenu.remark ? t('shell.recent.editRemark') : t('shell.recent.remark'),
                          action: () => {
                            // 先收菜单再开弹窗：两者都带全屏遮罩，叠在一起点哪儿都像没反应
                            setRmMenu(null);
                            setRemarkFor({
                              path: rmMenu.path,
                              name: baseName(rmMenu.path),
                              current: rmMenu.remark,
                            });
                          },
                        },
                        // 删除
                        { icon: '🗑', label: t('common.delete'), danger: true, action: () => props.onRemoveHistory(rmMenu.path) },
                        // 取消
                        { icon: '✕', label: t('common.cancel') },
                      ]
                }
              />
            )}
            {/* 备注弹窗（右键「备注」）：确认后写回后端，useProjectHistory 拿新列表刷新 */}
            {remarkFor && (
              <RemarkModal
                projectName={remarkFor.name}
                current={remarkFor.current}
                onCancel={() => setRemarkFor(null)}
                onConfirm={(remark) => {
                  props.onSetRemark(remarkFor.path, remark);
                  setRemarkFor(null);
                }}
              />
            )}
          </div>
        </>
      )}
      {/* 打开项目：常驻在最近项目下方（没有历史记录时更要有这个入口） */}
      {/* 打开其它项目（选择目录） */}
      <button className="history-open" onClick={props.onOpenProject} title={t('shell.recent.openOther')}>
        {/* ＋ 打开项目 */}
        {t('shell.recent.open')}
      </button>
    </div>
  );
}
