/** 工作副本异常提示条（SVN）。
 *
 *  两类问题：
 *  1) 异常状态——SVN 把当前目录自身标成 '!'（被锁 / 不完整 / 真缺失）时，它就不敢给下面的条目定性，
 *     界面会出现满屏 ?，用户一头雾水。三种成因修法不同，按序判定、先命中先显示（锁定最前置：
 *     被锁着时 cleanup 自己都拿不到锁）。
 *  2) 树冲突——本地「已添加」而服务器同路径已删除/移动。svn status 只用一个 C 表示，用户容易看漏
 *     （实报：界面标着 A、点进去却是空的），更看不出"该保留还是该放弃"。这里替他去问服务器。
 *
 *  新增异常类型只需往 NOTICES 加一条 + 在 /api/fs 返回对应字段，不必碰 index.tsx 的 JSX。
 *
 *  诊断请求已抽到 use-wc-conflicts（条目角标要共用同一份结果，不能再各查一遍服务器）：
 *  本组件只负责把结果渲染成横幅，请求与状态在 FsView 那一层。
 */
import React from 'react';
import type { WcDiag, WcFlags } from './use-wc-conflicts.js';

/** 状态异常文案。顺序即优先级——先命中先显示。 */
const NOTICES: { key: keyof WcFlags; text: React.ReactNode }[] = [
  {
    key: 'wcLocked',
    text: (
      <>
        🔒 工作副本被锁定（上次 SVN 操作未正常结束，或有别的程序正占着）。请先停掉其他正在使用该
        工作副本的程序，再在此目录依次执行 <span className="mono">svn cleanup</span>（解锁）→{' '}
        <span className="mono">svn update</span>（补全元数据），完成后刷新。
      </>
    ),
  },
  {
    key: 'wcIncomplete',
    text: (
      <>
        ⚠ 工作副本不完整（上次 SVN 操作被中断，元数据有缺失，SVN 尚不能确定各文件状态，故下面显示为未版本化）。
        在此目录执行 <span className="mono">svn update</span> 即可补全；若提示被锁定，先执行{' '}
        <span className="mono">svn cleanup</span> 解锁，完成后刷新。
      </>
    ),
  },
  {
    key: 'wcBroken',
    text: (
      <>
        ⚠ 工作副本状态异常：SVN 把当前目录标成「缺失」，下面的文件夹因此显示为未版本化（?）。
        在该目录执行 <span className="mono">svn update</span> 重新同步即可；若仍不行，需重新检出该工作副本。
      </>
    ),
  },
];

/** 命中第一条异常就渲染对应提示；都正常则什么都不渲染 */
export function WcNotice(props: { flags?: WcFlags; diag: WcDiag }) {
  const conflicts = props.diag.list;
  const unchecked = props.diag.unchecked;
  const wcHit = NOTICES.find((n) => props.flags?.[n.key]);

  return (
    <>
      {wcHit && <div className="fs-big-tip">{wcHit.text}</div>}
      {conflicts !== null && conflicts.length > 0 && (
        <div className="fs-big-tip">
          ⚠ 发现 <b>{conflicts.length}</b> 个树冲突：本地是存在的，但是服务器上这些路径已不存在
          （目录被删或移动过）。
          {unchecked && '（未能连上服务器，以下仅列出本地冲突项）'}
          {/* 全部展开列出（原先只显示 8 条、其余折叠成"…另有 N 个"，用户看不到全貌；
              容器本身有 max-height + 滚动兜底，条数特别多时才会出现滚动条） */}
          <div className="wc-conflict-list">
            {conflicts.map((c) => (
              <div key={c.path} className="wc-conflict-row">
                <span className="mono">{c.path}</span>
                <span className="dim">{c.serverMissing ? '· 服务器已删除' : '· 服务器上仍在'}</span>
                {c.fromRev && (
                  <span className="dim">
                    · 复制自 r{c.fromRev} {c.fromAuthor} {c.fromDate}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4 }}>
            确认服务器删对了 → 对每个冲突文件/文件夹<span className="mono">右键 → 接受服务器的删除</span>同步；
            认为服务器删错了 → 先别动本地，联系 SVN 管理员。
          </div>
        </div>
      )}
    </>
  );
}
