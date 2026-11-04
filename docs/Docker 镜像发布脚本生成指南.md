# Docker 镜像发布脚本生成指南（给 AI 的提示词）

> 把这份文档交给 AI，并说明“请按这份指南为当前项目生成 Docker 镜像发布脚本”。
> 适用于**依赖多、服务多、无法打成单机安装包**的项目，例如 Python 后端 + 前端 +
> 数据库/对象存储/向量库的混合系统。
>
> 安装包型项目（Electron、Go 单文件、C++ 桌面程序等）请看
> [`发版脚本生成指南.md`](发版脚本生成指南.md)。

## 0. 使用方式

把本文件交给 AI，并说：

> 阅读 `docs/Docker 镜像发布脚本生成指南.md`，按它为当前项目生成 Docker 镜像发布配置。

AI 应自己完成：调研服务组成/启动方式/依赖 → 生成 Dockerfile 与 workflow →
在本地或 CI 手动触发验证 → 按第 10 节报告结果。

生成的文件需要**提交到仓库**后，应用里的「发布新版本」才能读到版本和镜像配置。

## 1. 什么时候用 Docker 镜像发布

| 项目形态 | 推荐方式 |
|---|---|
| 单文件可执行程序（Go、Rust、C++ 小工具） | 安装包 / 源码包，不需要 Docker |
| Electron / 桌面应用 | AppImage / exe / dmg |
| Python 后端 + 前端 + 数据库/中间件 | **Docker 镜像** |
| 需要系统依赖（libreoffice、poppler、chromium、CUDA） | **Docker 镜像** |
| 多服务需要一起启动 | **Docker 镜像 + compose** |
| 模型权重 / 数据文件很大 | **Docker 镜像**（权重走下载或挂载，不打进镜像） |
| 专用硬件、商业 SDK、必须人工交互构建 | GitHub Actions 无法自动化，需自建 runner |

判断标准：**用户能不能只靠 `docker pull` + 一份 compose 就跑起来**。
能，就走本指南；不能，先补齐容器化，再谈自动发布。

## 2. 目标产物

在项目根目录生成：

| 文件 | 必需 | 作用 |
|---|---|---|
| `.github/workflows/docker.yml` | 必需 | tag 触发，构建并推送镜像到 GHCR |
| `deploy/release-artifacts.json` | 必需 | 声明发布类型和镜像清单（应用读取） |
| `deploy/release.mjs` | 必需 | 应用内发版：升版本 → 提交 → 打 tag → 推送 |
| `package.json`（项目根） | 必需 | 应用读取当前版本号（硬约束） |
| `Dockerfile` / `docker/<服务>.Dockerfile` | 按服务 | 每个需要自建的服务一个 |
| `.dockerignore` | 必需 | 排除数据、依赖、密钥、大文件 |
| `docker-compose.release.yml` | 建议 | 用户拉镜像即启动，不需要源码 |
| `deploy/release.bat` / `release.sh` | 建议 | 手动发版入口 |

**`deploy/release.mjs` 仍然需要**：应用内「发布新版本」固定调用它完成
升版本、提交、打 tag、推送；Docker 只是把“构建产物”从安装包换成了镜像，
发版入口不变。

## 3. 应用端契约（必须严格遵守）

### 3.1 发版脚本

应用调用方式与安装包项目完全一致：

```bash
node <项目根>/deploy/release.mjs --patch --yes --note "发布说明" --no-watch
```

参数、分支规则、退出码、工作区检查等要求，见
[`发版脚本生成指南.md`](发版脚本生成指南.md) 第 2、3 节，不要另造一套。

### 3.2 版本来源

应用固定读取**项目根 `package.json` 的 `version`**：

```json
{
  "name": "your-project",
  "version": "0.1.0"
}
```

非 Node 项目也必须有这个文件，发版脚本同时更新它和项目自己的版本文件
（如 `pyproject.toml`、`CHANGELOG.md`、`deploy/version.json`）。

### 3.3 产物清单（Docker 类型）

`deploy/release-artifacts.json`：

```json
{
  "kind": "docker",
  "images": [
    { "name": "backend",  "image": "ghcr.io/${owner}/${repo}-backend" },
    { "name": "frontend", "image": "ghcr.io/${owner}/${repo}-frontend" },
    { "name": "ragas",    "image": "ghcr.io/${owner}/${repo}-ragas" }
  ],
  "items": []
}
```

- `kind`：`"docker"` 表示镜像发布；缺省按安装包处理；
- `images[].name`：矩阵里的服务名，必须与 workflow 的 matrix `name` 一致；
- `images[].image`：镜像仓库地址，`${owner}` / `${repo}` 由应用按 `origin` 替换；
- 版本号由应用在展示时拼到镜像后面：`<image>:<version>`；
- `items` 保留给安装包型产物；Docker 项目留空数组。

> 应用端「发布历史 → 容器镜像」区块按此格式读取；生成时务必保持字段名一致。

### 3.4 CI 状态

应用按 **tag 名**查询 GitHub Actions 的运行记录：

```
GET /repos/<owner>/<repo>/actions/runs
```

Docker 项目的 workflow 名建议固定为 `Docker`，文件名固定为
`.github/workflows/docker.yml`，便于应用和用户识别。

## 4. Dockerfile 规范

### 4.1 一个服务一个镜像

不要把后端、前端、数据库塞进同一个镜像。按职责拆：

- `backend`：应用代码 + 运行时；
- `frontend`：构建产物 + nginx；
- `ragas` / `worker` / `mcp`：独立进程各自一个；
- MySQL、Redis、MinIO、Milvus、Elasticsearch、Gotenberg 等：**直接用官方镜像**，
  不要自己构建。

### 4.2 多阶段构建

前端必须有 builder 阶段，运行镜像只保留静态产物：

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
```

Python 后端先装依赖再拷代码，利用层缓存：

```dockerfile
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
```

### 4.3 非 root 运行

```dockerfile
RUN useradd --create-home --uid 1000 --user-group app \
    && mkdir -p /app/data && chown -R app:app /app/data
USER app
```

uid 尽量用 1000，和宿主机普通用户对齐，bind mount 数据目录时不出现权限问题。

### 4.4 `.dockerignore`

必须排除：

```
data/
.venv/
venv/
__pycache__/
frontend/node_modules/
frontend/dist/
.env
.env.*
*.zip
.git/
参考/
docs/
tests/
```

**注意**：`.dockerignore` 排除父目录后，`!子文件` 例外规则不生效。
需要保留某个文件时，用 `docker/*` + `!docker/nginx.conf` 这种写法，
不要写 `docker/`。

### 4.5 不把敏感信息打进镜像

- `.env`、`.env.docker`、token、私钥一律排除；
- 运行时通过环境变量或挂载注入；
- 镜像里不要出现默认密码、真实地址、内部域名。

### 4.6 健康检查

compose 依赖健康检查决定启动顺序：

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:8091/api/health"]
  interval: 15s
  timeout: 5s
  retries: 5
  start_period: 20s
```

## 5. GitHub Actions 模板

### 5.1 完整 `docker.yml`

```yaml
name: Docker

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: '镜像标签（例如 v0.1.0）'
        required: true
        default: 'latest'

permissions:
  contents: read
  packages: write

jobs:
  build:
    name: ${{ matrix.name }}
    runs-on: ubuntu-latest
    timeout-minutes: 90
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: backend
            context: RAG
            dockerfile: RAG/docker/backend.Dockerfile
          - name: frontend
            context: RAG
            dockerfile: RAG/docker/frontend.Dockerfile
          - name: ragas
            context: RAGAS
            dockerfile: RAGAS/Dockerfile
    steps:
      - uses: actions/checkout@v4

      # GHCR 镜像名必须全小写
      - name: 计算镜像名与版本
        id: meta
        run: |
          echo "image=ghcr.io/${GITHUB_REPOSITORY,,}-${{ matrix.name }}" >> "$GITHUB_OUTPUT"
          echo "version=${{ inputs.version || github.ref_name }}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.dockerfile }}
          push: true
          tags: |
            ${{ steps.meta.outputs.image }}:${{ steps.meta.outputs.version }}
            ${{ steps.meta.outputs.image }}:latest
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}
          provenance: false
```

### 5.2 规则

- **matrix 与 `release-artifacts.json` 的 `images` 保持一致**；
- 镜像名统一 `ghcr.io/<owner>/<repo>-<服务>`，不要一个项目散落到多个 registry；
- 每个服务独立缓存 scope，避免互相覆盖；
- 默认只构建 `linux/amd64`；确认用户需要 arm64 再加 `platforms`，构建时间会翻倍；
- 构建失败时先看是 Dockerfile 路径、`.dockerignore`、还是依赖下载问题；
- `provenance: false` 避免旧版 docker 拉取时多一个 attestation manifest；
- 不要把 `GITHUB_TOKEN` 打印到日志。

### 5.3 可选：在 Release 里写拉取命令

如果项目同时维护 Release，可以在 docker job 后加一个 step，把拉取命令写进发布说明：

```yaml
      - name: 追加拉取命令
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1 || \
            gh release create "$GITHUB_REF_NAME" --generate-notes
          BODY="$(gh release view "$GITHUB_REF_NAME" --json body -q .body)"
          {
            printf '%s\n\n```bash\n' "$BODY"
            printf 'docker pull %s:%s\n' "${{ steps.meta.outputs.image }}" "${{ steps.meta.outputs.version }}"
            printf '```\n'
          } > /tmp/release-notes.md
          gh release edit "$GITHUB_REF_NAME" --notes-file /tmp/release-notes.md
```

Docker 镜像本身不挂 Release assets，只推 GHCR；Release 里放拉取命令即可。

## 6. `docker-compose.release.yml`（建议）

让用户不克隆源码也能启动：

```yaml
services:
  backend:
    image: ghcr.io/OWNER/REPO-backend:VERSION
    restart: unless-stopped
    env_file: .env
    ports:
      - "8091:8091"
    volumes:
      - ./data:/app/data
    extra_hosts:
      - "host.docker.internal:host-gateway"

  frontend:
    image: ghcr.io/OWNER/REPO-frontend:VERSION
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "80:80"
```

- `OWNER` / `REPO` / `VERSION` 在发版时替换，或提供 `.env`；
- 外部服务（MySQL、MinIO 等）单独一份 `docker-compose.infra.yml`，用官方镜像；
- 数据目录一律 bind mount 或 named volume，不放进镜像。

## 7. GHCR 包可见性

首次推送后，GitHub 上的包**默认是 private**，即使仓库是公开的。

- 公开仓库、希望匿名拉取：到仓库 → Packages → 对应包 → Settings →
  Danger Zone → Change visibility → Public；
- 私有仓库：用户必须先 `docker login ghcr.io -u <用户名> -p <PAT>`，
  PAT 需要 `read:packages`；
- 私有镜像不要误设为 Public，否则源码虽私有，镜像内容可能泄露。

## 8. 验收清单

生成后必须逐条验证：

1. `docker build -f <Dockerfile> <context>` 能在本地或 CI 成功；
2. 三个（或全部）镜像在 GitHub Actions 中构建成功；
3. 推 `v*` tag 后，GHCR 出现 `<image>:<版本>` 和 `:latest`；
4. 匿名 `docker pull` 能拉取（公开仓库）；私有仓库用 PAT 能拉取；
5. `docker run` 或 `docker compose -f docker-compose.release.yml up` 能启动；
6. 健康检查接口返回正常；
7. `.dockerignore` 确认 `.env`、数据目录、`node_modules`、大文件没有进镜像；
8. 应用「发布」→「发布新版本」：
   - 当前版本正确；
   - 「CI 将产出」显示 `release-artifacts.json` 里的镜像地址；
   - 发布后能查到 Actions 运行状态；
9. 新生成的文件（含根 `package.json`）已列出，并提醒用户提交；
10. 包可见性已按第 7 节处理。

## 9. 禁止事项

- 不要把 `.env`、token、私钥、真实内部地址打进镜像或提交到仓库；
- 不要用 root 运行应用进程；
- 不要把 `latest` 作为生产环境固定版本，生产应固定 `vX.Y.Z`；
- 不要自己构建 MySQL / Redis / MinIO / Milvus / ES 等官方镜像；
- 不要在 CI 日志里 `echo` token；
- 不要把大模型权重、数据集、`node_modules` 放进构建上下文；
- 不要跳过 `.dockerignore`，否则上下文可能几百 MB 甚至几 GB；
- 不要在没有用户确认时推送 tag 或修改 GHCR 可见性。

## 10. 给用户的最终报告

生成并验证完成后，报告：

- 项目服务组成与需要自建的镜像清单；
- 每个镜像的 Dockerfile 路径、基础镜像、预计体积；
- 哪些服务直接使用官方镜像；
- 生成的文件清单；
- 版本号同步了哪些文件；
- `release-artifacts.json` 的 `images` 配置；
- 验证结果（CI 运行链接、镜像 tag、`docker pull` 结果）；
- 包可见性当前状态（public / private）；
- 风险、假设和未完成项。
