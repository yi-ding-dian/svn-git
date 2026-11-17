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
import { t } from '../../shared/i18n/index.js';
import type { WcDiag, WcFlags } from './use-wc-conflicts.js';

/** 状态异常文案。顺序即优先级——先命中先显示。
 *  ⚠ 文案必须写成函数：模块顶层直接 t() 只会算一次，切语言不会跟着变（见 i18n/index.ts 头部说明）。 */
const NOTICES: { key: keyof WcFlags; render: () => React.ReactNode }[] = [
  {
    key: 'wcLocked',
    render: () => (
      <>
        {/* 🔒 工作副本被锁定（上次 SVN 操作未正常结束，或有别的程序正占着）。请先停掉其他正在使用该工作副本的程序，再在此目录依次执行 */}
        {t('fs.wc.lockedPre')} <span className="mono">svn cleanup</span>
        {/* （解锁）→ */}
        {t('fs.wc.lockedMid')} <span className="mono">svn update</span>
        {/* （补全元数据），完成后刷新。 */}
        {t('fs.wc.lockedPost')}
      </>
    ),
  },
  {
    key: 'wcIncomplete',
    render: () => (
      <>
        {/* ⚠ 工作副本不完整（上次 SVN 操作被中断，元数据有缺失，SVN 尚不能确定各文件状态，故下面显示为未版本化）。在此目录执行 */}
        {t('fs.wc.incompletePre')} <span className="mono">svn update</span>
        {/* 即可补全；若提示被锁定，先执行 */}
        {t('fs.wc.incompleteMid')} <span className="mono">svn cleanup</span>
        {/* 解锁，完成后刷新。 */}
        {t('fs.wc.incompletePost')}
      </>
    ),
  },
  {
    key: 'wcBroken',
    render: () => (
      <>
        {/* ⚠ 工作副本状态异常：SVN 把当前目录标成「缺失」，下面的文件夹因此显示为未版本化（?）。在该目录执行 */}
        {t('fs.wc.brokenPre')} <span className="mono">svn update</span>
        {/* 重新同步即可；若仍不行，需重新检出该工作副本。 */}
        {t('fs.wc.brokenPost')}
      </>
    ),
  },
];

/** 命中第一条异常就渲染对应提示；都正常则什么都不渲染 */
export function WcNotice(props: {
  flags?: WcFlags;
  diag: WcDiag;
  /** 当前目录（相对仓库根）：清单里的路径要带上它，显示成相对根的完整路径 */
  dir?: string;
  /** 横幅上「接受服务器的删除」：传相对**当前目录**的路径，由调用方拼上 dir */
  onAcceptDeleted?: (paths: string[]) => void;
}) {
  const conflicts = props.diag.list;
  const unchecked = props.diag.unchecked;
  const wcHit = NOTICES.find((n) => props.flags?.[n.key]);
  /** 收起：本次浏览该目录期间有效（调用方以 dir 作 key，切目录后重新提示） */
  const [dismissed, setDismissed] = React.useState(false);
  /** 能"接受删除"的只有服务器上确实没有的条目；服务器上仍在的项不能用这个动作（会本地白删） */
  const missing = conflicts?.filter((c) => c.serverMissing) ?? [];

  return (
    <>
      {wcHit && <div className="fs-big-tip">{wcHit.render()}</div>}
      {conflicts !== null && conflicts.length > 0 && !dismissed && (
        <div className="fs-big-tip">
          {/* 右侧 × 可收起：冲突没解决时只是暂时不占地方，切目录/重新进入会再提示（用户实报：关不掉） */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* ⚠ 发现 / 个树冲突：本地是存在的，但是服务器上这些路径已不存在（目录被删或移动过）。 */}
              {t('fs.wc.foundPre')} <b>{conflicts.length}</b>{t('fs.wc.foundPost')}
              {/* （未能连上服务器，以下仅列出本地冲突项） */}
              {unchecked && t('fs.wc.unchecked')}
              {/* 全部展开列出（原先只显示 8 条、其余折叠成"…另有 N 个"，用户看不到全貌；
                  容器本身有 max-height + 滚动兜底，条数特别多时才会出现滚动条） */}
              <div className="wc-conflict-list">
                {conflicts.map((c) => (
                  <div key={c.path} className="wc-conflict-row">
                    {/* 清单里的 path 相对当前目录，拼上 dir 显示成相对仓库根（用户要求：看得出文件在哪） */}
                    <span className="mono">{props.dir ? `${props.dir}/${c.path}` : c.path}</span>
                    {/* · 服务器已删除 / · 服务器上仍在 */}
                    <span className="dim">{c.serverMissing ? t('fs.wc.deletedShort') : t('fs.wc.presentShort')}</span>
                    {c.fromRev && (
                      <span className="dim">
                        {/* · 复制自 r{rev} {author} {date} */}
                        {t('fs.wc.copiedFrom', { rev: c.fromRev, author: c.fromAuthor ?? '', date: c.fromDate ?? '' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {/* 一键处理：只针对服务器已删除的项；点了先弹文件清单，再二次确认（会删本地文件） */}
              {missing.length > 0 && props.onAcceptDeleted && (
                <div style={{ margin: '6px 0 2px' }}>
                  <button className="mini" onClick={() => props.onAcceptDeleted!(missing.map((c) => c.path))}>
                    {/* 接受服务器的删除（{n} 项） */}
                    {t('fs.wc.acceptDeleted', { n: missing.length })}
                  </button>
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                {/* 确认服务器删对了 → 对每个冲突文件/文件夹 / 右键 → 接受服务器的删除 / 同步；认为服务器删错了 → 先别动本地，联系 SVN 管理员。 */}
                {t('fs.wc.guidePre')}<span className="mono">{t('fs.wc.guideAction')}</span>{t('fs.wc.guidePost')}
              </div>
            </div>
            <button
              className="mini"
              style={{ flexShrink: 0 }}
              onClick={() => setDismissed(true)}
              title={t('fs.wc.dismissTitle')}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
