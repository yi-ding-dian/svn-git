/** 顶部工具栏：仓库信息 + 版本管理操作 + 主题/字号 + 打开项目/登录/退出 */
import React, { useCallback, useEffect, useState } from 'react';
import { get, post, type RepoInfo } from './api.js';
import { IconBranch, IconGear, IconTag, IconStash, IconPlus, IconClean, IconFolder, IconRefresh, IconLogin, IconExit, IconCommit, IconFont } from './icons.js';
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

/**
 * 远程网络状态灯：30s 检测一次（get /api/net-check，只握手不取数据）。
 * 最近 3 次滑动窗口 → 全成功=绿、混合=黄（时通时断）、连续失败=红、未出结果=灰。
 * 认证失败=网络通的（绿，tooltip 说明）。点击圆点可立即手动检测。
 */
export function NetLight({ hostCheckKey }: { hostCheckKey?: string }) {
  const [lastResult, setLastResult] = useState<{ ok: boolean; reason: string; at: number } | null>(null);
  const [history, setHistory] = useState<boolean[]>([]);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await get.netCheck();
      setLastResult({ ok: r.ok, reason: r.reason, at: Date.now() });
      setHistory((h) => [...h.slice(-2), r.ok]); // 滚动保留最近 3 次
    } catch {
      setLastResult({ ok: false, reason: '检测请求失败', at: Date.now() });
      setHistory((h) => [...h.slice(-2), false]);
    } finally {
      setChecking(false);
    }
  }, []);

  // 30s 周期 + 仓库变化时立即检测；页签隐藏暂停、切回补检
  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [check, hostCheckKey]);

  const h = history;
  const n = h.length;
  let color = 'var(--dim)'; // 灰:未出结果
  let label = '检测中…';
  if (n > 0) {
    const allOk = h.every(Boolean);
    if (allOk && n >= 2) { color = 'var(--ok)'; label = '远程网络正常'; }
    else if (!allOk && !h.some(Boolean)) { color = 'var(--err)'; label = '远程网络断开'; }
    else { color = 'var(--warn)'; label = '远程网络不稳定（近期检测有成功有失败）'; }
    if (h[0] === true && n === 1) { color = 'var(--ok)'; label = '远程网络正常'; } // 首检成功即绿
  }
  const tip = lastResult
    ? `${label} · 最近检测 ${Math.max(0, Math.round((Date.now() - lastResult.at) / 1000))} 秒前${lastResult.reason !== '网络正常' ? `（${lastResult.reason}）` : ''}${checking ? ' · 检测中…' : ''} · 点击立即检测`
    : '网络状态检测中…';
  return (
    <span
      className="dim small nowrap"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      title={tip}
      onClick={() => void check()}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', background: color,
          boxShadow: color === 'var(--dim)' ? 'none' : `0 0 0 3px ${color}33`, display: 'inline-block',
        }}
      />
    </span>
  );
}

/** 顶部工具按钮（图标 + 文字，统一样式） */
function ToolBtn(props: {
  icon: React.ReactNode;
  label: React.ReactNode;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** 危险操作：红色强调（防误触,如退出应用） */
  danger?: boolean;
  /** 命令预览：悬浮按钮时显示将执行的命令（title 追加） */
  cmd?: string;
}) {
  return (
    <button
      className="tool-btn"
      title={props.cmd ? `${props.title ?? ''}

命令行: ${props.cmd}` : props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      style={props.danger ? { color: 'var(--err)' } : undefined}
    >
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
      {repo?.url ? <NetLight hostCheckKey={repo.url + repo.revOrBranch} /> : null}
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
            cmd="git push"
          />
          <ToolBtn icon={<IconStash />} label="Stash" title="Stash 暂存区" onClick={() => props.setModal({ type: 'stash' })} />
        </>
      )}
      {/* ③ 版本管理（分支高频保留；标签低频在 ⋯ 菜单） */}
      <Sep />
      <ToolBtn icon={<IconBranch />} label="分支" title="分支管理" onClick={() => props.setModal({ type: 'branches' })} />
      {/* ④ 维护 */}
      <Sep />
      {repo?.type === 'git' && (
        <ToolBtn icon={<IconClean />} label="清理" title="清理未跟踪文件" onClick={() => props.setModal({ type: 'clean' })} />
      )}
      {repo?.type === 'svn' && (
        <ToolBtn
          icon={<IconClean />}
          label="清理"
          title="svn cleanup"
          cmd="svn cleanup"
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
              icon: <IconFolder size={14} />,
              label: '打开项目',
              action: () => {
                setMoreMenu(null);
                props.setModal({ type: 'open' });
              },
            },
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
            {
              icon: <IconFont size={14} />,
              label: '字体设置',
              action: () => {
                setMoreMenu(null);
                props.setModal({ type: 'font' });
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
      {/* ⑥ 退出：危险样式红色强调,避免与高频「刷新」混同误触 */}
      <Sep />
      <ToolBtn
        icon={<IconExit />}
        label="退出应用"
        title="关闭服务并退出应用（危险）"
        danger
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
