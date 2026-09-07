/** 忽略设置弹窗：查看/删除/添加忽略规则（svn:ignore / .gitignore） */
import React, { useCallback, useEffect, useState } from 'react';
import { cmdOfRepo } from './cmd-preview.js';
import { get, post } from './api.js';
import { ModalShell } from './modal-shell.js';

export function IgnoreModal(props: { dir: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  // 规则列表：{ pattern, where }（where=来源：.gitignore / 全局 / info/exclude——三档合并展示） */
  const [rules, setRules] = useState<{ pattern: string; where: string }[]>([]);
  const [pattern, setPattern] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [repoType, setRepoType] = useState<'git' | 'svn' | null>(null);
  useEffect(() => {
    void get
      .info()
      .then((r) => r.type && setRepoType(r.type))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    get
      .ignoreRules(props.dir)
      .then((r) =>
        setRules(
          (r.sources ?? []).map((s) => ({ pattern: s.pattern, where: s.where })).length > 0
            ? (r.sources ?? []).map((s) => ({ pattern: s.pattern, where: s.where }))
            : r.rules.map((p) => ({ pattern: p, where: '' })) // 旧接口/svn 回退：未知来源
        )
      )
      .catch((e: Error) => setMsg(e.message));
  }, [props.dir]);
  useEffect(load, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (rule: string) => {
    setBusy(true);
    void post
      .ignoreRemove(props.dir, rule)
      .then((r) => {
        setMsg(r.message);
        if (r.ok) {
          load();
          props.onChanged();
        }
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  const add = () => {
    if (!pattern.trim()) return;
    setBusy(true);
    void post
      .ignore(props.dir, pattern.trim(), 'gitignore')
      .then((r) => {
        setMsg(r.message);
        if (r.ok) {
          setPattern('');
          load();
          props.onChanged();
        }
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell title="⚠ 忽略设置" width={480} onClose={props.onClose}>
      <div className="dim small" style={{ marginBottom: 8, wordBreak: 'break-all' }}>目录: {props.dir || '（仓库根）'}</div>
          <div className="vcs-list" style={{ minHeight: 100 }}>
            {rules.length === 0 && <div className="dim" style={{ padding: 10 }}>暂无忽略规则</div>}
            {rules.map((r) => (
              <div key={r.pattern} className="vcs-row" style={{ cursor: 'default' }}>
                <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.pattern}>
                  {r.pattern}
                </span>
                <span className="dim small nowrap" style={{ margin: '0 8px' }}>{r.where}</span>
                <button className="mini danger" disabled={busy} onClick={() => remove(r.pattern)}>删除</button>
              </div>
            ))}
          </div>
          <div className="row" style={{ margin: '10px 0 0' }}>
            <input
              type="text"
              placeholder="新规则，如 *.log 或 目录名/"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
              style={{ flex: 1 }}
            />
            <button
              className="mini primary"
              disabled={busy || !pattern.trim()}
              onClick={add}
              title={`${cmdOfRepo(repoType ?? 'git', 'ignore_add', { path: props.dir ?? '.', pattern: pattern.trim() || '…' }) ?? ''}`}
            >
              添加
            </button>
          </div>
          {msg && <div className="small" style={{ marginTop: 8, color: 'var(--dim)' }}>{msg}</div>}
    </ModalShell>
  );
}
