/** 顶部工具栏：仓库信息 + 版本管理操作 + 主题/字号 + 打开项目/登录/退出 */
import React from 'react';
import { post, type RepoInfo } from './api.js';
import { IconBranch, IconTag, IconStash, IconPlus, IconClean, IconFolder, IconRefresh, IconLogin, IconExit, IconCommit } from './icons.js';
import { type Modal } from './modals.js';
import { type View } from './sidebar.js';

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
}) {
  return (
    <button className="tool-btn" title={props.title} onClick={props.onClick}>
      {props.icon} {props.label}
    </button>
  );
}

export function AppHeader(props: {
  view: View;
  repo: RepoInfo | null;
  conflictCount: number;
  configUser: string;
  theme: string;
  fontSize: number;
  setTheme: (t: string) => void;
  setFontSize: (s: number) => void;
  onRefresh: () => void;
  setModal: (m: Modal) => void;
  onToast: (m: string) => void;
  /** 推送（含进度窗口与认证引导） */
  onPush: () => void;
}) {
  const repo = props.repo;
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
      {props.conflictCount > 0 && (
        <ToolBtn
          icon={<IconClean />}
          label={`解决冲突 (${props.conflictCount})`}
          title="解决冲突文件"
          onClick={() => props.setModal({ type: 'conflicts' })}
        />
      )}
      {repo?.type === 'git' && (
        <>
          <ToolBtn icon={<IconStash />} label="Stash" title="Stash 暂存区" onClick={() => props.setModal({ type: 'stash' })} />
          <ToolBtn
            icon={<IconCommit />}
            label="推送"
            title="推送（git push，含进度与认证引导）"
            onClick={props.onPush}
          />
          <ToolBtn icon={<IconClean />} label="清理" title="清理未跟踪文件" onClick={() => props.setModal({ type: 'clean' })} />
        </>
      )}
      <ToolBtn icon={<IconBranch />} label="分支" title="分支管理" onClick={() => props.setModal({ type: 'branches' })} />
      <ToolBtn icon={<IconTag />} label="标签" title="标签管理" onClick={() => props.setModal({ type: 'tags' })} />
      <ToolBtn icon={<IconPlus />} label="新建仓库" title="创建/克隆仓库" onClick={() => props.setModal({ type: 'create-repo' })} />
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
      <button
        className="mini"
        title="切换字号"
        onClick={() => props.setFontSize(FONT_SIZES[(FONT_SIZES.indexOf(props.fontSize) + 1) % FONT_SIZES.length]!)}
      >
        A {props.fontSize}px
      </button>
      <span className="row small dim nowrap" style={{ gap: 6 }} title="切换主题">
        {THEMES.map((t) => (
          <button
            key={t.key}
            className={`theme-btn ${props.theme === t.key ? 'active' : ''}`}
            title={t.name}
            style={{ background: t.color }}
            onClick={() => props.setTheme(t.key)}
          />
        ))}
      </span>
      <ToolBtn icon={<IconRefresh />} label="刷新" title="刷新" onClick={props.onRefresh} />
      {repo?.type === 'git' && (
        <ToolBtn icon={<IconBranch />} label="Git" title="Git 信息与配置" onClick={() => props.setModal({ type: 'git-info' })} />
      )}
      <ToolBtn icon={<IconFolder />} label="打开项目" title="打开项目" onClick={() => props.setModal({ type: 'open' })} />
      {repo?.type === 'svn' && (
        <ToolBtn
          icon={<IconLogin />}
          label={props.configUser ? `SVN: ${props.configUser}` : 'SVN 登录'}
          title="SVN 账号设置"
          onClick={() => props.setModal({ type: 'login' })}
        />
      )}
      <ToolBtn
        icon={<IconExit />}
        label="退出应用"
        title="关闭服务并退出应用"
        onClick={() =>
          props.setModal({
            type: 'confirm',
            title: '退出应用',
            message: '将关闭本地服务并退出应用（浏览器页面将无法访问）。确认退出？',
            action: () => void post.shutdown(),
          })
        }
      />
    </div>
  );
}
