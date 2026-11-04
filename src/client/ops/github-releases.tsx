/** GitHub 发布历史面板（由「发布」弹窗的 tab 承载）：卡片顶部的版本号本身就是下拉
 *  （默认最新），切换后下方只显示该版本的更新说明与产物。数据来自 /api/github-releases
 *  （服务端代问，5 分钟缓存，刷新可强制重拉）；没有 Release 的旧 tag 也可选，可下载源码。 */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { get, post, type GitHubReleasesResult, type GitHubTag } from '../shared/api.js';
import { IconExternal, IconPackage, IconCopy } from '../ui/icons.js';
import { HelpNote } from '../ui/ui.js';
import { ResultLine } from '../ui/result-line.js';
import { formatSize } from '../shared/format-size.js';
import { DockerImagesSection } from './docker-images.js';
import { relTime } from '../shared/relative-time.js';
import { t } from '../../shared/i18n/index.js';

const CARD: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: 12 };

/** Release 正文第一行作为下拉说明（过长截断）；没有正文返回空串 */
function noteOf(body: string): string {
  const first = (body || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

/** 面板对外暴露的操作：底部 foot 由外层「发布」弹窗统一渲染 */
export interface ReleasesPanelHandle {
  refresh: () => void;
  releasesUrl: () => string;
}

export const GitHubReleasesPanel = forwardRef<
  ReleasesPanelHandle,
  { onUrlChange: (url: string) => void; onCleanup: () => void }
>(function GitHubReleasesPanel({ onUrlChange, onCleanup }, ref) {
  const [data, setData] = useState<GitHubReleasesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 下拉选中值：`r:<tag>` = 有 Release，`t:<name>` = 只有 tag */
  const [selected, setSelected] = useState('');
  /** 刚复制过的地址：按钮短暂显示「已复制」 */
  const [copiedUrl, setCopiedUrl] = useState('');
  /** 下载加速开关 + 自定义加速前缀（空 = 默认 https://gh-proxy.com/） */
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyPrefix, setProxyPrefix] = useState('');
  const [proxyBusy, setProxyBusy] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    get
      .githubReleases(force)
      .then((r) => {
        setData(r);
        setError(r.ok ? '' : (r.error ?? ''));
        // 默认选最新 Release；没有 Release 就选最新的 tag。刷新后原选择仍有效则保留
        const firstRelease = r.releases?.[0]?.tagName;
        const firstTag = r.tags?.[0]?.name;
        const fallback = firstRelease ? `r:${firstRelease}` : firstTag ? `t:${firstTag}` : '';
        setSelected((prev) =>
          prev && (r.releases?.some((x) => `r:${x.tagName}` === prev) || r.tags?.some((x) => `t:${x.name}` === prev))
            ? prev
            : fallback,
        );
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  // 底部 foot 由外层弹窗渲染：把刷新操作和 Releases 页面地址暴露出去
  useImperativeHandle(ref, () => ({ refresh: () => load(true), releasesUrl: () => data?.releasesUrl ?? '' }), [data]);
  useEffect(() => {
    onUrlChange(data?.releasesUrl ?? '');
  }, [data, onUrlChange]);

  // 下载加速开关与地址（存在 config.json，跨弹窗/跨项目共用）
  useEffect(() => {
    get
      .gitDownloadProxy()
      .then((r) => {
        setProxyEnabled(r.enabled);
        setProxyPrefix(r.prefix);
      })
      .catch(() => {});
  }, []);

  const saveProxy = (enabled: boolean, prefix: string) => {
    if (proxyBusy) return;
    setProxyBusy(true);
    setProxyEnabled(enabled);
    void post
      .gitDownloadProxySave(enabled, prefix)
      .then((r) => {
        setProxyEnabled(r.enabled);
        setProxyPrefix(r.prefix);
      })
      .catch(() => {
        /* 保存失败保持界面现状 */
      })
      .finally(() => setProxyBusy(false));
  };

  const toggleProxy = (checked: boolean) => saveProxy(checked, proxyPrefix);

  const open = (url: string) => {
    if (url) void post.openUrl(url).catch(() => {});
  };

  /** 实际使用的下载地址：开启加速且是 GitHub Release 产物时加自定义前缀
   *  （空前缀回退到 https://gh-proxy.com/）。只给 releases/download 地址加。 */
  const actualUrl = (url: string) => {
    if (!proxyEnabled || !/^https:\/\/github\.com\/.*\/releases\/download\//.test(url)) return url;
    const base = (proxyPrefix.trim() || 'https://gh-proxy.com/').replace(/\/+$/, '');
    return `${base}/${url}`;
  };

  /** 下载：新标签打开（真实鼠标点击不会被弹窗拦截；隐藏 iframe 在 deepin 浏览器里会
   *  一直卡在"等待响应"、不进下载列表，同页 <a> 又会把应用页面导航走）。
   *  浏览器识别 GitHub 的 attachment 后直接进下载列表。 */
  const download = (url: string) => {
    if (!url) return;
    window.open(actualUrl(url), '_blank', 'noopener');
  };

  const copyUrl = (url: string) => {
    if (!url) return;
    void navigator.clipboard?.writeText(actualUrl(url)).then(() => {
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl(''), 1500);
    });
  };

  const releases = data?.releases ?? [];
  const tags = data?.tags ?? [];
  const dockerImages = data?.dockerImages ?? [];
  const hasVersions = releases.length > 0 || tags.length > 0;
  /** 有 Release assets 才需要「下载加速」（只作用于 releases/download 地址） */
  const hasDownloadableAssets = releases.some((r) => r.assets.length > 0);
  const rel = releases.find((r) => `r:${r.tagName}` === selected);
  const tag = tags.find((x) => `t:${x.name}` === selected);

  /** tag 下拉后缀：按 CI 状态区分构建中 / 构建失败 / 已完成待同步 / 仅标签 */
  const tagSuffix = (tag: GitHubTag) => {
    const ci = tag.ci;
    if (ci?.status === 'queued') return t('repo.githubReleases.tagQueued');
    if (ci?.status === 'in_progress') return t('repo.githubReleases.tagBuilding');
    if (ci?.status === 'completed') {
      if (ci.conclusion === 'success') {
        // Docker 项目没有 Release assets，成功即镜像可拉取，不提示"同步中"
        return dockerImages.length > 0
          ? t('repo.githubReleases.tagBuilt')
          : t('repo.githubReleases.tagSyncing');
      }
      if (ci.conclusion) return t('repo.githubReleases.tagFailed');
    }
    return t('repo.githubReleases.tagOnlySuffix');
  };

  /** 版本选择器：卡片顶部原来的版本号位置，默认最新 */
  const versionSelect = (
    <select
      value={selected}
      onChange={(e) => setSelected(e.target.value)}
      title={t('repo.githubReleases.versionLabel')}
      style={{
        padding: '3px 8px',
        background: 'var(--panel2)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 700,
        minWidth: 360,
        maxWidth: '80%',
      }}
    >
      {releases.map((r, i) => (
        <option key={`r:${r.tagName}`} value={`r:${r.tagName}`}>
          {r.name || r.tagName}
          {i === 0 && !r.prerelease && !r.draft ? `（${t('repo.githubReleases.latest')}）` : ''}
          {r.prerelease ? `（${t('repo.githubReleases.prerelease')}）` : ''}
          {noteOf(r.body) ? ` · ${noteOf(r.body)}` : ''}
        </option>
      ))}
      {tags.map((x) => (
        <option key={`t:${x.name}`} value={`t:${x.name}`}>
          {x.name}{tagSuffix(x)}
        </option>
      ))}
    </select>
  );

  return (
    <>
          {loading && <div className="loading">{t('repo.githubReleases.loading')}</div>}
          {!loading && error && <ResultLine msg={error} err />}
          {!loading && !error && !hasVersions && <HelpNote>{t('repo.githubReleases.empty')}</HelpNote>}

          {!loading && !error && rel && (
            <div style={CARD}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                {versionSelect}
                <span className="dim small" style={{ whiteSpace: 'nowrap' }}>
                  {rel.publishedAt ? relTime(rel.publishedAt) : ''}
                </span>
              </div>
              {/* 版本名与 tag 不同名时才显示 tag（同名再写一遍纯属重复） */}
              {rel.name && rel.name !== rel.tagName && (
                <div className="dim small mono" style={{ marginTop: 2 }}>{rel.tagName}</div>
              )}

              <div style={{ marginTop: 10 }}>
                <div className="dim small">{t('repo.githubReleases.assets', { n: rel.assets.length })}</div>
                {rel.assets.map((a) => (
                  <div
                    key={a.name}
                    className="row"
                    style={{ gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' }}
                  >
                    <IconPackage size={14} />
                    {/* 产物文件名 */}
                    <span
                      className="mono small"
                      title={a.name}
                      style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {a.name}
                    </span>
                    <span className="dim small" style={{ whiteSpace: 'nowrap' }}>{formatSize(a.size)}</span>
                    <span className="dim small" style={{ whiteSpace: 'nowrap' }}>⬇ {a.downloadCount}</span>
                    {/* 复制下载地址（短暂显示「已复制」） */}
                    <button
                      className="mini"
                      onClick={() => copyUrl(a.downloadUrl)}
                      title={`${t('repo.githubReleases.copyUrl')}\n${actualUrl(a.downloadUrl)}`}
                    >
                      <IconCopy size={14} /> {copiedUrl === a.downloadUrl ? t('repo.githubReleases.copied') : t('repo.githubReleases.copyUrl')}
                    </button>
                    {/* 下载：当前浏览器直接下载；悬浮显示完整地址 */}
                    <button className="mini" onClick={() => download(a.downloadUrl)} title={actualUrl(a.downloadUrl)}>
                      {t('repo.githubReleases.download')}
                    </button>
                  </div>
                ))}
                <div className="row" style={{ gap: 10, marginTop: 8 }}>
                  {/* 源码 zip / 源码 tar.gz / Release 页面：源码走当前浏览器下载，页面走系统浏览器 */}
                  <button className="mini" onClick={() => download(rel.zipballUrl)} title={actualUrl(rel.zipballUrl)}>{t('repo.githubReleases.sourceZip')}</button>
                  <button className="mini" onClick={() => download(rel.tarballUrl)} title={actualUrl(rel.tarballUrl)}>{t('repo.githubReleases.sourceTar')}</button>
                  <button className="mini" onClick={() => open(rel.htmlUrl)} title={rel.htmlUrl}>
                    <IconExternal size={14} /> GitHub
                  </button>
                  {/* 当前版本有产物才显示「清理产物」；仅标签/无产物不显示 */}
                  {rel.assets.length > 0 && (
                    <button className="mini danger" style={{ marginLeft: 'auto' }} onClick={onCleanup}>
                      {t('ops.releaseCleanup.entry')}
                    </button>
                  )}
                </div>
              </div>
              {/* Docker 项目：产物是 GHCR 镜像，按当前版本拼镜像地址 */}
              <DockerImagesSection
                images={dockerImages}
                version={rel.tagName}
                owner={data?.owner}
                repo={data?.repo}
                ci={rel.ci}
                onOpen={open}
              />
            </div>
          )}

          {!loading && !error && tag && (
            <div style={CARD}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                {versionSelect}
                <span className="dim small mono">{tag.sha.slice(0, 7)}</span>
              </div>
              {/* 根据 CI 状态说明为什么还没有产物：构建中 / 构建失败 / 已完成待同步 / 仅标签 */}
              {tag.ci && (tag.ci.status === 'queued' || tag.ci.status === 'in_progress') ? (
                <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
                  {t('repo.githubReleases.ciBuilding')}
                </div>
              ) : tag.ci?.status === 'completed' && tag.ci.conclusion === 'success' ? (
                <div
                  className="small"
                  style={{ color: dockerImages.length > 0 ? 'var(--ok)' : 'var(--warn)', marginTop: 8 }}
                >
                  {dockerImages.length > 0
                    ? t('repo.githubReleases.dockerBuilt')
                    : t('repo.githubReleases.ciSyncing')}
                </div>
              ) : tag.ci?.status === 'completed' && tag.ci.conclusion ? (
                <div className="small" style={{ color: 'var(--err)', marginTop: 8 }}>
                  {t('repo.githubReleases.ciFailed')}
                </div>
              ) : (
                <div className="dim small" style={{ marginTop: 8 }}>{t('repo.githubReleases.tagOnly')}</div>
              )}
              <div className="row" style={{ gap: 10, marginTop: 10 }}>
                <button className="mini" onClick={() => open(tag.commitUrl)} title={tag.commitUrl}>
                  <IconExternal size={14} /> GitHub
                </button>
                {tag.ci?.htmlUrl && (
                  <button className="mini" onClick={() => open(tag.ci!.htmlUrl)} title={tag.ci!.htmlUrl}>
                    {t('repo.githubReleases.viewCi')}
                  </button>
                )}
                <button className="mini" onClick={() => download(tag.zipballUrl)} title={actualUrl(tag.zipballUrl)}>{t('repo.githubReleases.sourceZip')}</button>
                <button className="mini" onClick={() => download(tag.tarballUrl)} title={actualUrl(tag.tarballUrl)}>{t('repo.githubReleases.sourceTar')}</button>
              </div>
              {/* 仅标签的 Docker 项目：CI 成功后镜像可用，状态提示在上面统一显示 */}
              <DockerImagesSection
                images={dockerImages}
                version={tag.name}
                owner={data?.owner}
                repo={data?.repo}
                onOpen={open}
              />
            </div>
          )}

          {!loading && !error && hasDownloadableAssets && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={proxyEnabled}
                  disabled={proxyBusy}
                  onChange={(e) => toggleProxy(e.target.checked)}
                />
                {/* 下载加速 */}
                {t('repo.githubReleases.proxy')}
              </label>
              {proxyEnabled && (
                <>
                  <div className="row" style={{ gap: 8, marginTop: 6 }}>
                    {/* 加速地址前缀：空 = 默认 https://gh-proxy.com/ */}
                    <input
                      type="text"
                      value={proxyPrefix}
                      placeholder={t('repo.githubReleases.proxyPlaceholder')}
                      onChange={(e) => setProxyPrefix(e.target.value)}
                      onBlur={() => saveProxy(proxyEnabled, proxyPrefix)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      disabled={proxyBusy}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '4px 8px',
                        background: 'var(--panel2)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                  </div>
                  {/* ⚠ 文件会经过第三方服务器，理论上它能看到下载内容；公开仓库没问题，私有仓库请谨慎开启。 */}
                  <div className="small" style={{ color: 'var(--warn)', marginTop: 6, lineHeight: 1.6 }}>
                    {t('repo.githubReleases.proxyRisk')}
                  </div>
                </>
              )}
            </div>
          )}
    </>
  );
});
