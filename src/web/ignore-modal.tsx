/** 忽略设置弹窗：查看/删除/添加忽略规则（svn:ignore / .gitignore） */
import React, { useCallback, useEffect, useState } from 'react';
import { cmdOfRepo } from './cmd-preview.js';
import { get, post } from './api.js';
import { ModalShell } from './modal-shell.js';

export function IgnoreModal(props: { dir: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const [rules, setRules] = useState<string[]>([]);
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
      .then((r) => setRules(r.rules))
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
      .ignore(props.dir, pattern.trim())
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
              <div key={r} className="vcs-row" style={{ cursor: 'default' }}>
                <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r}>
                  {r}
                </span>
                <button className="mini danger" disabled={busy} onClick={() => remove(r)}>删除</button>
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
              title={`命令行: ${cmdOfRepo(repoType ?? 'git', 'ignore_add', { path: props.dir ?? '.', pattern: pattern.trim() || '…' }) ?? ''}`}
            >
              添加
            </button>
          </div>
          {msg && <div className="small" style={{ marginTop: 8, color: 'var(--dim)' }}>{msg}</div>}
    </ModalShell>
  );
}
