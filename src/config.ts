/** 配置管理：~/.config/svngit/config.json（600 权限），存 SVN 账号密码 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { isLang, DEFAULT_LANG, t, type Lang } from './shared/i18n/index.js';
import { DEFAULT_SHARE, type ShareConfig, type ShareMode } from './shared/share.js';

export interface AppConfig {
  svn: {
    username: string;
    password: string;
    /** https 自签名证书信任（svn --trust-server-cert） */
    trustServerCert: boolean;
  };
  /** Git 推送认证（GitHub token / 自建服务器用户名密码），base64 存储 */
  git?: {
    username: string;
    password: string;
    /** SSH 私钥路径（如项目内 .git-ssh/id_ed25519）：配置后 GitHub 的 SSH 传输用它；
     *  留空则走系统默认（~/.ssh）。私钥是本地文件路径，不是凭据本体，明文存即可 */
    sshKeyPath?: string;
    /** 终端 git 也使用该私钥：由应用维护 ~/.ssh/config 里的 GitHub 配置段（见 src/ssh-config.ts） */
    sshUseForTerminal?: boolean;
    /** GitHub 下载加速：下载地址前加这个前缀（第三方中转，仅建议公开仓库）。
     *  空串 = 用默认 https://gh-proxy.com/ */
    githubDownloadProxy?: boolean;
    githubDownloadProxyUrl?: string;
  };
  /** 界面语言。虽是「偏好」而非凭据，但 server / vcs / main 都要读它决定消息语言，
   *  而这三者与 config.json 同在主进程，故与凭据同放一处（本文件注释本就自称「全局配置 + 凭据」）。 */
  lang: Lang;
  /** 应用自身在线升级（GitHub Release） */
  update?: {
    /** GitHub 下载加速（第三方中转）：默认开。国内直连 GitHub Releases 常失败，
     *  而更新包动辄 75–90MB，所以和 git 下载加速分开存、默认勾选。 */
    githubDownloadProxy?: boolean;
    /** 加速前缀，空串 = 默认 https://gh-proxy.com/ */
    githubDownloadProxyUrl?: string;
  };
  /** 局域网共享（监听地址 / IP 白名单 / 在线人数上限），见 shared/share.ts */
  share: ShareConfig;
}

/** 配置目录（inflight.ts 的获取登记文件也放这里，同样属于「本机工具状态」） */
export const CONFIG_DIR = path.join(os.homedir(), '.config', 'svngit');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS: AppConfig = {
  svn: { username: '', password: '', trustServerCert: false },
  git: { username: '', password: '', sshKeyPath: '', sshUseForTerminal: false, githubDownloadProxy: false, githubDownloadProxyUrl: '' },
  // 应用自身升级默认走加速：与 git 下载加速（默认关）故意不同——更新包大且只在发版时下载
  update: { githubDownloadProxy: true, githubDownloadProxyUrl: '' },
  lang: DEFAULT_LANG,
  share: { ...DEFAULT_SHARE, allow: [] },
};

/** 共享配置的容错解析：手改 config.json 写出非法值时回退默认，不让脏数据把服务卡在未知状态 */
function readShare(data: unknown): ShareConfig {
  const raw = (data ?? {}) as Partial<ShareConfig>;
  const mode: ShareMode = raw.mode === 'lan' || raw.mode === 'custom' ? raw.mode : 'local';
  const allow = Array.isArray(raw.allow) ? raw.allow.filter((v): v is string => typeof v === 'string').slice(0, 64) : [];
  const n = Number(raw.maxViewers);
  return {
    mode,
    allow,
    maxViewers: Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 100) : DEFAULT_SHARE.maxViewers,
    readOnly: raw.readOnly === undefined ? DEFAULT_SHARE.readOnly : Boolean(raw.readOnly),
    allowSwitchProject: raw.allowSwitchProject === undefined
      ? DEFAULT_SHARE.allowSwitchProject
      : Boolean(raw.allowSwitchProject),
  };
}

/** 凭据加密（AES-256-GCM）：密文格式 `enc:v1:<base64(iv|tag|data)>`。
 *  密钥是本地随机生成的 32 字节文件（与 config.json 同目录、600 权限）；首次加密时创建。
 *  兼容旧版纯 base64 存储：读到没有前缀的值按 base64 解码（下次保存自动迁移成密文）。 */
const SECRET_KEY_PATH = path.join(CONFIG_DIR, 'secret.key');
let cachedKey: Buffer | null = null;

function credentialKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    const k = fs.readFileSync(SECRET_KEY_PATH);
    if (k.length === 32) {
      cachedKey = k;
      return k;
    }
  } catch {
    /* 首次运行：下面生成 */
  }
  const k = crypto.randomBytes(32);
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(SECRET_KEY_PATH, k, { mode: 0o600 });
    try {
      fs.chmodSync(SECRET_KEY_PATH, 0o600);
    } catch {
      /* Windows 等不支持 POSIX 权限：忽略 */
    }
  } catch {
    /* 写不进去（只读目录）：本次进程用内存密钥（重启后旧密文解不开，需重新输入凭据） */
  }
  cachedKey = k;
  return k;
}

function encode(pw: string): string {
  const key = credentialKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(pw, 'utf8'), c.final()]);
  return `enc:v1:${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')}`;
}

function decode(stored: string): string {
  if (stored.startsWith('enc:v1:')) {
    try {
      const buf = Buffer.from(stored.slice(7), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', credentialKey(), buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return '';
    }
  }
  // 旧版：base64（没有加密）
  try {
    return Buffer.from(stored, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS, update: { ...DEFAULTS.update } };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      svn: {
        username: String(data?.svn?.username ?? ''),
        password: data?.svn?.password ? decode(String(data.svn.password)) : '',
        trustServerCert: Boolean(data?.svn?.trustServerCert),
      },
      git: {
        username: String(data?.git?.username ?? ''),
        password: data?.git?.password ? decode(String(data.git.password)) : '',
        sshKeyPath: String(data?.git?.sshKeyPath ?? ''),
        sshUseForTerminal: Boolean(data?.git?.sshUseForTerminal),
        githubDownloadProxy: Boolean(data?.git?.githubDownloadProxy),
        githubDownloadProxyUrl: String(data?.git?.githubDownloadProxyUrl ?? ''),
      },
      update: {
        // 缺省 true：老配置文件里没有 update 段时，升级默认走加速
        githubDownloadProxy:
          data?.update?.githubDownloadProxy === undefined ? true : Boolean(data.update.githubDownloadProxy),
        githubDownloadProxyUrl: String(data?.update?.githubDownloadProxyUrl ?? ''),
      },
      // 非法值（手改 config.json）一律回退默认，不让脏数据把界面搞成未知语言
      lang: isLang(data?.lang) ? data.lang : DEFAULT_LANG,
      share: readShare(data?.share),
    };
  } catch {
    return { ...DEFAULTS, update: { ...DEFAULTS.update } };
  }
}

export function saveConfig(cfg: AppConfig): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const out = {
      svn: {
        username: cfg.svn.username,
        password: cfg.svn.password ? encode(cfg.svn.password) : '',
        trustServerCert: cfg.svn.trustServerCert,
      },
      git: {
        username: cfg.git?.username ?? '',
        password: cfg.git?.password ? encode(cfg.git.password) : '',
        sshKeyPath: cfg.git?.sshKeyPath ?? '',
        sshUseForTerminal: Boolean(cfg.git?.sshUseForTerminal),
        githubDownloadProxy: Boolean(cfg.git?.githubDownloadProxy),
        githubDownloadProxyUrl: cfg.git?.githubDownloadProxyUrl ?? '',
      },
      update: {
        // 只有显式 false 才关；缺省/脏值都按默认（开）处理
        githubDownloadProxy: cfg.update?.githubDownloadProxy !== false,
        githubDownloadProxyUrl: cfg.update?.githubDownloadProxyUrl ?? '',
      },
      lang: isLang(cfg.lang) ? cfg.lang : DEFAULT_LANG,
      share: readShare(cfg.share),
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2));
    fs.chmodSync(CONFIG_PATH, 0o600); // 仅本人可读写
  } catch (err) {
    // 保存配置失败: {msg}
    throw new Error(t('srv.saveConfigFailed', { msg: (err as Error).message }));
  }
}

export function configPath(): string {
  return CONFIG_PATH;
}
