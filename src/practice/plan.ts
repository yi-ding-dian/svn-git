/** 练习仓库的目录规划与失败清理：纯文件系统操作，不碰版本库命令 */
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../shared/i18n/index.js';
import type { PracticeType } from './types.js';

/** 统一放在父目录下的这个子目录里，避免和用户已有文件混在一起 */
export const PRACTICE_DIR_NAME = 'svn-git-practice';

export class PracticePlanError extends Error {}

/** YYYYMMDD-HHMMSS（本地时间；同一秒内重复创建由下面的 -2/-3 兜底） */
function stampOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * 校验父目录并**占位**创建一个唯一 root（已创建好、空目录）。
 * 用非递归 mkdir 做占位：并发/重名时只有一方成功，另一方自动加序号。
 * 失败清理由调用方负责（见 cleanupPracticeRoot）。
 */
export function planPracticeRoot(
  parentDir: string,
  type: PracticeType,
  now = new Date(),
): { root: string; workDir: string; practiceBase: string } {
  const parent = path.resolve(parentDir);
  let st: fs.Stats;
  try {
    st = fs.statSync(parent);
  } catch {
    // 父目录不存在
    throw new PracticePlanError(t('srv.practiceParentMissing', { dir: parent }));
  }
  if (!st.isDirectory()) {
    // 不是目录
    throw new PracticePlanError(t('srv.practiceParentNotDir', { dir: parent }));
  }
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    // 父目录不可写
    throw new PracticePlanError(t('srv.practiceParentNotWritable', { dir: parent }));
  }

  const practiceBase = path.join(parent, PRACTICE_DIR_NAME);
  fs.mkdirSync(practiceBase, { recursive: true });
  const stem = `${type}-${stampOf(now)}`;
  for (let i = 1; i <= 99; i++) {
    const name = i === 1 ? stem : `${stem}-${i}`;
    const root = path.join(practiceBase, name);
    try {
      // 非递归：已存在会抛 EEXIST（这就是"占位"的意义）
      fs.mkdirSync(root);
      return { root, workDir: path.join(root, 'work'), practiceBase };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  // 无法创建唯一目录（同名过多）
  throw new PracticePlanError(t('srv.practiceNoUniqueDir'));
}

/** 失败清理：只删本次创建在练习基目录内的 root（防误删用户目录）；基目录空了顺带删掉 */
export function cleanupPracticeRoot(root: string, practiceBase: string): void {
  const rel = path.relative(practiceBase, root);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  try {
    fs.rmSync(root, { recursive: true, force: true });
    if (fs.readdirSync(practiceBase).length === 0) fs.rmdirSync(practiceBase);
  } catch {
    /* 清理失败不覆盖原始错误 */
  }
}
