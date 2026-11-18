/** 发布历史里的「容器镜像」区：Docker 项目的版本没有 Release assets，
 *  产物是 GHCR 镜像。这里列出当前标签对应的镜像地址，并提供复制 docker pull、
 *  打开 GitHub Packages 页面。CI 状态由外层按 tag 的运行记录传入。 */
import React, { useEffect, useState } from 'react';
import { IconCopy, IconExternal, IconPackage } from '../ui/icons.js';
import { t } from '../../shared/i18n/index.js';
import { get } from '../shared/api.js';
import { formatSize } from '../shared/format-size.js';
import type { GitHubReleaseCi, ReleaseDockerImage } from '../shared/api.js';

function formatPull(image: string, version: string): string {
  return `docker pull ${image}:${version}`;
}

/** GHCR 包页面：https://github.com/<owner>/<repo>/pkgs/container/<包名> */
function packageUrl(owner: string | undefined, repo: string | undefined, image: string): string {
  const pkg = image.split('/').pop() ?? '';
  if (!owner || !repo || !pkg) return '';
  return `https://github.com/${owner}/${repo}/pkgs/container/${encodeURIComponent(pkg)}`;
}

export function DockerImagesSection(props: {
  images: ReleaseDockerImage[];
  /** 版本标签，直接作为镜像 tag（CI 用 github.ref_name） */
  version: string;
  owner?: string;
  repo?: string;
  /** 该版本的 CI 状态 */
  ci?: GitHubReleaseCi;
  /** 交给外层用系统浏览器打开链接 */
  onOpen: (url: string) => void;
}) {
  const [copied, setCopied] = useState('');
  /** 镜像压缩后大小：按当前版本查询 GHCR，查不到就不显示 */
  const [sizes, setSizes] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setSizes({});
    if (!props.version) return;
    get
      .dockerImageSizes(props.version)
      .then((r) => {
        if (cancelled || !r.ok) return;
        const next: Record<string, number> = {};
        for (const x of r.sizes ?? []) next[x.name] = x.size;
        setSizes(next);
      })
      .catch(() => {
        /* 网络/私有仓库查询失败：不显示大小，不影响地址和拉取命令 */
      });
    return () => {
      cancelled = true;
    };
  }, [props.version]);

  if (props.images.length === 0) return null;

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1500);
    });
  };

  const building = props.ci?.status === 'queued' || props.ci?.status === 'in_progress';
  const failed =
    props.ci?.status === 'completed' && !!props.ci.conclusion && props.ci.conclusion !== 'success';

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span className="dim small">{t('repo.githubReleases.dockerTitle')}</span>
        <button
          className="mini"
          onClick={() =>
            copy(props.images.map((x) => formatPull(x.image, props.version)).join('\n'), '__all__')
          }
          title={props.images.map((x) => formatPull(x.image, props.version)).join('\n')}
        >
          <IconCopy size={14} />{' '}
          {copied === '__all__'
            ? t('repo.githubReleases.dockerCopied')
            : t('repo.githubReleases.dockerCopyAll')}
        </button>
      </div>

      {building && (
        <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>
          {t('repo.githubReleases.dockerBuilding')}
        </div>
      )}
      {failed && (
        <div className="small" style={{ color: 'var(--err)', marginTop: 6 }}>
          {t('repo.githubReleases.dockerFailed')}
        </div>
      )}

      {props.images.map((x) => {
        const full = `${x.image}:${props.version}`;
        const pull = formatPull(x.image, props.version);
        const pkg = packageUrl(props.owner, props.repo, x.image);
        return (
          <div
            key={x.name}
            className="row"
            style={{ gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' }}
          >
            <IconPackage size={14} />
            <span
              className="mono small"
              title={full}
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {full}
            </span>
            {(sizes[x.name] ?? 0) > 0 && (
              <span className="dim small" style={{ whiteSpace: 'nowrap' }}>
                {formatSize(sizes[x.name] ?? 0)}
              </span>
            )}
            <button className="mini" onClick={() => copy(pull, x.name)} title={pull}>
              <IconCopy size={14} />{' '}
              {copied === x.name
                ? t('repo.githubReleases.dockerCopied')
                : t('repo.githubReleases.dockerCopyPull')}
            </button>
            {pkg && (
              <button className="mini" onClick={() => props.onOpen(pkg)} title={pkg}>
                <IconExternal size={14} />
              </button>
            )}
          </div>
        );
      })}

      <div className="dim small" style={{ marginTop: 6, lineHeight: 1.6 }}>
        {t('repo.githubReleases.dockerHint')}
      </div>
    </div>
  );
}
