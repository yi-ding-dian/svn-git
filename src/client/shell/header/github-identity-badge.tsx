/** 顶栏 GitHub 身份徽标：查询 origin 仓库的身份与权限，只显示"需要注意"的三种状态。 */
import React, { useEffect, useState } from 'react';
import { get, type GitHubIdentityResult, type RepoInfo } from '../../shared/api.js';
import { parseGithub } from '../../../shared/github.js';
import { t, type I18nKey } from '../../../shared/i18n/index.js';

/** 顶栏 GitHub 身份徽标：/api/github-identity 的结果 → 显示什么（null = 不显示徽标）。
 *  **只返回 key，文案渲染时才 t()**（模块顶层求值会冻在首次语言，见 i18n/index.ts 头部）。
 *
 *  **自己名下的仓库一律不显示**（用户定稿）：那是绝大多数情况，等于没说，还白占顶栏一格。
 *  徽标只留"需要注意"的三种：协作者（不是你的仓库，但能推）、只读（推不上去）、无法访问（被删/无权限）。
 *  自己的身份与权限在「GitHub 仓库信息」弹窗里看得到，信息一点没丢。
 *  其余不显示的情况：origin 不是 GitHub、没配凭据（服务端根本没发请求）、
 *  断网 / 限流 / Token 无效（静默降级——装饰性信息不值得打扰用户）。 */
function githubBadgeOf(
  id: GitHubIdentityResult | null,
): { kind: 'collaborator' | 'read' | 'blocked'; textKey: I18nKey; tipKey: I18nKey } | null {
  if (!id?.isGithub || !id.hasAuth) return null;
  if (!id.ok) {
    // 只有 404 才显示（GitHub 有意不区分"不存在"与"凭据无权限"）；其余失败一律不显示
    return id.blocked
      ? { kind: 'blocked', textKey: 'shell.header.githubBlocked', tipKey: 'shell.header.githubTipBlocked' }
      : null;
  }
  if (id.isOwn) return null; // 自己的仓库：默认状态，不占地方
  // 能写但不是本人 = 协作者；其余能读到 = 只读
  if (id.canPush) return { kind: 'collaborator', textKey: 'shell.header.githubCollaborator', tipKey: 'shell.header.githubTipCollaborator' };
  return { kind: 'read', textKey: 'shell.header.githubRead', tipKey: 'shell.header.githubTipRead' };
}

/** 徽标本体：身份查询、项目切换清理、点击打开「GitHub 仓库信息」都在组件内收口。 */
export function GithubIdentityBadge({ repo, onOpen }: { repo: RepoInfo | null; onOpen: () => void }) {
  // 依赖用**字符串**——parseGithub 每次渲染都返回新对象，直接进 useEffect 依赖会无限重查
  const githubRepo = parseGithub(repo?.url ?? '');
  const githubRepoKey = githubRepo ? `${githubRepo.owner}/${githubRepo.repo}`.toLowerCase() : '';
  const [githubIdentity, setGithubIdentity] = useState<GitHubIdentityResult | null>(null);
  useEffect(() => {
    if (repo?.type !== 'git' || !githubRepoKey) {
      setGithubIdentity(null); // 非 git / 非 GitHub：清掉，不留上一个项目的徽标
      return;
    }
    let cancelled = false;
    setGithubIdentity(null); // 切项目先清旧值，避免短暂显示上一个仓库的身份
    get
      .githubIdentity()
      .then((r) => {
        if (!cancelled) setGithubIdentity(r);
      })
      .catch(() => {
        /* 查询失败：不显示徽标（装饰性信息，静默降级不弹错） */
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.type, githubRepoKey]);

  const badge = githubBadgeOf(githubIdentity);
  if (!badge) return null;
  return (
    <button
      className={`github-identity ${badge.kind}`}
      title={`${t(badge.tipKey, { login: githubIdentity?.login ?? '' })}${githubIdentity?.private ? t('shell.header.githubPrivateNote') : ''}${t('shell.header.githubTipClick')}`}
      onClick={onOpen}
    >
      {githubIdentity?.private ? '🔒' : ''}
      {t(badge.textKey)}
    </button>
  );
}
