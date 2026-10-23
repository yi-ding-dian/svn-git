/** 目录下载：流式打包成 ZIP（STORE 无压缩，不引入第三方依赖）。
 *
 *  为什么用 STORE + data descriptor：
 *   - 不压缩：打包速度只受磁盘 IO 限制，适合源码目录；
 *   - data descriptor：文件内容边读边写，不必先把整个文件读进内存算 CRC，
 *     大文件/大目录也不会把服务端内存撑爆。
 *
 *  进度：打包前先遍历一次统计总字节数，设置 Content-Length，
 *  浏览器原生下载栏才能显示百分比 / 已下载 / 总大小。
 *
 *  约束：调用方负责校验路径在仓库根内；这里跳过符号链接（防止打包到仓库外）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** 累进 CRC32（跨块调用时把上一块的返回值传进来） */
function crc32(buf: Buffer, prev = 0): number {
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** 写一块并处理背压：客户端慢/断开时不把内存堆满 */
function write(res: http.ServerResponse, buf: Buffer): Promise<void> {
  if (res.writableEnded || res.destroyed) return Promise.reject(new Error('closed'));
  if (res.write(buf)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      res.off('close', onClose);
      resolve();
    };
    const onClose = () => {
      res.off('drain', onDrain);
      reject(new Error('closed'));
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

interface Entry {
  abs: string;
  /** ZIP 内路径（UTF-8，目录以 / 结尾） */
  name: Buffer;
  isDir: boolean;
  /** 文件字节数；目录为 0 */
  size: number;
  mtime: Date;
}

interface CentralEntry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  isDir: boolean;
  time: number;
  date: number;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 本地文件头（flags: bit3=data descriptor, bit11=UTF-8 文件名） */
function localHeader(name: Buffer, time: number, date: number, isDir: boolean): Buffer {
  const b = Buffer.alloc(30 + name.length);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4);
  b.writeUInt16LE(isDir ? 0x0800 : 0x0808, 6);
  b.writeUInt16LE(0, 8); // STORE
  b.writeUInt16LE(time, 10);
  b.writeUInt16LE(date, 12);
  b.writeUInt32LE(0, 14); // crc（文件走 data descriptor）
  b.writeUInt32LE(0, 18);
  b.writeUInt32LE(0, 22);
  b.writeUInt16LE(name.length, 26);
  b.writeUInt16LE(0, 28);
  name.copy(b, 30);
  return b;
}

function centralHeader(e: CentralEntry): Buffer {
  const b = Buffer.alloc(46 + e.name.length);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(20, 4); // version made by
  b.writeUInt16LE(20, 6); // version needed
  b.writeUInt16LE(e.isDir ? 0x0800 : 0x0808, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(e.time, 12);
  b.writeUInt16LE(e.date, 14);
  b.writeUInt32LE(e.crc, 16);
  b.writeUInt32LE(e.size, 20);
  b.writeUInt32LE(e.size, 24);
  b.writeUInt16LE(e.name.length, 28);
  b.writeUInt16LE(0, 30); // extra
  b.writeUInt16LE(0, 32); // comment
  b.writeUInt16LE(0, 34); // disk
  b.writeUInt16LE(0, 36); // internal attrs
  b.writeUInt32LE(0, 38); // external attrs
  b.writeUInt32LE(e.offset, 42);
  e.name.copy(b, 46);
  return b;
}

/** 递归收集条目（跳过符号链接），用于统计总大小和随后打包 */
function collect(absDir: string, rel: string, out: Entry[]): void {
  const items = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const it of items) {
    const abs = path.join(absDir, it.name);
    const childRel = rel ? `${rel}/${it.name}` : it.name;
    if (it.isSymbolicLink()) continue;
    if (it.isDirectory()) {
      try {
        const st = fs.statSync(abs);
        out.push({ abs, name: Buffer.from(`${childRel}/`, 'utf8'), isDir: true, size: 0, mtime: st.mtime });
        collect(abs, childRel, out);
      } catch {
        /* 读不到（权限/已删除）：跳过 */
      }
      continue;
    }
    if (!it.isFile()) continue;
    try {
      const st = fs.statSync(abs);
      out.push({ abs, name: Buffer.from(childRel, 'utf8'), isDir: false, size: st.size, mtime: st.mtime });
    } catch {
      /* 读不到：跳过 */
    }
  }
}

/** ZIP 总字节数：各条目本地头 + 数据/描述符 + 中央目录 + EOCD */
function zipSize(entries: Entry[]): number {
  let total = 22;
  for (const e of entries) {
    total += 30 + e.name.length; // local header
    if (!e.isDir) total += e.size + 16; // 数据 + data descriptor
    total += 46 + e.name.length; // central directory
  }
  return total;
}

/** 把 rootDir 打包写入 res（含响应头与 Content-Length） */
export async function streamZip(res: http.ServerResponse, rootDir: string, downloadName: string): Promise<void> {
  const entries: Entry[] = [];
  collect(rootDir, '', entries);

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    // 先统计再设置：浏览器据此显示下载百分比（目录大小可能变化，按扫描时的快照为准）
    'Content-Length': zipSize(entries),
    'Cache-Control': 'no-store',
  });

  const central: CentralEntry[] = [];
  let offset = 0;

  const send = async (buf: Buffer) => {
    await write(res, buf);
    offset += buf.length;
  };

  for (const e of entries) {
    if (res.writableEnded || res.destroyed) return;
    const { time, date } = dosTime(e.mtime);
    const start = offset;
    await send(localHeader(e.name, time, date, e.isDir));
    if (e.isDir) {
      central.push({ name: e.name, crc: 0, size: 0, offset: start, isDir: true, time, date });
      continue;
    }

    let crc = 0;
    let size = 0;
    const fd = await fs.promises.open(e.abs, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      // 只读扫描时的大小：文件在下载期间被追加也不会超过 Content-Length
      let remaining = e.size;
      while (remaining > 0) {
        const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, remaining), null);
        if (bytesRead === 0) break;
        const chunk = buf.subarray(0, bytesRead);
        crc = crc32(chunk, crc);
        size += bytesRead;
        remaining -= bytesRead;
        await send(Buffer.from(chunk));
      }
    } finally {
      await fd.close();
    }
    // data descriptor：signature + crc + 压缩大小 + 原始大小
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(size, 8);
    desc.writeUInt32LE(size, 12);
    await send(desc);
    central.push({ name: e.name, crc: crc >>> 0, size, offset: start, isDir: false, time, date });
  }

  const cdStart = offset;
  for (const e of central) await send(centralHeader(e));
  const cdSize = offset - cdStart;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  await send(eocd);
  res.end();
}
