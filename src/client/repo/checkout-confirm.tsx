/** 检出二次确认弹窗（检出弹窗内点「检出」后弹出）：
 *  防「忘了取消勾选 / 落地路径看错」之类的误操作——把关键信息（远程路径、检出去向）与
 *  **检出范围树**（勾选目录按层级前缀合并展示）摊开核对，「确认检出」才真正发起后台任务，
 *  「返回修改」回检出弹窗（勾选与表单都还在）。 */
import React from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { t } from '../../shared/i18n/index.js';

interface TreeNode {
  name: string;
  children: TreeNode[];
}

/** 相对路径集合 → 层级树（前缀合并；勾选模型保证子孙不会与祖先同时显式存在） */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const p of [...paths].sort()) {
    let level = root;
    for (const seg of p.split('/')) {
      let n = level.find((x) => x.name === seg);
      if (!n) {
        n = { name: seg, children: [] };
        level.push(n);
      }
      level = n.children;
    }
  }
  return root;
}

function TreeRows({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <>
      {nodes.map((n) => (
        <React.Fragment key={n.name}>
          <div className="small mono" style={{ paddingLeft: depth * 16, lineHeight: 1.7 }}>
            📁 {n.name}
          </div>
          {n.children.length > 0 && <TreeRows nodes={n.children} depth={depth + 1} />}
        </React.Fragment>
      ))}
    </>
  );
}

export function CheckoutConfirmDialog(props: {
  url: string;
  /** 落地完整路径（dir/name） */
  target: string;
  /** 勾选的相对路径（可多级；构建范围树用） */
  dirs: string[];
  /** 确认：发起检出（飞行线与任务由调用方处理，并关窗） */
  onConfirm: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** 返回修改（检出弹窗还在下面，勾选与表单保留） */
  onBack: () => void;
}) {
  const tree = buildTree(props.dirs);
  return (
    <ModalShell
      icon="📡"
      // 确认检出
      title={t('repo.co.confirmTitle')}
      onClose={props.onBack}
      width={440}
      closeIcon
      foot={
        <>
          {/* 返回修改 */}
          <button onClick={props.onBack}>{t('repo.co.confirmBack')}</button>
          <button className="primary" onClick={props.onConfirm}>
            {/* 确认检出 */}
            {t('repo.co.confirmGo')}
          </button>
        </>
      }
    >
      <div className="small" style={{ marginBottom: 6 }}>
        <span className="dim">{t('repo.co.remote')}：</span>
        <span className="mono" style={{ wordBreak: 'break-all' }}>{props.url}</span>
      </div>
      <div className="small" style={{ marginBottom: 10 }}>
        <span className="dim">{t('repo.co.confirmTo')}：</span>
        <span className="mono" style={{ wordBreak: 'break-all' }}>{props.target}</span>
      </div>
      {/* 检出范围（以下目录，另含根目录文件） */}
      <div className="dim small" style={{ marginBottom: 4 }}>{t('repo.co.confirmScope')}</div>
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
        <TreeRows nodes={tree} depth={0} />
      </div>
    </ModalShell>
  );
}
