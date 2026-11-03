/** 安全清理：离职/交接前删除本机保存的凭据与私钥配置。
 *
 *  **只处理应用自己管理的东西，不做递归目录删除**：
 *  - 私钥：只删配置指向的那一个文件及其 .pub，不碰 ~/.ssh 下的其他密钥；
 *  - ~/.ssh/config：只删应用标记段（见 ssh-config.ts）；
 *  - 全局 git 配置：只删 url.insteadOf 这一条（见 git-config.ts）；
 *  - config.json：清空密码/Token 字段，保留语言等界面偏好。
 *
 *  GitHub 上的公钥和 Token 无法从本机撤销，所以返回被删公钥的内容，
 *  由前端提示用户到 GitHub 手动删除/撤销。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig } from './config.js';
import { syncTerminalSshConfig } from './ssh-config.js';
import { setGithubInsteadOf } from './git-config.js';

export type CleanItem = 'key' | 'sshConfig' | 'insteadOf' | 'githubToken' | 'svnPassword' | 'history' | 'config';

export interface SecureCleanOptions {
  removeKey?: boolean;
  removeSshConfig?: boolean;
  removeInsteadOf?: boolean;
  clearGithubToken?: boolean;
  clearSvnPassword?: boolean;
  clearHistory?: boolean;
}

export interface SecureCleanResult {
  ok: boolean;
  removed: CleanItem[];
  failed: { item: CleanItem; error: string }[];
  /** 被删除私钥对应的公钥（清理前读取），供用户在 GitHub 上定位要删的那把 */
  publicKey: string;
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function secureClean(opts: SecureCleanOptions): SecureCleanResult {
  const removed: CleanItem[] = [];
  const failed: { item: CleanItem; error: string }[] = [];
  let publicKey = '';
  const cfg = loadConfig();
  const keyPath = cfg.git?.sshKeyPath?.trim() ?? '';

  // 私钥：先读公钥留档，再删私钥和 .pub；.git-ssh 目录空了就一并删掉（不递归）
  if (opts.removeKey && keyPath) {
    try {
      const pub = `${keyPath}.pub`;
      if (fs.existsSync(pub)) {
        try {
          publicKey = fs.readFileSync(pub, 'utf8').trim();
        } catch {
          /* 读不到不影响删除 */
        }
        fs.rmSync(pub, { force: true });
      }
      if (fs.existsSync(keyPath)) fs.rmSync(keyPath, { force: true });
      const parent = path.dirname(keyPath);
      if (path.basename(parent) === '.git-ssh' && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
        fs.rmdirSync(parent);
      }
      removed.push('key');
    } catch (err) {
      failed.push({ item: 'key', error: errorOf(err) });
    }
  }

  if (opts.removeSshConfig) {
    const r = syncTerminalSshConfig('', false);
    if (r.ok) removed.push('sshConfig');
    else failed.push({ item: 'sshConfig', error: r.error ?? '' });
  }

  if (opts.removeInsteadOf) {
    const r = setGithubInsteadOf(false);
    if (r.ok) removed.push('insteadOf');
    else failed.push({ item: 'insteadOf', error: r.error ?? '' });
  }

  // 配置字段：勾了删私钥就顺手清掉私钥路径与「终端使用」开关
  if (opts.clearGithubToken || opts.removeKey) {
    cfg.git = {
      username: cfg.git?.username ?? '',
      password: opts.clearGithubToken ? '' : (cfg.git?.password ?? ''),
      sshKeyPath: opts.removeKey ? '' : (cfg.git?.sshKeyPath ?? ''),
      sshUseForTerminal: opts.removeKey ? false : Boolean(cfg.git?.sshUseForTerminal),
    };
    if (opts.clearGithubToken) removed.push('githubToken');
  }
  if (opts.clearSvnPassword) {
    cfg.svn.password = '';
    removed.push('svnPassword');
  }
  try {
    saveConfig(cfg);
  } catch (err) {
    failed.push({ item: 'config', error: errorOf(err) });
  }

  if (opts.clearHistory) {
    try {
      fs.rmSync(path.join(os.homedir(), '.config', 'svngit', 'history.json'), { force: true });
      removed.push('history');
    } catch (err) {
      failed.push({ item: 'history', error: errorOf(err) });
    }
  }

  return { ok: failed.length === 0, removed, failed, publicKey };
}
