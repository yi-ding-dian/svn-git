/** 「我的 GitHub 仓库」列表弹窗（顶栏 GitHub 图标入口；仅 origin 指向 github.com 的项目可见）。
 *  数据来自 /api/github-my-repos（服务端**不缓存**，每次打开现拉——刚新建的仓库要立刻可见），
 *  只列本人名下（含私有库）。当前项目对应的那一行会高亮并自动滚到可视区（否则十几个仓库里找不着）。
 *  双击 / 右键「克隆到本地…」→ 叠加复用「获取仓库」弹窗（地址与本地名已预填，目录选择/进度/取消
 *  全走原有克隆链路；取消 = 回到本列表）；右键另有「在浏览器打开」「复制地址」。
 *  列表滚动到底自动拉下一页（服务端按 GitHub 的 Link 头给 hasMore）。 */

import React, { useEffect, useRef, useState } from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { get, post, type GitHubMyRepo } from '../shared/api.js';
import { ContextMenu } from '../ui/context-menu.js';
import { IconGitHub, IconLock, IconUnlock, IconStar, IconClock, IconExternal, IconCopy, IconDownload } from '../ui/icons.js';
import { Tooltip } from '../ui/tooltip.js';
import { GetRepoDialog, type GetRepoParams } from './repo-create.js';
import { relTime } from './github-repo.js';
import { parseGithub } from '../../shared/github.js';
import { t } from '../../shared/i18n/index.js';

export function GitHubMyReposModal(props: {
  /** 当前项目的 origin（用来标出"当前项目"那一行）；空 = 当前没打开仓库 */
  currentUrl: string;
  /** 「获取仓库」弹窗的默认目录 */
  home?: string;
  onClose: () => void;
  onToast: (m: string, err?: boolean) => void;
  /** 克隆参数 → 由调用方发起后台获取任务（弹窗随即关闭；进度/取消/通知都归顶栏） */
  onStartGet: (p: GetRepoParams) => void;
}) {
  const [repos, setRepos] = useState<GitHubMyRepo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 没配凭据（服务端根本没发请求）：给配置引导，不显示成"查询失败" */
  const [noAuth, setNoAuth] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; repo: GitHubMyRepo } | null>(null);
  /** 要克隆的仓库（非 null = 叠加「获取仓库」弹窗，地址与本地名已预填） */
  const [clone, setClone] = useState<GitHubMyRepo | null>(null);
  const pageRef = useRef(1);
  const currentRef = useRef<HTMLDivElement | null>(null);

  const load = (page: number) => {
    if (page === 1) setBusy(true);
    else setLoadingMore(true);
    setErr('');
    get
      .githubMyRepos(page)
      .then((r) => {
        if (!r.ok) {
          // 失败时**保留已加载的页**：翻页失败不该把前面看过的列表清空
          setNoAuth(r.hasAuth === false);
          setErr(r.message ?? '');
          return;
        }
        setNoAuth(false);
        setRepos((prev) => (page === 1 ? (r.repos ?? []) : [...prev, ...(r.repos ?? [])]));
        setHasMore(r.hasMore === true);
        pageRef.current = page;
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => {
        setBusy(false);
        setLoadingMore(false);
      });
  };
  useEffect(() => {
    load(1); // 不缓存：每次打开现拉（刚在本工具里新建的仓库要立刻可见）
  }, []);

  /** 当前项目对应的仓库全名（小写）；用来标行 */
  const currentName = (() => {
    const g = parseGithub(props.currentUrl);
    return g ? `${g.owner}/${g.repo}`.toLowerCase() : '';
  })();
  // 首次渲染出列表后把当前项目那行滚进可视区（只做一次，之后不再抢滚动位置）
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !currentRef.current) return;
    scrolled.current = true;
    currentRef.current.scrollIntoView({ block: 'nearest' });
  });

  const kw = q.trim().toLowerCase();
  // 名字与描述都算（搜"桌宠"要能找到 Ai-desktop-pet——描述显示出来了却搜不到才别扭）
  const shown = kw
    ? repos.filter((r) => r.fullName.toLowerCase().includes(kw) || (r.description ?? '').toLowerCase().includes(kw))
    : repos;

  /** 走克隆链路：叠加「获取仓库」弹窗（地址/本地名预填） */
  const doClone = (repo: GitHubMyRepo) => setClone(repo);

  return (
    <ModalShell icon={<IconGitHub size={16} />} title={t('repo.githubMyRepos.title')} width={620} onClose={props.onClose} closeIcon hideFoot>
      {/* 工具行：搜索 + 数量；数量反映**当前筛选结果**，够用且不会和搜索框打架 */}
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="text" style={{ flex: 1, fontSize: 12 }} placeholder={t('repo.githubMyRepos.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="dim small nowrap">
          {t('repo.githubMyRepos.count', { n: shown.length })}
          {hasMore && !kw ? '+' : ''} · {t('repo.githubMyRepos.sortNote')}
        </span>
      </div>

      {busy ? (
        <div className="dim row" style={{ gap: 6, alignItems: 'center', padding: '8px 0' }}>
          <span className="search-spin" /> {t('repo.githubMyRepos.loading')}
        </div>
      ) : noAuth ? (
        <div className="small" style={{ color: 'var(--warn)', padding: '8px 0' }}>{t('repo.githubMyRepos.noAuth')}</div>
      ) : err && repos.length === 0 ? (
        <div className="error small" style={{ wordBreak: 'break-all', padding: '8px 0' }}>{err}</div>
      ) : (
        <>
          {/* 翻页/刷新失败：列表照常显示，原因如实说明在下方 */}
          {err && <div className="small" style={{ color: 'var(--warn)', marginBottom: 6, wordBreak: 'break-all' }}>⚠ {err}</div>}
          <div className="github-my-repos-list">
            {shown.length === 0 ? (
              <div className="dim small" style={{ padding: '10px 8px' }}>
                {kw ? t('repo.githubMyRepos.noMatch') : t('repo.githubMyRepos.empty')}
              </div>
            ) : (
              shown.map((r) => {
                const isCurrent = currentName !== '' && r.fullName.toLowerCase() === currentName;
                return (
                  <div
                    key={r.fullName}
                    ref={isCurrent ? currentRef : undefined}
                    className={`github-my-repos-row${isCurrent ? ' current' : ''}`}
                    title={r.description ?? ''}
                    onDoubleClick={() => doClone(r)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, repo: r });
                    }}
                  >
                    {/* 第一行：**不换行**（名字在里面收缩省略，不许把时间列挤下去——实测踩过：
                        shared_bike_server_173_9 名字 211px，第一行装不下时 flex-wrap 会先换行、
                        不收缩，结果时间列被挤到第二行、那行变成 3 行高）。
                        ⚠ 锁图标必须在这层里面：行本身是 column 布局，漏在外面它自己占一行 */}
                    <span className="github-my-repos-line">
                      <span className="dim" title={r.private ? t('repo.githubMyRepos.privateTip') : ''}>
                        {r.private ? <IconLock size={13} /> : <IconUnlock size={13} />}
                      </span>
                      {/* 名字自己带 title：整行的 title 是描述，长名字被省略号截了就看不到全名了 */}
                      <span className="github-my-repos-name mono" title={r.name}>{r.name}</span>
                      {/* 状态标记：本地 / 当前项目 / Fork / 归档（"这个仓库在你这里的处境"）。
                          单独包一层并给最小宽度——否则有无标记会把右边那几列推得参差 */}
                      <span className="github-my-repos-states">
                        {r.localPath && (
                          <Tooltip content={t('repo.githubMyRepos.localTip', { path: r.localPath })}>
                            <span className="github-my-repos-local">
                              ⬤ {t('repo.githubMyRepos.local')}
                            </span>
                          </Tooltip>
                        )}
                        {isCurrent && <span className="github-my-repos-tag current">{t('repo.githubMyRepos.currentProject')}</span>}
                        {r.archived && (
                          <Tooltip content={t('repo.githubMyRepos.archivedTip')}>
                            <span className="github-my-repos-tag">{t('repo.github.archived')}</span>
                          </Tooltip>
                        )}
                        {r.fork && (
                          <Tooltip content={t('repo.githubMyRepos.forkTip')}>
                            <span className="github-my-repos-tag">Fork</span>
                          </Tooltip>
                        )}
                      </span>
                      {/* 属性列：语言 / ★ / 最近推送（右对齐、各给最小宽度 → 各行竖着能对齐） */}
                      {r.language && (
                        <span className="github-my-repos-meta" style={{ minWidth: 76, textAlign: 'right' }}>
                          {r.language}
                        </span>
                      )}
                      <span className="github-my-repos-meta row" style={{ minWidth: 40, gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <IconStar size={12} /> {r.stars}
                      </span>
                      {r.pushedAt && (
                        <span className="github-my-repos-meta row" style={{ minWidth: 88, gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <IconClock size={12} /> {relTime(r.pushedAt)}
                        </span>
                      )}
                    </span>
                    {/* 第二行：描述（缩进到与名字左对齐）。放第二行才有整行宽度供它用——
                        一行里塞它和名字、状态、属性四样，谁都得挤着（实测：名字最长 229px、
                        描述最长 451px，而行宽只有 580px）。
                        没描述就不占这行——不写"（没有描述）"，那只是给一半的行添废话 */}
                    {r.description && <span className="github-my-repos-desc">{r.description}</span>}
                  </div>
                );
              })
            )}
          </div>
          {hasMore && !kw && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              <button className="mini" disabled={loadingMore} onClick={() => load(pageRef.current + 1)}>
                {loadingMore ? t('repo.githubMyRepos.loading') : t('repo.githubMyRepos.loadMore')}
              </button>
            </div>
          )}
          <div className="dim small" style={{ marginTop: 8 }}>{t('repo.githubMyRepos.hint')}</div>
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          onClose={() => setMenu(null)}
          items={[
            { icon: <IconDownload size={14} />, label: t('repo.githubMyRepos.menuClone'), action: () => doClone(menu.repo) },
            { icon: <IconExternal size={14} />, label: t('repo.githubMyRepos.menuOpen'), action: () => void post.openUrl(menu.repo.htmlUrl) },
            {
              icon: <IconCopy size={14} />,
              label: t('repo.githubMyRepos.menuCopy'),
              action: () => void navigator.clipboard?.writeText(menu.repo.cloneUrl).then(() => props.onToast(t('repo.githubMyRepos.copied'))),
            },
          ]}
        />
      )}

      {/* 克隆到本地：复用「获取仓库」弹窗（地址/本地名预填）；取消 = 回到本列表。
          点确认后任务交给调用方在后台发起——本列表也随即收起（跟⋯菜单那条入口行为一致） */}
      {clone && (
        <GetRepoDialog
          home={props.home}
          initialUrl={clone.cloneUrl}
          initialName={clone.name}
          onClose={() => setClone(null)}
          onStart={props.onStartGet}
        />
      )}
    </ModalShell>
  );
}
