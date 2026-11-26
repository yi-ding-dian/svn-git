/** 递归统计目录下已落盘文件数与字节（跳过 .svn 元数据）。
 *  svn 检出没有 --progress，周期扫盘估算"已检出多少文件 / 多大"用；竞态（文件正写入/刚被清）静默跳过。
 *  两条 SVN 检出路径（浏览仓库检出、获取仓库检出）共用。 */
import fs from 'node:fs';
import path from 'node:path';

export async function scanDirStat(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    let ents: fs.Dirent[];
    try {
      ents = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return; // 目录刚被清理/不可读：跳过
    }
    for (const e of ents) {
      if (e.name === '.svn') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          files += 1;
          bytes += st.size;
        } catch {
          /* 正在写入或被删：跳过 */
        }
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}
