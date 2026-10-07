/** 文本编码探测与转换：让非 UTF-8 文本（中文项目里常见的 GBK/GB18030 老文件）读得对、写回不损坏。
 *
 *  为什么需要：`cmd.exe` 用系统 ANSI 代码页，中文 Windows 下的 .bat/.cmd 以及老代码通常是 GBK 且无 BOM，
 *  按 UTF-8 读会满屏 `�`（实报：运行.bat）。反过来，写回时若按 UTF-8 落盘，会把用户文件静默改编码。
 *
 *  **只在服务端使用**（用了 Node 的 Buffer；前端只消费 JSON 字符串，不需要它）。
 *
 *  三段式探测（性能实测 5MB：纯 UTF-8 快路径 6ms；纯 GBK/混合走兜底 85ms）：
 *   1. BOM → 对应编码
 *   2. 整块严格试 UTF-8（fatal）→ 成功即返回 —— 99% 的现有文件走这条，行为与从前完全一致
 *   3. 失败 → 整块解两次、按行挑（见 decodeMixed）
 *
 *  为什么整块失败时不能一刀切按 GB18030：git show/diff 的输出是**混合**的——提交信息是 UTF-8、
 *  被 diff 的 GBK 文件内容行是 GBK；整块按 GB18030 会把 UTF-8 行毁成"杩愯.bat"这种乱码。
 *  为什么不能逐行解码：几十万次解码调用 + 字符串拼接，5MB 实测要 1.9~6.5 秒，会把单线程服务卡死。
 *
 *  编码方向：Node 只有解码器（TextDecoder），**没有** GB18030 编码器（TextEncoder 忽略参数、永远 UTF-8），
 *  所以用解码器反查出一张「Unicode → GBK 字节」表（实测 23939 条、建表 13ms，惰性建一次）。 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

// ignoreBOM: true = 保留 BOM 字符本身（命名反直觉，但这是 WHATWG 的定义）。
// 必须显式设：默认 false 会把 BOM 吃掉，而改动前的 Buffer.toString('utf8') 是保留的——
// 不设就静默改了带 BOM 文件的首字符，写回时 BOM 还会丢（整个文件变成"被改过"）。
const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Lenient = new TextDecoder('utf-8', { ignoreBOM: true });
const gb18030 = new TextDecoder('gb18030');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

/** 探测文本编码。整块是合法 UTF-8 就返回 utf-8（绝大多数文件，行为与改动前一致）。
 *  **含 NUL 字节的按二进制处理**（返回 utf-8 = 走非严格 UTF-8，与改动前一致）：
 *  GB18030 解码器极宽容，二进制（如 PNG 头 89 50 4E 47）会被解成"看起来像文本"的乱码
 *  （实测解出"塒NG"），比今天的 U+FFFD 更容易被误认为读对了；同时二进制也常是大文件，避免白跑一遍解码。 */
export function detectTextEncoding(buf: Uint8Array): TextEncoding {
  // BOM 优先：UTF-8 有 BOM（EF BB BF）仍按 utf-8 解（BOM 字符保留，与改动前行为一致）
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  if (buf.includes(0)) return 'utf-8'; // 二进制守卫（UTF-16 已被上面的 BOM 分支接走）
  try {
    utf8Fatal.decode(buf);
    return 'utf-8';
  } catch {
    return 'gb18030';
  }
}

/** 解码**单一编码**的文本（文件内容：预览、cat、历史版本）——整块按 GB18030 解。
 *  enc 省略时自行探测；调用方已知编码就传进来，省一次探测。
 *  **永不抛错**（解码器都是非严格模式）：读不了的字节落成 U+FFFD，与改动前行为一致，
 *  绝不会把"显示乱码"升级成 500。 */
export function decodeText(buf: Uint8Array, enc: TextEncoding = detectTextEncoding(buf)): string {
  switch (enc) {
    case 'utf-16le': return utf16le.decode(buf);
    case 'utf-16be': return utf16be.decode(buf);
    // 整块 GB18030：同一文件只有一种编码，整块解比逐行猜更准
    // （逐行会把"恰好是合法 UTF-8 的 GBK 行"解错——GBK 双字节里约 8% 单独看也是合法 UTF-8）
    case 'gb18030': return gb18030.decode(buf);
    default: return utf8Lenient.decode(buf);
  }
}

/** 解码**可能是混合编码**的输出（git show/diff 这类子进程输出：UTF-8 的提交信息 + GBK 的文件内容行）。
 *  整块严格 UTF-8 成功就用 UTF-8；否则整块解两次、**按行挑**（见 decodeMixedLine）。
 *  已知取舍：GBK 内容行里"恰好是合法 UTF-8"的那一小撮行会被解错（整块 GB18030 会把 UTF-8 的元信息行解错），
 *  两害相权取后者——元信息行（提交信息/路径）解错更显眼，且内容行绝大多数不是合法 UTF-8。 */
export function decodeMixedText(buf: Uint8Array): string {
  try {
    utf8Fatal.decode(buf);
    return utf8Lenient.decode(buf);
  } catch {
    /* 不是纯 UTF-8，往下判 */
  }
  if (buf.includes(0)) return utf8Lenient.decode(buf); // 二进制守卫，同 detectTextEncoding
  return decodeMixed(buf);
}

/** 非 UTF-8 的兜底：整块解两次（UTF-8 非严格 / GB18030），按行挑。
 *  两串行数必然相同——0x0A 在两种编码里都不会出现在多字节序列中间
 *  （GBK 续字节 ≥0x40、UTF-8 续字节 ≥0x80，都避开 0x0A）。
 *  某行的 UTF-8 版含 U+FFFD 说明该行不是 UTF-8 → 取 GB18030 版；否则取 UTF-8 版。
 *  于是"UTF-8 提交信息 + GBK 内容行"的混合输出两边都能保住。
 *  代价：这是 85ms/5MB 的两遍解码，**只在整块不是合法 UTF-8 时才走到**。 */
function decodeMixed(buf: Uint8Array): string {
  const u = utf8Lenient.decode(buf).split('\n');
  const g = gb18030.decode(buf).split('\n');
  if (u.length !== g.length) return gb18030.decode(buf); // 理论上不会走到，兜底按 GB18030
  const out = new Array<string>(u.length);
  for (let i = 0; i < u.length; i++) out[i] = u[i]!.includes('�') ? g[i]! : u[i]!;
  return out.join('\n');
}

/** Unicode → GBK 字节的反查表（惰性建、缓存）：值是 (首字节 << 8) | 次字节，单字节档直接是字节值 */
let gbkReverseTable: Map<string, number> | null = null;
function gbkReverse(): Map<string, number> {
  if (gbkReverseTable) return gbkReverseTable;
  const m = new Map<string, number>();
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue; // 该位置不是合法续字节
      pair[0] = lead;
      pair[1] = trail;
      const s = gb18030.decode(pair);
      // 同一个字符可能有多组字节解出来（GB18030 有重复映射）：取第一组即可，
      // 实测真实 GBK 文件（运行.bat）解码再编码字节完全一致，不会产生无意义 diff
      if (s.length === 1 && s !== '�' && !m.has(s)) m.set(s, (lead << 8) | trail);
    }
  }
  const euro = gb18030.decode(Uint8Array.of(0x80)); // 单字节 0x80 在 GBK 里是欧元符号
  if (euro.length === 1 && !m.has(euro)) m.set(euro, 0x80);
  gbkReverseTable = m;
  return m;
}

/** 按目标编码编码。GBK 表示不了的字符（四字节区：™ ☺ 韩文 emoji 等）**抛错**，
 *  由调用方拒绝写入并报出是哪个字符——绝不静默转成别的编码或写坏文件。 */
export function encodeText(str: string, enc: TextEncoding): Buffer {
  if (enc === 'utf-8') return Buffer.from(str, 'utf8');
  if (enc === 'utf-16le') return Buffer.from(str, 'utf16le');
  if (enc === 'utf-16be') {
    const b = Buffer.from(str, 'utf16le');
    b.swap16();
    return b;
  }
  const table = gbkReverse();
  const out = Buffer.allocUnsafe(str.length * 2); // 每字符最多 2 字节，str.length 是安全上界
  let n = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out[n++] = cp;
      continue;
    }
    const code = table.get(ch);
    if (code === undefined) {
      throw new Error(`GBK 无法表示字符「${ch}」(U+${cp.toString(16).toUpperCase().padStart(4, '0')})`);
    }
    if (code > 0xff) out[n++] = code >> 8;
    out[n++] = code & 0xff;
  }
  return out.subarray(0, n);
}
