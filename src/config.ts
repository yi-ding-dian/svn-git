/** 配置管理：~/.config/svnkit/config.json（600 权限），存 SVN 账号密码 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'svnkit');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS: AppConfig = { svn: { username: '', password: '', trustServerCert: false }, git: { username: '', password: '' } };

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
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2));
    fs.chmodSync(CONFIG_PATH, 0o600); // 仅本人可读写
  } catch (err) {
    throw new Error(`保存配置失败: ${(err as Error).message}`);
  }
}

export function configPath(): string {
  return CONFIG_PATH;
}
