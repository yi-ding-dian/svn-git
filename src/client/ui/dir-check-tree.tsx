/** 通用目录勾选树（远程选择性检出 / 本地常用文件夹预加载共用）：
 *  懒加载——首次只拉根级一级子目录，展开某节点时才拉它的直接子目录（大仓库不预拉全树）；
 *  勾选集合只存**显式勾选**的相对路径（如 branches/AnHui）——父级「全要」时子级不再逐项存
 *  （被父覆盖），渲染时按「祖先覆盖」推导显示为勾选。
 *  取消一个被祖先覆盖的节点 = 把该祖先「拆开」：祖先移除、它**已加载**的直接子目录全加入、
 *  再把本节点移除（能点到本节点说明祖先展开过，kids 必已加载——拆开无遗漏）。
 *  「半选」只是视觉（indeterminate）：有勾选子孙但自身未勾/未被覆盖，点击 = 勾上并清理子孙。
 *  数据源由 loadDirs 提供（远程 repoList / 本地 fs 均可），组件不关心协议；
 *  **loadDirs 必须是稳定引用（useCallback）**，否则根级会被反复重拉。
 *  目录列表拉取失败只提示、不阻断（调用方自行决定后续动作）。 */
import React, { useEffect, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { IconFolder } from './icons.js';

/** 某节点的直接子目录清单（只放目录——文件不是勾选单位）；loading/fail 与数据同存（展开过就不再重拉） */
type NodeList = string[] | 'loading' | 'fail';

export function DirCheckTree(props: {
  /** 拉取某节点的直接子目录名；rel='' 为根；null=失败 */
  loadDirs: (rel: string) => Promise<string[] | null>;
  /** 显式勾选的相对路径集合 */
  value: Set<string>;
  onChange: (v: Set<string>) => void;
  /** 根级一级目录加载成功时上报（父组件用它做「默认全选」与「全选」按钮）；失败/空仓库不报 */
  onRootDirs?: (dirs: string[]) => void;
  /** 根级加载失败文案（默认通用文案；检出场景有自己的说明） */
  loadFailText?: string;
}) {
  const [kids, setKids] = useState<Record<string, NodeList>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** 打开（或数据源变化）：重置并拉根级一级子目录 */
  useEffect(() => {
    let alive = true;
    setKids({ '': 'loading' });
    setExpanded(new Set());
    props
      .loadDirs('')
      .then((dirs) => {
        if (!alive) return;
        setKids({ '': dirs ?? 'fail' });
        // 一级目录清单上报（父组件的默认全选/全选按钮用）
        if (dirs && dirs.length > 0) props.onRootDirs?.(dirs);
      })
      .catch(() => {
        if (alive) setKids({ '': 'fail' });
      });
    return () => {
      alive = false;
    };
    // onRootDirs 是父组件内联回调，不入依赖（入了会每次渲染重拉根级）；回调内读 ref/稳定 setter，旧闭包无影响
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.loadDirs]);

  /** 展开/收起节点；首次展开时拉它的直接子目录 */
  const toggleExpand = (rel: string) => {
    if (expanded.has(rel)) {
      setExpanded((s) => {
        const n = new Set(s);
        n.delete(rel);
        return n;
      });
      return;
    }
    setExpanded((s) => new Set(s).add(rel));
    if (kids[rel]) return;
    setKids((k) => ({ ...k, [rel]: 'loading' }));
    props
      .loadDirs(rel)
      .then((dirs) => setKids((k) => ({ ...k, [rel]: dirs ?? 'fail' })))
      .catch(() => setKids((k) => ({ ...k, [rel]: 'fail' })));
  };

  /** 祖先链（不含自身）：'a/b/c' → ['a', 'a/b'] */
  const parentsOf = (rel: string): string[] => {
    const segs = rel.split('/');
    return segs.slice(1).map((_, i) => segs.slice(0, i + 1).join('/'));
  };
  /** 最近的显式勾选祖先（无则 null）：被它覆盖 = 视觉上已勾选 */
  const coveringAncestor = (rel: string): string | null => parentsOf(rel).find((p) => props.value.has(p)) ?? null;
  const isChecked = (rel: string) => props.value.has(rel) || coveringAncestor(rel) !== null;
  /** 半选（仅视觉）：自身未勾且未被覆盖，但有勾选子孙 */
  const isPartial = (rel: string) => {
    if (isChecked(rel)) return false;
    const pre = `${rel}/`;
    for (const v of props.value) if (v.startsWith(pre)) return true;
    return false;
  };

  /** 勾/取消节点（集合规则见文件头注释） */
  const toggleCheck = (rel: string) => {
    const n = new Set(props.value);
    if (n.has(rel)) {
      n.delete(rel);
    } else {
      const cov = coveringAncestor(rel);
      if (cov) {
        // 取消一个被祖先覆盖的节点 = 把祖先拆开（能点到本节点 → 祖先已展开过 → 直接子目录必已加载）
        n.delete(cov);
        const sib = kids[cov];
        if (Array.isArray(sib)) for (const name of sib) n.add(`${cov}/${name}`);
        n.delete(rel);
      } else {
        n.add(rel);
        const pre = `${rel}/`; // 清理被本节点覆盖的子孙显式勾选（正常交互下不存在，防御性）
        for (const v of [...n]) if (v.startsWith(pre)) n.delete(v);
      }
    }
    props.onChange(n);
  };

  /** 按展开链拍平为行（深度优先；未展开的节点不出子级） */
  const rows: { rel: string; name: string; depth: number }[] = [];
  const walk = (rel: string, depth: number) => {
    const list = kids[rel];
    if (!Array.isArray(list)) return;
    for (const name of list) {
      const childRel = rel ? `${rel}/${name}` : name;
      rows.push({ rel: childRel, name, depth });
      if (expanded.has(childRel)) walk(childRel, depth + 1);
    }
  };
  walk('', 0);

  const root = kids[''];
  if (root === 'loading' || root === undefined) {
    // 正在获取目录列表…
    return <div className="dim small">{t('ui.dirTree.loading')}</div>;
  }
  if (root === 'fail') {
    return <div className="dim small">{props.loadFailText ?? t('ui.dirTree.loadFail')}</div>;
  }
  if (root.length === 0) {
    // （该目录下没有子目录）
    return <div className="dim small">{t('ui.dirTree.empty')}</div>;
  }
  return (
    // flex: 1——在弹出窗里随可用高度伸缩（弹窗拉大时长高）；内容少时=内容高，不撑空
    <div style={{ flex: 1, minHeight: 90, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>
      {rows.map((r) => {
        const open = expanded.has(r.rel);
        const sub = kids[r.rel];
        return (
          <React.Fragment key={r.rel}>
            <div className="row" style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 0, padding: '1px 0', paddingLeft: r.depth * 14 }}>
              <button
                className="mini"
                style={{ border: 'none', background: 'none', padding: 0, width: 14, color: 'var(--dim)', cursor: 'pointer', flexShrink: 0 }}
                onClick={() => toggleExpand(r.rel)}
                // 展开 / 收起
                title={open ? t('ui.dirTree.collapse') : t('ui.dirTree.expand')}
              >
                {open ? '▾' : '▸'}
              </button>
              <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0, flex: 1, minWidth: 0 }}>
                <input
                  type="checkbox"
                  checked={isChecked(r.rel)}
                  onChange={() => toggleCheck(r.rel)}
                  ref={(el) => {
                    // indeterminate 不是 HTML 属性，必须在 DOM 上设（内联 ref 每次渲染都会重设）
                    if (el) el.indeterminate = isPartial(r.rel);
                  }}
                />
                <IconFolder size={13} />
                <span className="small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
              </label>
            </div>
            {/* 展开后的子级状态：加载中 / 失败 / 空目录 */}
            {open && sub === 'loading' && (
              <div className="dim small" style={{ paddingLeft: (r.depth + 1) * 14 + 18 }}>
                {t('ui.dirTree.loading')}
              </div>
            )}
            {open && sub === 'fail' && (
              <div className="dim small" style={{ paddingLeft: (r.depth + 1) * 14 + 18 }}>
                {props.loadFailText ?? t('ui.dirTree.loadFail')}
              </div>
            )}
            {open && Array.isArray(sub) && sub.length === 0 && (
              <div className="dim small" style={{ paddingLeft: (r.depth + 1) * 14 + 18 }}>
                {t('ui.dirTree.emptyChild')}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
