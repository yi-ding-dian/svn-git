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
  /** 是否需要账号密码（网络仓库 true、file:// false）。由父组件按仓库 URL 判断，
   *  这样即使风险信息接口失败也不会跳过密码验证 */
  needCred?: boolean;
  onCancel: () => void;
  /** 校验通过：password/username 为删除弹窗里输入的凭据（父组件用它执行删除，不保存）；
   *  from 为确认按钮位置（3 秒转后台时飞线起点）；message 为 svn 删除提交的 log message */
  onConfirm: (password?: string, from?: { x: number; y: number }, message?: string, username?: string) => void;
}) {
  const [typed, setTyped] = useState('');
  /** 删除前必须再输一次账号密码（预填工具配置/凭据缓存里的账号，可改） */
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // 删除是 svn delete + 提交：提交信息默认用工具模板，可改；空则后端回退模板
  const [commitMsg, setCommitMsg] = useState(() => t('vcs.commitMsg.branchDelete', { name: props.name }));
  const [check, setCheck] = useState<BranchDeleteCheck | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 风险信息：打开弹窗时异步取（最后提交 / 未合并版本数）；失败就不显示，不阻塞删除
  useEffect(() => {
    let alive = true;
    post
      .branchDeleteCheck(props.name)
      .then((r) => {
        if (!alive) return;
        setCheck(r);
        // 账号预填：工具配置 > svn 凭据缓存（后端补的）> 空（用户手输）
        if (r?.username) setUsername(r.username);
      })
      .catch(() => {
        if (alive) setCheck(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [props.name]);

  useEffect(() => inputRef.current?.focus(), []);

  // 本地 file:// 仓库没有认证，不需要密码；网络仓库删除前必须验证账号密码。
  // 父组件已按仓库 URL 判定时以它为准（风险信息接口失败也不放松要求）
  const needCred = props.needCred ?? (Boolean(check?.url) && !/^file:/i.test(check?.url ?? ''));
  const nameOk = typed === props.name;
  const credOk = !needCred || (username.trim().length > 0 && password.length > 0);
  const canDelete = nameOk && credOk && !busy && loaded;

  const submit = async (from?: { x: number; y: number }) => {
    if (!canDelete) return;
    setError('');
    if (needCred) {
      // 先用输入的账号密码向服务器验证：失败留在弹窗里提示，别关掉让用户从头再来
      setBusy(true);
      try {
        const r = await post.branchDeleteCheck(props.name, password, username.trim());
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
    props.onConfirm(
      needCred ? password : undefined,
      from,
      commitMsg.trim() || undefined,
      needCred ? username.trim() : undefined,
    );
  };

  // 命令预览：短形式用相对路径，悬浮给完整 URL；密码只以 --password-from-stdin 出现，绝不显示明文
  const rel = `branches/${props.name}`;
  const url = check?.url || rel;
  // 提交信息按用户输入实时显示（清空则回退后端模板）；引号转义只为预览可读，实际参数不经 shell
  const delMsg = (commitMsg.trim() || t('vcs.commitMsg.branchDelete', { name: props.name })).replace(/"/g, '\\"');
  const cmds: { short: string; full: string }[] = [];
  if (needCred) {
    cmds.push({
      short: `svn info --show-item revision ${rel} --username ${username.trim() || check?.username || '<账号>'} --password-from-stdin`,
      full: `svn info --show-item revision ${url} --username ${username.trim() || check?.username || '<账号>'} --password-from-stdin`,
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

            {/* 删除前必须再输一次账号密码（网络仓库）：密码不对或没写权限都不给删 */}
            {needCred && (
              <>
                {/* SVN 账号（工具配置或凭据缓存里有时预填，只读；没有时可手输） */}
                <div className="small" style={{ marginTop: 6 }}>{t('ops.branch.deleteAccountLabel')}</div>
                <input
                  type="text"
                  style={{ width: '100%' }}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError('');
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
                {/* SVN 密码（删除前验证，必填） */}
                <div className="small">{t('ops.branch.deletePasswordLabel')}</div>
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
                {/* 删除前会先用它向服务器验证；只用于本次操作，不保存、不显示 */}
                <div className="small dim">{t('ops.branch.deletePasswordHint')}</div>
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
            title={!nameOk ? t('ops.branch.deleteNameLabel', { name: props.name }) : !credOk ? t('ops.branch.deletePasswordPlaceholder') : cmds.map((c) => c.full).join('\n')}
          >
            {/* 永久删除分支 */}
            {t('ops.branch.deleteBtn')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
