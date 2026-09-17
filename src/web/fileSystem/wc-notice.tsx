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
 */
import React, { useEffect, useState } from 'react';
import { get, type FsData, type WcConflictItem } from '../api.js';

/** /api/fs 里与工作副本异常相关的字段 */
type WcFlags = Pick<FsData, 'wcLocked' | 'wcIncomplete' | 'wcBroken' | 'treeConflicts'>;

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

/** 冲突清单最多展示这么多条，其余折叠成一行（免得提示条撑爆屏幕） */
const MAX_LIST = 8;

/** 命中第一条异常就渲染对应提示；都正常则什么都不渲染 */
export function WcNotice(props: { flags?: WcFlags; dir?: string }) {
  // treeConflicts 来自 /api/fs 的状态统计，但**工作副本 incomplete/locked 时 SVN 不递归**，
  // 那个计数会是 0（实报的坑）。所以这两种异常状态下也要去问一次，否则冲突提示根本不出现。
  const needDiag = (props.flags?.treeConflicts ?? 0) > 0 || Boolean(props.flags?.wcIncomplete) || Boolean(props.flags?.wcLocked);
  const [conflicts, setConflicts] = useState<WcConflictItem[] | null>(null);
  const [unchecked, setUnchecked] = useState(false);

  // 需要诊断时才去问服务器（平时零开销）；不需要时清空旧结果
  useEffect(() => {
    if (!needDiag) {
      setConflicts(null);
      setUnchecked(false);
      return;
    }
    let cancelled = false;
    get
      .wcConflicts(props.dir ?? '')
      .then((r) => {
        if (cancelled) return;
        setConflicts(r.conflicts);
        setUnchecked(Boolean(r.unchecked));
      })
      .catch(() => {
        // 查询失败也要有交代：至少把"这里确实有冲突"告诉用户
        if (!cancelled) setConflicts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needDiag, props.dir]);

  const wcHit = NOTICES.find((n) => props.flags?.[n.key]);

  return (
    <>
      {wcHit && <div className="fs-big-tip">{wcHit.text}</div>}
      {conflicts !== null && conflicts.length > 0 && (
        <div className="fs-big-tip">
          ⚠ 发现 <b>{conflicts.length}</b> 个树冲突：本地是「已添加」，服务器上这些路径已不存在
          （目录被删或移动过）。<b>提交前必须先决定保留哪一边</b>，否则提交会被服务器拒绝。
          {unchecked && '（未能连上服务器，以下仅列出本地冲突项）'}
          {(
            <div className="wc-conflict-list">
              {conflicts.slice(0, MAX_LIST).map((c) => (
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
              {conflicts.length > MAX_LIST && <div className="dim">…另有 {conflicts.length - MAX_LIST} 个</div>}
            </div>
          )}
          {(
            <div style={{ marginTop: 4 }}>
              确认服务器删对了 → 对每个冲突目录执行 <span className="mono">svn revert -R &lt;目录&gt;</span> 放弃本地添加；
              认为服务器删错了 → 先别动本地，联系 SVN 管理员。
            </div>
          )}
        </div>
      )}
    </>
  );
}
