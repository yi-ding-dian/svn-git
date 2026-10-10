/** 忽略设置弹窗：查看/删除/添加忽略规则（svn:ignore / .gitignore） */
import React, { useCallback, useEffect, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { get, post } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';

/** 目录路径归一：'' / '.' 都表示仓库根（比较"规则落在哪"与"当前目录"时用） */
const normDir = (s: string): string => (s === '.' || s === '' ? '' : s.replace(/^\.\//, '').replace(/\/+$/, ''));

export function IgnoreModal(props: { dir: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  // 规则列表：{ pattern, where }（where=来源：.gitignore / 全局 / info/exclude——三档合并展示） */
  const [rules, setRules] = useState<{ pattern: string; where: string }[]>([]);
  const [pattern, setPattern] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [repoType, setRepoType] = useState<'git' | 'svn' | null>(null);
  /** svn 忽略预案：本目录未纳入版本控制时，规则其实会写到别的目录（见下） */
  const [plan, setPlan] = useState<{ target: string; rule: string; degraded: boolean } | null>(null);
  /** 本目录自己被上层规则忽略时的来源（svn:ignore 不继承，本目录自己是没有任何规则的） */
  const [source, setSource] = useState<{ dir: string; rule: string } | null>(null);
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
  useEffect(load, [load]);

  /** svn 附加信息：这条目录上"添加规则"会写到哪、以及它自己是不是被上层规则忽略的 */
  const loadMeta = useCallback(() => {
    if (repoType !== 'svn') return;
    void get
      .ignorePlan(props.dir)
      .then(setPlan)
      .catch(() => setPlan(null));
    void get
      .ignoreSource(props.dir)
      .then((r) => setSource(r.source))
      .catch(() => setSource(null));
  }, [repoType, props.dir]);
  useEffect(loadMeta, [loadMeta]);

  const remove = (rule: string) => {
    setBusy(true);
    void post
      .ignoreRemove(props.dir, rule)
      .then((r) => {
        setMsg(r.message);
        if (r.ok) {
          load();
          loadMeta(); // 删掉的可能正是"忽略了自己"的那条规则
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
          loadMeta();
          props.onChanged();
        }
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  return (
    // ⚠ 忽略设置
    <ModalShell title={t('fs.ignore.title')} width={480} onClose={props.onClose}>
      {/* 目录: {dir} / （仓库根） */}
      <div className="dim small" style={{ marginBottom: 8, wordBreak: 'break-all' }}>{t('fs.ignore.dir', { dir: props.dir || t('fs.repoRoot') })}</div>
          {/* 本目录未纳入版本控制：在这里添加的规则挂不上它，会落到别的目录（甚至仓库根）——必须先说清楚 */}
          {repoType === 'svn' && plan && normDir(plan.target) !== normDir(props.dir) && (
            <div className="small" style={{ marginBottom: 8, wordBreak: 'break-all', color: 'var(--warn)' }}>
              {/* ⚠ 本目录尚未加入版本库：在下面添加的规则不会挂在它身上，而是写到 */}
              {t('fs.ignore.notInRepoPre')}{' '}
              {/* 仓库根目录 */}
              <span className="mono">{plan.target || t('fs.repoRootDir')}</span>
              {/* （svn 的规则只能挂在已加入版本库的目录上）。 */}
              {t('fs.ignore.notInRepoPost')}
            </div>
          )}
          <div className="vcs-list" style={{ minHeight: 100 }}>
            {rules.length === 0 && (
              <div className="dim" style={{ padding: 10 }}>
                {/* 暂无忽略规则 */}
                {t('fs.ignore.empty')}
                {source && (
                  <div style={{ marginTop: 6 }}>
                    {/* 本目录当前被上层规则忽略：{dir} 的「{rule}」 / 仓库根目录 */}
                    {t('fs.ignore.ignoredByParentRule', { dir: source.dir === '.' ? t('fs.repoRootDir') : source.dir, rule: source.rule })}
                    {/* （svn:ignore 不继承，被上层忽略的目录自己没有规则） */}
                    <span className="dim">{t('fs.ignore.noInherit')}</span>
                  </div>
                )}
              </div>
            )}
            {rules.map((r) => (
              <div key={r.pattern} className="vcs-row" style={{ cursor: 'default' }}>
                <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.pattern}>
                  {r.pattern}
                </span>
                <span className="dim small nowrap" style={{ margin: '0 8px' }}>{r.where}</span>
                {/* 删除 */}
                <button className="mini danger" disabled={busy} onClick={() => remove(r.pattern)}>{t('common.delete')}</button>
              </div>
            ))}
          </div>
          <div className="row" style={{ margin: '10px 0 0' }}>
            <input
              type="text"
              // 新规则，如 *.log 或 目录名/
              placeholder={t('fs.ignore.rulePlaceholder')}
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
              {/* 添加 */}
              {t('fs.ignore.addBtn')}
            </button>
          </div>
          {msg && <div className="small" style={{ marginTop: 8, color: 'var(--dim)' }}>{msg}</div>}
    </ModalShell>
  );
}
