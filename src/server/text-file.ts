/** 文本文件读写：大小上限、编码探测与按原编码写回。 */
import fs from 'node:fs';
import { detectTextEncoding, decodeText, encodeText } from '../shared/text.js';
import { t } from '../shared/i18n/index.js';

/** 文本读取上限：超过则 statSync 预检后跳过全量读（防超大日志/数据文件 OOM 服务进程） */
export const  MAX_READ_BYTES = 5 * 1024 * 1024;

/** 超限文件读出来的占位文本。**导出成常量**：调用方要拿它判断"手里这份不是真内容"
 *  （`/api/cat` 据此返回 truncated、`/api/write-file` 据此拒绝写入）——
 *  字面量在两处各写一遍，迟早对不上。 */
export const TOO_LARGE_PLACEHOLDER = '（文件过大，未读取全文）'; // i18n-ignore: 字面量比较标记（写入守卫），翻译后语言切换会比对不上、守卫失效

/** 读取文本文件：>MAX_READ_BYTES 时读前拦截,返回占位提示,不整读入内存。
 *  编码：先按 UTF-8，不是合法 UTF-8 再按 GB18030（中文项目里的 .bat/老代码常见），
 *  否则按 UTF-8 读会满屏 `�`（实报：run.bat）。探测细节见 src/shared/text.ts。 */
export function  readTextFile(abs: string): string {
  try {
    if (fs.statSync(abs).size > MAX_READ_BYTES) return TOO_LARGE_PLACEHOLDER;
    return decodeText(fs.readFileSync(abs));
  } catch {
    return '';
  }
}

/** 读取文本文件（区分「空文件」与「读取失败」）。
 *  readTextFile 为兼容旧调用点把异常吞成 ''——预览/编辑链路不能用它：
 *  读失败会被当成空文件显示，接着点编辑保存就可用空内容覆盖原文件（数据丢失）。 */
export function  readTextFileChecked(abs: string): { ok: true; text: string } | { ok: false; message: string } {
  try {
    if (fs.statSync(abs).size > MAX_READ_BYTES) return { ok: true, text: TOO_LARGE_PLACEHOLDER };
    return { ok: true, text: decodeText(fs.readFileSync(abs)) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 把"手动编辑"的结果写回工作区文件，**按目标文件原编码写**（GBK 文件写回去还是 GBK）。
 *  为什么不能直接 writeFileSync(abs, content)：那是按 UTF-8 落盘——GBK 文件一旦这么写，
 *  全文件中文变成替换符、编码被静默改掉（全文件 diff，svn 的 resolve 还会把损坏固化）。
 *  两道守卫，宁可不写也不写坏：
 *   - 内容含替换符 U+FFFD（读侧解码时字节已丢）→ 拒写，写下去等于把丢失固化；
 *     但原文件本来就含替换符时不拦（那文件早已损坏，用户改它不该被永久卡住）。
 *   - 内容含该编码表示不了的字符（如 GBK 表示不了 emoji）→ 拒写并报出是哪个字符。
 *  返回 { ok: false } 时调用方**必须早返回**：后续的 git add / svn resolve 会把
 *  "没写成"当成"已解决"，那才是真的丢数据。 */
export function writeTextKeepEncoding(abs: string, content: string): { ok: true } | { ok: false; message: string } {
  let original = '';
  let originalTooLarge = false;
  let enc = detectTextEncoding(Buffer.alloc(0));
  try {
    const buf = fs.readFileSync(abs);
    originalTooLarge = buf.length > MAX_READ_BYTES; // 用实际读到的字节数，比另做一次 statSync 准
    enc = detectTextEncoding(buf);
    original = decodeText(buf, enc);
  } catch {
    // 文件不存在（如"对方删除、本地修改"的冲突）：按 UTF-8 新建，与改动前行为一致
  }
  if (content.includes('�') && !original.includes('�')) {
    // 内容含无法解码的替换字符（�）——写入会把乱码固化进文件，已拒绝保存。请先「还原」该文件再重试
    return { ok: false, message: t('srv.refuseReplacementChar') };
  }
  // 第三道守卫：调用方手里若是 readTextFile 的**占位符**（超限文件没读全），写下去就是拿占位符覆盖真内容。
  // 判据是"**发来的内容恰是占位符**"，不是"文件多大" —— git 分支走 vcs.cat，拿到的都是完整内容
  // （已跟踪走 git show、未跟踪回退 decodeText(fs.readFileSync(abs))），本来就该能编辑，按大小判会误拒。
  // 再要求原文件确实超限：排除用户真想把正文改成这一句的极端情况。
  // **放在这个函数里而不是各调用点**：它是所有写回路径的唯一入口
  // （/api/write-file 的内联编辑 + /api/resolve-conflict 的手动解决），一处守卫覆盖全部。
  if (originalTooLarge && content === TOO_LARGE_PLACEHOLDER) {
    // 文件超过 {mb}MB，未读取全文——写入会把占位提示固化进文件，已拒绝保存。请用外部程序打开
    return { ok: false, message: t('srv.refuseTooLarge', { mb: MAX_READ_BYTES / 1024 / 1024 }) };
  }
  try {
    fs.writeFileSync(abs, encodeText(content, enc));
    return { ok: true };
  } catch (e) {
    // 该文件编码为 {enc}，保存内容含其无法表示的字符（{msg}），已拒绝写入
    return { ok: false, message: t('srv.refuseUnencodable', { enc, msg: (e as Error).message }) };
  }
}
