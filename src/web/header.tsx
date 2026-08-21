/** 顶部工具栏：仓库信息 + 版本管理操作 + 主题/字号 + 打开项目/登录/退出 */
import React, { useState } from 'react';
import { post, type RepoInfo } from './api.js';
import { IconBranch, IconGear, IconTag, IconStash, IconPlus, IconClean, IconFolder, IconRefresh, IconLogin, IconExit, IconCommit } from './icons.js';
import { type Modal } from './modals.js';
import { type View } from './sidebar.js';
import { ContextMenu } from './context-menu.js';

/** 主题列表（浅色系，色块按钮） */
export const THEMES = [
  { key: 'light', name: '浅白', color: '#f6f8fa' },
  { key: 'warm', name: '暖白', color: '#f3ede1' },
  { key: 'cool', name: '冷白', color: '#e8eef5' },
  { key: 'lavender', name: '淡紫', color: '#e8e2f7' },
  { key: 'mint', name: '薄荷', color: '#dcefe4' },
  { key: 'rose', name: '玫瑰', color: '#f6e2e6' },
];

/** 字号档位 */
export const FONT_SIZES = [12, 14, 16, 18];

/** 顶部工具按钮（图标 + 文字，统一样式） */
function ToolBtn(props: {
  icon: React.ReactNode;
  label: React.ReactNode;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="tool-btn" title={props.title} onClick={props.onClick} disabled={props.disabled}>
      {props.icon} {props.label}
    </button>
  );
}

/** 分组分隔线：按语义划分按钮组（传输 / 版本管理 / 仓库 / 维护 / 外观退出） */
function Sep() {
  return <span className="header-sep" />;
}

export function AppHeader(props: {
  view: View;
  repo: RepoInfo | null;
  conflictCount: number;
  configUser: string;
  onRefresh: () => void;
  setModal: (m: Modal) => void;
  onToast: (m: string) => void;
  /** 推送（含进度窗口与认证引导） */
  onPush: () => void;
  /** 未推送提交数（git；null=未知/svn 不显示角标） */
  unpushedCount?: number | null;
}) {
  const repo = props.repo;
  // 「⋯」更多菜单（低频操作：新建仓库 / Git 信息 / SVN 登录）定位
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="header" style={{ display: props.view === 'diff' ? 'none' : undefined }}>
      <span className="logo" style={{ display: 'flex', alignItems: 'center' }} title="svn-git文件版本管理">
        <img src="/icon.png" width="26" height="26" alt="logo" style={{ borderRadius: 6 }} />
      </span>
      {repo?.type ? <span className={`badge ${repo.type}`}>{repo.type.toUpperCase()}</span> : null}
      <span className="path">{repo?.root ?? '未选择仓库'}</span>
      {repo?.url ? <span className="dim small nowrap">{repo.url}</span> : null}
      {repo?.revOrBranch ? <span className="dim small nowrap">[{repo.revOrBranch}]</span> : null}
      <span className="spacer" />
      {/* ① 冲突处理（有冲突时置顶，无分隔前缀） */}
      {props.conflictCount > 0 && (
        <ToolBtn
          icon={<IconClean />}
          label={`解决冲突 (${props.conflictCount})`}
          title="解决冲突文件"
          onClick={() => props.setModal({ type: 'conflicts' })}
        />
      )}
      {/* ② 传输 + 暂存（git） */}
      {repo?.type === 'git' && (
        <>
          <Sep />
          <ToolBtn
            icon={<IconCommit />}
            label={
              props.unpushedCount != null ? (
                <>
                  推送
                  <span className={`push-count ${props.unpushedCount > 0 ? 'on' : ''}`}>{props.unpushedCount}</span>
                </>
              ) : (
                '推送'
              )
            }
            title={
              props.unpushedCount != null && props.unpushedCount <= 0
                ? '没有待推送的提交（未推送数为 0）'
                : `推送 ${props.unpushedCount ?? 0} 个未推送提交（git push，含进度与认证引导）`
            }
            onClick={props.onPush}
            disabled={props.unpushedCount != null && props.unpushedCount <= 0}
          />
          <ToolBtn icon={<IconStash />} label="Stash" title="Stash 暂存区" onClick={() => props.setModal({ type: 'stash' })} />
        </>
      )}
      {/* ③ 版本管理（分支高频保留；标签低频在 ⋯ 菜单） */}
      <Sep />
      <ToolBtn icon={<IconBranch />} label="分支" title="分支管理" onClick={() => props.setModal({ type: 'branches' })} />
      {/* ④ 仓库 */}
      <Sep />
      <ToolBtn icon={<IconFolder />} label="打开项目" title="打开项目" onClick={() => props.setModal({ type: 'open' })} />
      {/* ⑤ 维护 */}
      <Sep />
      {repo?.type === 'git' && (
        <ToolBtn icon={<IconClean />} label="清理" title="清理未跟踪文件" onClick={() => props.setModal({ type: 'clean' })} />
      )}
      {repo?.type === 'svn' && (
        <ToolBtn
          icon={<IconClean />}
          label="清理"
          title="svn cleanup"
          onClick={() =>
            props.setModal({
              type: 'confirm',
              title: 'svn cleanup',
              message: '执行 svn cleanup（清理中断操作遗留的锁）？',
              confirmLabel: '执行',
              action: () => {
                void post
                  .svnExtra('cleanup')
                  .then((r) => props.onToast(r.message))
                  .catch((e: Error) => props.onToast((e as Error).message));
              },
            })
          }
        />
      )}
      <ToolBtn icon={<IconRefresh />} label="刷新" title="刷新" onClick={props.onRefresh} />
      {/* 低频操作收进「⋯」菜单（新建仓库 / Git 信息 / SVN 登录） */}
      <button
        className="mini tool-btn"
        title="更多操作（新建仓库 / Git 信息 / SVN 登录）"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMoreMenu({ x: Math.max(8, r.right - 180), y: r.bottom + 4 });
        }}
      >
        ⋯
      </button>
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          mask
          onClose={() => setMoreMenu(null)}
          items={[
            {
              icon: <IconPlus size={14} />,
              label: '新建仓库',
              action: () => {
                setMoreMenu(null);
                props.setModal({ type: 'create-repo' });
              },
            },
            {
              icon: <IconTag size={14} />,
              label: '标签',
              action: () => {
                setMoreMenu(null);
                props.setModal({ type: 'tags' });
              },
            },
            ...(repo?.type === 'git'
              ? [
                  {
                    icon: <IconGear size={14} />,
                    label: 'Git 信息与配置',
                    action: () => {
                      setMoreMenu(null);
                      props.setModal({ type: 'git-info' });
                    },
                  },
                ]
              : []),
            ...(repo?.type === 'svn'
              ? [
                  {
                    icon: <IconLogin size={14} />,
                    label: props.configUser ? `SVN 账号: ${props.configUser}` : 'SVN 登录',
                    action: () => {
                      setMoreMenu(null);
                      props.setModal({ type: 'login' });
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
      {/* ⑥ 退出 */}
      <Sep />
      <ToolBtn
        icon={<IconExit />}
        label="退出应用"
        title="关闭服务并退出应用"
        onClick={() =>
          props.setModal({
            type: 'confirm',
            title: '退出应用',
            message: '将关闭本地服务并退出应用（浏览器页面将无法访问）。确认退出？',
            action: () => {
              void post
                .shutdown()
                .then(() => {
                  // 先替换为提示页，再尝试关闭标签：关闭成功则页面瞬间消失；被浏览器拦截则提示页已就位
                  document.body.innerHTML =
                    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:10px;font-family:sans-serif;background:#0d1117;color:#e6edf3">' +
                    '<div style="font-size:20px">✅ 服务已退出</div>' +
                    '<div style="color:#8b949e">本地服务已关闭，此页面已无法使用，请手动关闭本标签页</div>' +
                    '</div>';
                  window.close();
                })
                .catch((e: Error) => props.onToast(`退出失败: ${e.message}`));
            },
          })
        }
      />
    </div>
  );
}
