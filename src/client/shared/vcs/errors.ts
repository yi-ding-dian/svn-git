/** svn/git 错误识别与展示层翻译（纯逻辑）。
 *  从 shared/utils.ts 下沉：带 VCS 业务语义，供仓库获取、启动/弹窗提示等入口共用。 */
import { t, type I18nKey } from '../../../shared/i18n/index.js';

/** svn out-of-date 类错误（服务器有新版本，提交前需先更新）：判断与翻译共用同一正则 */
const OUT_OF_DATE_RE = /E155011|E160028|E160029|File or directory is out of date/i;

/** 是否为 svn out-of-date 类错误（服务器已有新版本，需先「更新」再提交） */
export function isOutOfDateError(msg: string): boolean {
  return OUT_OF_DATE_RE.test(msg);
}

/** 常见 svn/git 错误码 → 界面提示（含下一步动作建议）。映射不到时原样返回原文。
 *  ⚠️ 存的是 i18n key（不是文案本身）：模块顶层若求值 t() 会冻结在首次语言。 */
const VCS_ERR_INFO: { re: RegExp; key: I18nKey }[] = [
  // 环境缺失：svn/git 命令不可用（ENOENT）
  { re: /ENOENT|spawn[^\n]*ENOENT|command not found/i, key: 'common.vcsErr.noCommand' },
  // svn: 服务器有新版本
  { re: OUT_OF_DATE_RE, key: 'common.vcsErr.outOfDate' },
  // svn: 工作副本被锁定
  { re: /E155004|working copy locked/i, key: 'common.vcsErr.locked' },
  // svn: 文件存在冲突
  { re: /E155015|remains in conflict|merge conflict|CONFLICT \(content/i, key: 'common.vcsErr.conflict' },
  // svn: 认证/权限失败（必须排在"无法连接"之前：认证失败的输出里同时带外层 E170013）
  { re: /E170001|E215004|Authentication failed|authorization failed|proxy authentication/i, key: 'common.vcsErr.auth' },
  // svn: 无法连接服务器。E170013 是认证失败的**外层包装码**（真实原因在更内层），不能放进来，
  // 否则原文报错会被翻译成"连接服务器失败"，把人往网络方向带
  { re: /E175002|cannot connect|Could not connect|Unable to connect/i, key: 'common.vcsErr.connect' },
  // git: 工作区有未提交修改
  { re: /Please commit your changes or stash them|your local changes would be overwritten/i, key: 'common.vcsErr.localChanges' },
  // git: 非快进（需先拉取）
  { re: /Non-fast-forward|rejected.*fetch first/i, key: 'common.vcsErr.nonFastForward' },
  // git: 无法访问远程仓库
  { re: /fatal: unable to access|Could not resolve host|Failed to connect/i, key: 'common.vcsErr.remoteAccess' },
];

/** 展示层统一错误翻译：原始英文/svn 错误码 → 提示 + 下一步动作，未命中原样返回 */
export function translateVcsError(msg: string): string {
  if (!msg) return msg;
  for (const { re, key } of VCS_ERR_INFO) {
    if (re.test(msg)) return t(key);
  }
  return msg;
}
