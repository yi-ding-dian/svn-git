/** deploy/release-artifacts.json 的读取与规整。
 *
 *  同一个配置同时服务两类发布：
 *  - 安装包型：`items` 列出 CI 产物文件名；
 *  - Docker 型：`kind: "docker"` + `images` 列出镜像地址。
 *
 *  `${owner}` / `${repo}` 由服务端按 origin 解析后替换；`${version}` 留给前端按
 *  当前选择的版本替换。读取失败一律返回空配置，不影响发布弹窗的其它功能。 */
import fs from 'node:fs';
import path from 'node:path';

export interface ReleaseDockerImage {
  /** 服务名，与 workflow matrix 的 name 一致 */
  name: string;
  /** 镜像地址，可含 ${owner} / ${repo} 占位符 */
  image: string;
}

export interface ReleaseArtifacts {
  kind: 'package' | 'docker';
  /** 安装包产物模板 */
  items: string[];
  /** Docker 镜像清单 */
  images: ReleaseDockerImage[];
}

export const EMPTY_ARTIFACTS: ReleaseArtifacts = { kind: 'package', items: [], images: [] };

function clip(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 读取项目根 deploy/release-artifacts.json；没有或格式不对时返回空配置。 */
export function readReleaseArtifacts(root: string): ReleaseArtifacts {
  try {
    const raw = fs.readFileSync(path.join(root, 'deploy', 'release-artifacts.json'), 'utf8');
    const data = JSON.parse(raw) as { kind?: unknown; items?: unknown; images?: unknown };
    const items = Array.isArray(data.items)
      ? data.items
          .map((x) => clip(x))
          .filter(Boolean)
          .slice(0, 50)
      : [];
    const images = Array.isArray(data.images)
      ? data.images
          .map((x) => {
            const item = (x ?? {}) as Record<string, unknown>;
            return { name: clip(item.name, 60), image: clip(item.image) };
          })
          .filter((x) => x.name && x.image)
          .slice(0, 20)
      : [];
    return { kind: data.kind === 'docker' ? 'docker' : 'package', items, images };
  } catch {
    return { ...EMPTY_ARTIFACTS, items: [], images: [] };
  }
}

/** 替换镜像地址里的 owner / repo 占位符。
 *  GHCR 镜像名必须全小写，GitHub 的 owner/repo 本身不区分大小写（如 my-RAG），
 *  统一转小写后再拼，避免 `ghcr.io/.../my-RAG-backend` 拉不到。 */
export function resolveDockerImages(
  images: ReleaseDockerImage[],
  owner: string,
  repo: string,
): ReleaseDockerImage[] {
  const o = owner.toLowerCase();
  const r = repo.toLowerCase();
  return images.map((x) => ({
    name: x.name,
    image: x.image.replace(/\$\{owner\}/g, o).replace(/\$\{repo\}/g, r),
  }));
}

export interface ReleaseKindInfo {
  kind: 'package' | 'docker';
  /** config = 项目明确声明；heuristic = 按文件特征推荐；none = 无法判断 */
  source: 'config' | 'heuristic' | 'none';
  /** 判断依据（给界面展示） */
  evidence: string[];
}

/** 判断项目的发布方式：配置优先，没有配置时才按文件特征推荐。
 *  **实际发版只认 release-artifacts.json 的 kind**；heuristic 仅用于引导用户
 *  下载对应的指南，不能用于决定发版流程。 */
export function detectReleaseKind(root: string): ReleaseKindInfo {
  const configPath = path.join(root, 'deploy', 'release-artifacts.json');
  if (fs.existsSync(configPath)) {
    return {
      kind: readReleaseArtifacts(root).kind,
      source: 'config',
      evidence: ['deploy/release-artifacts.json'],
    };
  }

  const has = (rel: string) => fs.existsSync(path.join(root, rel));
  const dockerEvidence: string[] = [];
  const packageEvidence: string[] = [];

  for (const f of [
    '.github/workflows/docker.yml',
    '.github/workflows/docker.yaml',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.release.yml',
  ]) {
    if (has(f)) dockerEvidence.push(f);
  }
  try {
    const dockerDir = path.join(root, 'docker');
    for (const entry of fs.readdirSync(dockerDir, { withFileTypes: true })) {
      if (entry.isFile() && /\.Dockerfile$/i.test(entry.name)) {
        dockerEvidence.push(`docker/${entry.name}`);
      } else if (entry.isDirectory() && has(`docker/${entry.name}/Dockerfile`)) {
        dockerEvidence.push(`docker/${entry.name}/Dockerfile`);
      }
    }
  } catch {
    /* 没有 docker 目录 */
  }

  for (const f of [
    '.github/workflows/release.yml',
    '.github/workflows/release.yaml',
    'electron-builder.yml',
    'electron-builder.yaml',
    'electron-builder.json',
  ]) {
    if (has(f)) packageEvidence.push(f);
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      build?: unknown;
    };
    if (pkg.build) packageEvidence.push('package.json#build');
  } catch {
    /* 没有 package.json 或不是 JSON */
  }

  if (dockerEvidence.length > 0 && packageEvidence.length === 0) {
    return { kind: 'docker', source: 'heuristic', evidence: dockerEvidence.slice(0, 6) };
  }
  if (packageEvidence.length > 0 && dockerEvidence.length === 0) {
    return { kind: 'package', source: 'heuristic', evidence: packageEvidence.slice(0, 6) };
  }
  return {
    kind: 'package',
    source: 'none',
    evidence: [...dockerEvidence, ...packageEvidence].slice(0, 6),
  };
}
