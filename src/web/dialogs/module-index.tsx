/** 模块索引注入弹窗：解析所选 md（目录树「路径 ← 描述」/ 表格）→ 勾选条目 → 确认注入（快照）。
 * 作用域 = 弹窗传入的浏览目录（含子树）；已注入过可点「更新注入」或「清除注入」。 */
import React, { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api.js';
import { ModalShell } from '../modal-shell.js';

interface Entry {
  path: string;
  desc: string;
}

export function ModuleIndexDialog(props: {
  /** 作用目录（仓库相对路径，空=仓库根）——作为弹窗默认值，可下拉调整 */
  dir: string;
  dirLabel: string;
  /** md 来源（仓库相对路径） */
  md: string;
  onClose: () => void;
  /** 注入/清除成功通知（调用方刷新索引缓存） */
  onDone: () => void;
  onToast: (msg: string) => void;
}) {
  // 作用范围可调（默认当前浏览目录；md 常放在 docs/ 而描述是整个仓库 → 常需选「仓库根」）
  const [scope, setScope] = useState(props.dir);
  const [entries, setEntries] = useState<Entry[] | null>(null); // null=加载中
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [exists, setExists] = useState<{ md: string; entries: Entry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const scopeOptions = useMemo(() => {
    const opts = [{ label: '（仓库根）', value: '' }];
    const parts = props.dir.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) opts.push({ label: parts.slice(0, i).join('/'), value: parts.slice(0, i).join('/') });
    return opts;
  }, [props.dir]);
  const scopeLabel = scopeOptions.find((o) => o.value === scope)?.label ?? scope;

  useEffect(() => {
    let ok = true;
    // 解析预览条目 + 该范围已注入的（决定「更新/清除」）
    get
      .moduleIndexPreview(scope, props.md)
      .then((r) => {
        if (!ok) return;
        setEntries(r.entries);
        setChecked(new Set(r.entries.map((e) => e.path)));
      })
      .catch((e: Error) => {
        if (ok) setErr(e.message);
      });
    get
      .moduleIndex()
      .then((r) => {
        if (ok) setExists(r.indexes[scope] ?? null);
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, [scope, props.md]);

  const toggle = (p: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const inject = async () => {
    if (!entries) return;
    setBusy(true);
    setErr('');
    try {
      const r = await post.moduleIndexSet(scope, props.md, [...checked]);
      props.onDone();
      props.onClose();
      props.onToast(`已注入 ${r.count} 条文件说明（作用于「${scopeLabel}」目录及子树）`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    setErr('');
    try {
      await post.moduleIndexClear(scope);
      props.onDone();
      props.onClose();
      props.onToast(`已清除「${scopeLabel}」的注入说明`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const checkAll = entries ? checked.size === entries.length : false;

  return (
    <ModalShell
      title="📝 注入文件说明"
      width={680}
      onClose={props.onClose}
      foot={
        <>
          {exists && (
            <button className="danger" disabled={busy} onClick={() => void clear()}>
              清除注入
            </button>
          )}
          <span className="grow" />
          <button onClick={props.onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" disabled={busy || !entries || err !== ''} onClick={() => void inject()}>
            {exists ? '更新注入' : '注入'}
          </button>
        </>
      }
    >
      <div className="dim small" style={{ lineHeight: 1.8 }}>
        · <b>作用范围</b>：
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setErr('');
            setEntries(null);
          }}
          style={{ padding: '1px 4px', margin: '0 4px' }}
          title="说明文字按此目录内的相对路径匹配（含子目录；父目录与其他目录不受影响）"
        >
          {scopeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        下的文件/文件夹（含子目录；父目录与其他目录不受影响）
        <br />· <b>说明来源</b>：{props.md}（解析「路径 ← 描述」树图 / 「| 路径 | 描述 |」表格；勾选后注入，重新注入可更新）
      </div>
      {err && <div className="error" style={{ marginTop: 6 }}>{err}</div>}
      <div className="row" style={{ margin: '8px 0 4px' }}>
        <button className="mini" onClick={() => setChecked(new Set(checkAll ? [] : (entries ?? []).map((e) => e.path)))}>
          {checkAll ? '取消全选' : '全选'}
        </button>
        <span className="dim small">已勾选 {checked.size}/{entries?.length ?? 0}</span>
      </div>
      <div className="vcs-list" style={{ minHeight: 180, maxHeight: 320, overflow: 'auto' }}>
        {entries === null && <div className="dim small" style={{ padding: 10 }}>解析中…</div>}
        {entries?.map((e) => (
          <div key={e.path} className="vcs-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <input
              type="checkbox"
              checked={checked.has(e.path)}
              onChange={() => toggle(e.path)}
              style={{ marginTop: 3 }}
              title={e.desc}
            />
            <span className="mono small" style={{ flexShrink: 0, minWidth: 180, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.path}>
              {e.path}
            </span>
            <span className="small" style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>{e.desc}</span>
          </div>
        ))}
        {entries?.length === 0 && <div className="dim small" style={{ padding: 10 }}>未解析到条目（需「路径 ← 描述」或表格行）</div>}
      </div>
    </ModalShell>
  );
}
