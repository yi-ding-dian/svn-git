/** 错误分类与跨端点共用文案（认证判定 / 越界提示）。 */
import { t } from '../shared/i18n/index.js';

/** VCS 写操作兜底文案：仓库类型/实现不支持该操作（routes 多文件共用，收敛于此）。
 *  **函数而非字符串常量**：语言可切换，模块顶层求值会把文案固化成首次加载时的语言。 */
// 当前仓库不支持该操作
export const MSG_UNSUPPORTED_OP = () => t('srv.unsupportedOp');
/** 路径越界校验统一文案（防 ../ 穿越；routes 多文件共用，收敛于此）。函数形式同上。 */
// 路径越界
export const MSG_PATH_OUT_OF_BOUNDS = () => t('srv.pathOutOfBounds');
/** 路径超出工作副本范围校验文案（403 域；与 MSG_PATH_OUT_OF_BOUNDS 同族不同字面，分别收敛保持响应文本不变）。函数形式同上。 */
// 超出工作副本范围
export const MSG_OUT_OF_SCOPE = () => t('srv.outOfScope');

/** 认证失败错误码 */
export function  isAuthError(err: Error): boolean {
  // 这行是**解析错误文本**的正则（vcs 层抛出的「认证失败…」/ git 英文输出），不是界面文案，禁止翻译。
  // 权限不足/代理认证也是认证类引导：svn 三种都可能是 E170001，文案分类见 vcs/svn.ts 的 classifySvnError
  return /认证失败|权限不足|代理要求认证|E170001|E215004|Authentication failed|Authorization failed|proxy authentication/i.test(err.message); // i18n-ignore: 解析用正则，翻了认证识别失效
}

/** 统一认证判定：结构化 code 优先（P1-5），正则仅兜底 throw 型异常与未迁移路径 */
export function authErrorOf(r: { code?: string; message: string }): boolean {
  return r.code === 'AUTH' || isAuthError(new Error(r.message));
}
