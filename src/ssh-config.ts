/** 终端 SSH 配置同步：让命令行 git 也能使用应用里配置的 GitHub 私钥。
 *
 *  只维护 ~/.ssh/config 里一段带标记的配置，其他内容原样保留：
 *      # >>> svngit GitHub SSH (auto-managed) >>>
 *      Host github.com
 *        IdentityFile "/path/to/key"
 *      # <<< svngit GitHub SSH <<<
 *
 *  为什么需要它：应用调用 git 时会注入 GIT_SSH_COMMAND -i；但用户在终端直接敲
 *  git pull 不会读应用配置，只能靠 ~/.ssh/config。这里把同一把私钥登记到系统
 *  SSH 配置，两处保持一致。只影响 github.com，不碰其他主机。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BEGIN = '# >>> svngit GitHub SSH (auto-managed) >>>';
const END = '# <<< svngit GitHub SSH <<<';

/** ~/.ssh/config 路径（每次读取时取，便于测试切换 HOME） */
function sshConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config');
}

/** 删除受管段（标记不完整时不碰，避免误删用户配置） */
function removeBlock(content: string): string {
  const start = content.indexOf(BEGIN);
  if (start === -1) return content;
  const end = content.indexOf(END, start);
  if (end === -1) return content;
  let after = end + END.length;
  if (content[after] === '\r') after++;
  if (content[after] === '\n') after++;
  let before = start;
  while (before > 0 && (content[before - 1] === '\n' || content[before - 1] === '\r')) before--;
  return content.slice(0, before) + content.slice(after);
}

function writeConfig(content: string): void {
  const file = sshConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** 同步终端 SSH 配置：enabled + 私钥路径 → 写入受管段；否则只删除受管段。
 *  返回 { ok, error }；调用方据此提示用户。 */
export function syncTerminalSshConfig(keyPath: string, enabled: boolean): { ok: boolean; error?: string } {
  try {
    const file = sshConfigPath();
    const existed = fs.existsSync(file);
    const content = existed ? fs.readFileSync(file, 'utf8') : '';
    const without = removeBlock(content);

    if (!enabled || !keyPath) {
      if (!existed || without === content) return { ok: true };
      if (without.trim()) writeConfig(without);
      else fs.rmSync(file, { force: true }); // 文件里原本只有我们这段：恢复成不存在
      return { ok: true };
    }

    // 首次修改前备份原始配置（已有备份就不覆盖，保住最早的那份）
    const bak = `${file}.svngit.bak`;
    if (existed && content && !fs.existsSync(bak)) fs.writeFileSync(bak, content, { mode: 0o600 });

    const normalized = keyPath.replace(/\\/g, '/').replace(/"/g, '');
    const block = `${BEGIN}\nHost github.com\n  IdentityFile "${normalized}"\n${END}\n`;
    writeConfig(without.trimEnd() ? `${without.trimEnd()}\n\n${block}` : block);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
