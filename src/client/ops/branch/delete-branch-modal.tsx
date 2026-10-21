/** 删除分支确认（GitHub 式）：原样输入分支名才启用删除；保存了 SVN 账号时可勾选"再用密码验证"，
 *  密码错在弹窗内即时提示（不用等删除请求失败）。
 *  同时展示最后提交、未合并版本数与将要执行的命令——SVN 删除的是服务器目录，不可撤销。 */
import React, { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.js';
import { post, type BranchDeleteCheck } from '../../shared/api.js';
import { ResizableModal } from '../../shell/modal-shell.js';

/** ISO 时间 → 本地可读（解析失败原样显示） */
function formatDate(iso?: string): string {
  if (!iso) return '?';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function DeleteBranchModal(props: {
  name: string;
  onCancel: () => void;
  /** 校验通过：password 为勾选验证时输入的密码（父组件用它执行删除，不保存）；
   *  from 为确认按钮位置（3 秒转后台时飞线起点）；message 为 svn 删除提交的 log message */
  onConfirm: (password?: string, from?: { x: number; y: number }, message?: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [usePw, setUsePw] = useState(false);
  const [password, setPassword] = useState('');
  // 删除是 svn delete + 提交：提交信息默认用工具模板，可改；空则后端回退模板
  const [commitMsg, setCommitMsg] = useState(() => t('vcs.commitMsg.branchDelete', { name: props.name }));
  const [check, setCheck] = useState<BranchDeleteCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 风险信息：打开弹窗时异步取（最后提交 / 未合并版本数）；失败就不显示，不阻塞删除
  useEffect(() => {
    let alive = true;
    post
      .branchDeleteCheck(props.name)
      .then((r) => {
        if (alive) setCheck(r);
      })
      .catch(() => {
        if (alive) setCheck(null);
      });
    return () => {
      alive = false;
    };
  }, [props.name]);

  useEffect(() => inputRef.current?.focus(), []);

  const nameOk = typed === props.name;
  const pwOk = !usePw || password.length > 0;
  const canDelete = nameOk && pwOk && !busy;

  const submit = async (from?: { x: number; y: number }) => {
    if (!canDelete) return;
    setError('');
    if (usePw) {
      // 先用输入的密码向服务器验证：失败留在弹窗里提示，别关掉让用户从头再来
      setBusy(true);
      try {
        const r = await post.branchDeleteCheck(props.name, password);
        if (!r || r.passwordOk === false) {
          setError(r?.error || t('ops.branch.deletePwError'));
          return;
        }
      } catch (e) {
        setError((e as Error).message);
        return;
      } finally {
        setBusy(false);
      }
    }
    props.onConfirm(usePw ? password : undefined, from, commitMsg.trim() || undefined);
  };

  // 命令预览：短形式用相对路径，悬浮给完整 URL；密码只以 --password-from-stdin 出现，绝不显示明文
  const rel = `branches/${props.name}`;
  const url = check?.url || rel;
  // 提交信息按用户输入实时显示（清空则回退后端模板）；引号转义只为预览可读，实际参数不经 shell
  const delMsg = (commitMsg.trim() || t('vcs.commitMsg.branchDelete', { name: props.name })).replace(/"/g, '\\"');
  const cmds: { short: string; full: string }[] = [];
  if (check?.username) {
    cmds.push({
      short: `svn info --show-item revision ${rel} --username ${check.username} --password-from-stdin`,
      full: `svn info --show-item revision ${url} --username ${check.username} --password-from-stdin`,
    });
  }
  cmds.push({ short: `svn delete ${rel} -m "${delMsg}"`, full: `svn delete ${url} -m "${delMsg}"` });
  const ordinal = ['①', '②', '③'];

  return (
    <div className="modal-mask">
      <ResizableModal width={520} minWidth={460} onEsc={props.onCancel}>
        {/* 删除分支 */}
        <h3>{t('ops.branch.deleteTitle')}</h3>
        <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
          <div style={{ lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* 这会从版本库永久删除该分支目录，无法撤销。 */}
            <div>{t('ops.branch.deleteIntro')}</div>
            <div className="mono small" style={{ wordBreak: 'break-all' }}>
              {url}
            </div>
            {check?.lastRev && (
              <div className="small dim">
                {/* 最后提交 r{rev} · {author} · {date} */}
                {t('ops.branch.deleteLastCommit', {
                  rev: check.lastRev,
                  author: check.lastAuthor || '?',
                  date: formatDate(check.lastDate),
                })}
              </div>
            )}
            {check?.unmerged != null && check.compareWith && (
              check.unmerged > 0 ? (
                <div className="small" style={{ color: 'var(--warn)' }}>
                  {/* ⚠ 该分支还有 {n} 个版本没有合并到 {target} */}
                  {t('ops.branch.deleteUnmerged', { n: check.unmerged, target: check.compareWith })}
                </div>
              ) : (
                <div className="small dim">
                  {/* ✓ 该分支的改动已全部合并到 {target} */}
                  {t('ops.branch.deleteUnmergedNone', { target: check.compareWith })}
                </div>
              )
            )}

            {/* 输入分支名确认（GitHub 删除仓库同款：不匹配按钮一直禁用） */}
            <div className="small" style={{ marginTop: 6 }}>
              {t('ops.branch.deleteNameLabel', { name: props.name })}
            </div>
            <input
              ref={inputRef}
              type="text"
              className="mono"
              style={{ width: '100%' }}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              spellCheck={false}
              autoComplete="off"
            />

            {/* 可选第二层：用当前账号的 SVN 密码向服务器验证（匿名账号没有用户名，不显示） */}
            {check?.username && (
              <>
                <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={usePw}
                    onChange={(e) => {
                      setUsePw(e.target.checked);
                      setError('');
                    }}
                  />
                  {t('ops.branch.deletePasswordOption', { user: check.username })}
                </label>
                {usePw && (
                  <>
                    <input
                      type="password"
                      style={{ width: '100%' }}
                      value={password}
                      placeholder={t('ops.branch.deletePasswordPlaceholder')}
                      autoComplete="off"
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submit();
                      }}
                    />
                    {/* 只用于本次验证，不保存、不显示 */}
                    <div className="small dim">{t('ops.branch.deletePasswordHint')}</div>
                  </>
                )}
              </>
            )}

            {/* 提交信息：svn delete 是立即提交，这条 log message 会记到服务器（可改；空则用默认模板） */}
            <div className="small" style={{ marginTop: 6 }}>
              {t('ops.branch.commitMsgLabel')}
            </div>
            <input
              type="text"
              style={{ width: '100%' }}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />

            {error && (
              <div className="small" style={{ color: 'var(--err)' }}>
                {error}
              </div>
            )}

            {/* 命令预览（默认展开）：悬浮每一项显示完整命令 */}
            <div style={{ marginTop: 8 }}>
              <div className="small dim">{t('ops.branch.deleteCmdTitle')}</div>
              <div className="mono small" style={{ color: 'var(--dim)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {cmds.map((c, i) => (
                  <div key={i} style={{ wordBreak: 'break-all' }} title={c.full}>
                    {ordinal[i]} {c.short}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onCancel}>{t('common.cancel')}</button>
          <button
            className="danger"
            disabled={!canDelete}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              void submit({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
            }}
            // 悬浮显示完整命令（未输入正确分支名时说明为什么禁用）
            title={!nameOk ? t('ops.branch.deleteNameLabel', { name: props.name }) : !pwOk ? t('ops.branch.deletePasswordPlaceholder') : cmds.map((c) => c.full).join('\n')}
          >
            {/* 永久删除分支 */}
            {t('ops.branch.deleteBtn')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
