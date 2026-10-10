/** 模块索引注入弹窗：解析所选 md（目录树「路径 ← 描述」/ 表格）→ 勾选条目 → 确认注入（快照）。
 * 作用域 = 弹窗传入的浏览目录（含子树）；已注入过可点「更新注入」或「清除注入」。 */
import React, { useEffect, useMemo, useState } from 'react';
import { t, type I18nKey } from '../../shared/i18n/index.js';
import { get, post } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';

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
  /** 「仓库根」项存 labelKey、渲染时才 t()：label 若在 useMemo 里求值会冻在首次语言 */
  const scopeOptions = useMemo(() => {
    const opts: { label: string; value: string; labelKey?: I18nKey }[] = [{ label: '', value: '', labelKey: 'fs.repoRoot' }];
    const parts = props.dir.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) opts.push({ label: parts.slice(0, i).join('/'), value: parts.slice(0, i).join('/') });
    return opts;
  }, [props.dir]);
  const scopeOpt = scopeOptions.find((o) => o.value === scope);
  const scopeLabel = scopeOpt ? (scopeOpt.labelKey ? t(scopeOpt.labelKey) : scopeOpt.label) : scope;

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
      // 已注入 {n} 条文件说明（作用于「{dir}」目录及子树）
      props.onToast(t('fs.moduleIndex.injected', { n: r.count, dir: scopeLabel }));
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
      // 已清除「{dir}」的注入说明
      props.onToast(t('fs.moduleIndex.cleared', { dir: scopeLabel }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const checkAll = entries ? checked.size === entries.length : false;

  return (
    <ModalShell
      // 📝 注入文件说明
      title={t('fs.moduleIndex.title')}
      width={680}
      onClose={props.onClose}
      foot={
        <>
          {exists && (
            <button className="danger" disabled={busy} onClick={() => void clear()}>
              {/* 清除注入 */}
              {t('fs.moduleIndex.clear')}
            </button>
          )}
          <span className="grow" />
          <button onClick={props.onClose} disabled={busy}>
            {/* 取消 */}
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy || !entries || err !== ''} onClick={() => void inject()}>
            {/* 更新注入 / 注入 */}
            {exists ? t('fs.moduleIndex.update') : t('fs.moduleIndex.inject')}
          </button>
        </>
      }
    >
      <div className="dim small" style={{ lineHeight: 1.8 }}>
        {/* 作用范围 */}
        · <b>{t('fs.moduleIndex.scope')}</b>：
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setErr('');
            setEntries(null);
          }}
          style={{ padding: '1px 4px', margin: '0 4px' }}
          // 说明文字按此目录内的相对路径匹配（含子目录；父目录与其他目录不受影响）
          title={t('fs.moduleIndex.scopeTip')}
        >
          {scopeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.labelKey ? t(o.labelKey) : o.label}</option>
          ))}
        </select>
        {/* 下的文件/文件夹（含子目录；父目录与其他目录不受影响） */}
        {t('fs.moduleIndex.scopeSuffix')}
        {/* 说明来源 / （解析「路径 ← 描述」树图 / 「 / 路径 / 描述 / 」表格；勾选后注入，重新注入可更新） */}
        <br />· <b>{t('fs.moduleIndex.source')}</b>：{props.md}{t('fs.moduleIndex.sourceSuffixPre')}{`| ${t('fs.moduleIndex.colPath')} | ${t('fs.moduleIndex.colDesc')} |`}{t('fs.moduleIndex.sourceSuffixPost')}
      </div>
      {err && <div className="error" style={{ marginTop: 6 }}>{err}</div>}
      <div className="row" style={{ margin: '8px 0 4px' }}>
        <button className="mini" onClick={() => setChecked(new Set(checkAll ? [] : (entries ?? []).map((e) => e.path)))}>
          {/* 取消全选 / 全选 */}
          {checkAll ? t('fs.unselectAll') : t('fs.selectAll')}
        </button>
        {/* 已勾选 {n}/{total} */}
        <span className="dim small">{t('fs.moduleIndex.checked', { n: checked.size, total: entries?.length ?? 0 })}</span>
      </div>
      <div className="vcs-list" style={{ minHeight: 180, maxHeight: 320, overflow: 'auto' }}>
        {/* 解析中… */}
        {entries === null && <div className="dim small" style={{ padding: 10 }}>{t('fs.moduleIndex.parsing')}</div>}
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
        {/* 未解析到条目（需「路径 ← 描述」或表格行） */}
        {entries?.length === 0 && <div className="dim small" style={{ padding: 10 }}>{t('fs.moduleIndex.noEntries')}</div>}
      </div>
    </ModalShell>
  );
}
