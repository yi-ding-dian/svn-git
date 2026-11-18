/** 发布 / 打包 / GitHub Release / Docker 镜像相关 API。 */
import { api, json } from './core.js';

/** GitHub 发布历史（/api/github-releases） */
export interface GitHubReleaseAsset {
  name: string;
  size: number;
  downloadCount: number;
  /** browser_download_url：点「下载」用系统浏览器打开 */
  downloadUrl: string;
  createdAt: string | null;
}

/** 发布产物：Docker 项目的镜像地址（/api/release、/api/github-releases） */
export interface ReleaseDockerImage {
  /** 服务名（与 workflow matrix 的 name 一致） */
  name: string;
  /** 镜像地址，展示时拼上 `:<版本>` */
  image: string;
}

/** 镜像压缩后大小（/api/docker-image-sizes），0 = 查询失败不显示 */
export interface DockerImageSize {
  name: string;
  image: string;
  size: number;
}

export interface DockerImageSizesResult {
  ok: boolean;
  sizes?: DockerImageSize[];
}

export interface GitHubRelease {
  tagName: string;
  name: string;
  publishedAt: string | null;
  htmlUrl: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
  zipballUrl: string;
  tarballUrl: string;
  /** 该 tag 的 CI 状态（Docker 镜像没有 Release assets，靠它显示进度） */
  ci?: GitHubReleaseCi;
}

/** CI 运行状态（Release 与 tag 共用） */
export interface GitHubReleaseCi {
  /** queued | in_progress | completed */
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  /** 失败步骤名（如「安装依赖」）；具体报错正文需登录 GitHub 查看 */
  failedStep?: string;
}

export interface GitHubReleasesResult {
  ok: boolean;
  error?: string;
  /** 认证类失败（401：GitHub Token 无效/过期）：界面给出「重新生成 Token」入口 */
  authError?: boolean;
  remote?: string;
  /** 仓库 Releases 页面（「在 GitHub 打开」用） */
  releasesUrl?: string;
  /** origin 的 owner/repo（拼 GHCR 包地址用） */
  owner?: string;
  repo?: string;
  releases?: GitHubRelease[];
  /** 没有对应 Release 的 tag（早期版本只有 tag、没有发布说明） */
  tags?: GitHubTag[];
  /** 项目声明为 Docker 发布时的镜像清单；空数组/缺省表示安装包型项目 */
  dockerImages?: ReleaseDockerImage[];
}

/** 批量清理：保留最近 N 个版本后，更早版本里可删除的产物 */
export interface ReleaseCleanupRelease {
  tagName: string;
  publishedAt: string;
  assets: { id: number; name: string; size: number }[];
}

export interface ReleaseCleanupPreview {
  ok: boolean;
  error?: string;
  keep?: number;
  releases?: ReleaseCleanupRelease[];
  totalAssets?: number;
  totalSize?: number;
}

/** 一键发版预检（/api/release） */
export interface ReleaseInfo {
  ok: boolean;
  version: string;
  branch: string;
  /** 已跟踪文件有未提交改动（脚本会拒绝发版） */
  dirty: boolean;
  /** 默认发布说明（上个 tag 以来最新提交主题） */
  note: string;
  /** 上个 tag 以来的提交主题（最多 8 条） */
  commits: string[];
  /** 项目自定义的 CI 产物清单（deploy/release-artifacts.json），可含 ${version} 占位符 */
  artifacts?: string[];
  /** 是否已接入一键发版（本地有 deploy/release.mjs）；false 时显示引导页 */
  supported?: boolean;
  /** origin 是否 GitHub：非 GitHub 也能发版，只是不轮询 Actions */
  isGithub?: boolean;
  /** 发布类型：package = 安装包，docker = 容器镜像 */
  kind?: 'package' | 'docker';
  /** 类型来源：config = release-artifacts.json；heuristic = 文件特征推荐；none = 无法判断 */
  kindSource?: 'config' | 'heuristic' | 'none';
  /** 类型判断依据（文件名） */
  kindEvidence?: string[];
  /** 推荐下载的指南 */
  guide?: 'package' | 'docker';
  /** 缺少或未推送到 origin/main 的发版文件 */
  missing?: string[];
  /** Docker 项目的镜像清单（${owner}/${repo} 已由服务端替换，${version} 由前端替换） */
  images?: ReleaseDockerImage[];
  /** CI 文件是否已推送到 origin/main；false 时发布只能打标签，不会出包 */
  ciReady?: boolean;
  /** 未推送到 origin/main 的发版相关文件 */
  ciMissing?: string[];
  /** 项目是否存在 .github/workflows 发布工作流 */
  ciHasWorkflow?: boolean;
  next: { patch: string; minor: string; major: string };
}

/** 本地打包：检测到的打包脚本（/api/local-build/detect） */
export interface LocalBuildDetect {
  found: boolean;
  script?: string;
  kind?: 'sh' | 'bat';
  mtime?: string;
  /** found=false 时列出检查过的位置 */
  searched?: string[];
  /** 用户手动指定脚本校验失败的原因（仓库内/存在性/扩展名）。
   *  用 reason 而不是 error：api() 约定「响应体带 error 就抛异常」，这里要正常展示 */
  reason?: string;
  /** 应用内文件浏览弹窗的起始目录（deploy 存在用 deploy，否则仓库根） */
  startDir?: string;
  /** 仓库根（文件浏览的浏览下界） */
  root?: string;
}

/** 本地打包产物（完成事件里带回） */
export interface LocalBuildArtifact {
  path: string;
  size: number;
  mtime: string;
}

/** 本地打包 NDJSON 事件（/api/local-build/run） */
export type LocalBuildEvent =
  | { type: 'start'; script: string; startedAt: number }
  | { type: 'log'; stream: 'stdout' | 'stderr'; line: string }
  | {
      type: 'done';
      ok: boolean;
      code: number;
      durationMs: number;
      timedOut?: boolean;
      aborted?: boolean;
      truncated?: boolean;
      artifacts: LocalBuildArtifact[];
    }
  | { type: 'error'; message: string };

/** 没有 Release 的版本标签 */
export interface GitHubTag {
  name: string;
  sha: string;
  commitUrl: string;
  zipballUrl: string;
  tarballUrl: string;
  /** 该 tag 的 CI 状态：区分「构建中 / 构建失败 / 仅标签」 */
  ci?: GitHubReleaseCi;
}

export const getRelease = {
  /** 发布历史（版本 + 产物下载地址）；force=1 跳过 5 分钟缓存 */
  githubReleases: (force?: boolean) => api<GitHubReleasesResult>(`/api/github-releases${force ? '?force=1' : ''}`),
  /** 批量清理预览：保留最近 keep 个版本，更早版本的产物 */
  githubReleaseCleanup: (keep: number) =>
    api<ReleaseCleanupPreview>(`/api/github-release-cleanup?keep=${keep}`),
  /** 一键发版预检：当前版本 / 默认说明 / 工作区状态 */
  releaseInfo: () => api<ReleaseInfo>('/api/release'),
  /** 生成「完整指南 + 项目根 + 确认要求」的 AI 提示词，供引导页复制 */
  releaseGuidePrompt: () =>
    api<{ ok: boolean; text?: string; error?: string }>('/api/release-guide-prompt'),
  dockerImageSizes: (tag: string) =>
    api<DockerImageSizesResult>(`/api/docker-image-sizes?tag=${encodeURIComponent(tag)}`),
  /** 查某个 tag 的 CI 运行状态（发布后台任务轮询） */
  releaseStatus: (tag: string) =>
    api<{
      ok: boolean;
      error?: string;
      status: 'pending' | 'queued' | 'in_progress' | 'completed';
      conclusion: string | null;
      htmlUrl: string;
      artifacts: { name: string; size: number }[];
      /** Release 上的产物数量（用户能下载的 assets）；缺省 = 还没查到/没有 Release */
      releaseAssets?: number;
    }>(`/api/release-status?tag=${encodeURIComponent(tag)}`),
  /** 本地打包：检测项目里的打包脚本；传 script 时校验用户手动指定的脚本 */
  localBuildDetect: (script?: string) =>
    api<LocalBuildDetect>(`/api/local-build/detect${script ? `?script=${encodeURIComponent(script)}` : ''}`),
  /** GitHub 下载加速开关 + 自定义加速前缀（发布历史用） */
  gitDownloadProxy: () => api<{ enabled: boolean; prefix: string }>('/api/git-download-proxy'),
};

export const postRelease = {
  /** 执行批量清理：只删旧 Release 的产物 */
  githubReleaseCleanupRun: (keep: number) =>
    api<{ ok: boolean; deleted: number; failed: { name: string; error: string }[]; error?: string }>(
      '/api/github-release-cleanup',
      json({ keep }),
    ),
  /** 执行一键发版（实际调用 deploy/release.mjs） */
  releaseRun: (level: 'patch' | 'minor' | 'major', note: string) =>
    api<{ ok: boolean; message: string; timedOut?: boolean }>('/api/release-run', json({ level, note })),
  /** 本地打包：执行项目打包脚本，逐行回调 NDJSON 事件。
   *  script 可选（用户手动指定的脚本，绝对路径或仓库相对路径）；缺省用自动检测结果。
   *  signal 取消 → 断开请求 → 服务端杀掉打包进程组。Promise 在流结束时 resolve；
   *  HTTP 非 2xx（没有脚本 / 已有任务在跑 / 指定的脚本不合法）抛 Error（取消时抛的是 AbortError）。 */
  localBuildRun: async (onEvent: (ev: LocalBuildEvent) => void, signal?: AbortSignal, script?: string): Promise<void> => {
    const res = await fetch('/api/local-build/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(script ? { script } : {}),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 非 JSON：保留状态码 */
      }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          onEvent(JSON.parse(l) as LocalBuildEvent);
        } catch {
          /* 半行/坏行：忽略 */
        }
      }
    }
    if (buf.trim()) {
      try {
        onEvent(JSON.parse(buf) as LocalBuildEvent);
      } catch {
        /* 尾部残行：忽略 */
      }
    }
  },
  /** 开启/关闭 GitHub 下载加速（prefix 空 = 默认 gh-proxy.com） */
  gitDownloadProxySave: (enabled: boolean, prefix: string) =>
    api<{ ok: boolean; enabled: boolean; prefix: string }>('/api/git-download-proxy', json({ enabled, prefix })),
};
