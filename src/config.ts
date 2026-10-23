/** 配置管理：~/.config/svngit/config.json（600 权限），存 SVN 账号密码 */
import fs from 'node:fs';
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
  };
  /** 界面语言。虽是「偏好」而非凭据，但 server / vcs / main 都要读它决定消息语言，
   *  而这三者与 config.json 同在主进程，故与凭据同放一处（本文件注释本就自称「全局配置 + 凭据」）。 */
  lang: Lang;
  /** 局域网共享（监听地址 / IP 白名单 / 在线人数上限），见 shared/share.ts */
  share: ShareConfig;
}

/** 配置目录（inflight.ts 的获取登记文件也放这里，同样属于「本机工具状态」） */
export const CONFIG_DIR = path.join(os.homedir(), '.config', 'svngit');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS: AppConfig = {
  svn: { username: '', password: '', trustServerCert: false },
  git: { username: '', password: '' },
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

function encode(pw: string): string {
  return Buffer.from(pw, 'utf8').toString('base64');
}

function decode(b64: string): string {
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
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
      },
      // 非法值（手改 config.json）一律回退默认，不让脏数据把界面搞成未知语言
      lang: isLang(data?.lang) ? data.lang : DEFAULT_LANG,
      share: readShare(data?.share),
    };
  } catch {
    return { ...DEFAULTS };
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
