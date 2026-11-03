/** 发布新版本弹窗（⋯ 菜单；仅项目根带 deploy/release.mjs 的 git 项目可见）。
 *  只负责收集参数（升哪一位 + 发布说明），实际发版仍由 deploy/release.mjs 执行，
 *  避免两套流程分叉；发布后不盯 CI（去「发布历史」看产物）。 */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { ConfirmModal } from '../ui/prompt.js';
import { ResultLine } from '../ui/result-line.js';
import { get, post, type ReleaseInfo } from '../shared/api.js';
import { IconPackage } from '../ui/icons.js';
import { t } from '../../shared/i18n/index.js';

type Level = 'patch' | 'minor' | 'major';

/** 发布按钮由外层「发布」弹窗的 foot 渲染，面板只暴露执行入口 */
export interface ReleaseFormHandle {
  run: () => void;
}

export const ReleaseFormPanel = forwardRef<
  ReleaseFormHandle,
  { onStateChange: (s: { disabled: boolean; label: string }) => void }
>(function ReleaseFormPanel({ onStateChange }, ref) {
  const [info, setInfo] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<Level>('patch');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** 非 main 分支时的切换确认 */
  const [switchConfirm, setSwitchConfirm] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');

  useEffect(() => {
    get
      .releaseInfo()
      .then((r) => {
        setInfo(r);
        setNote(r.note);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const next = info?.next[level] ?? '';
  const tag = next ? `v${next}` : '';
  const onMain = info?.branch === 'main';
  const disabled = busy || !info || info.dirty || !note.trim() || !next || !onMain;

  /** 非 main：用户确认后切到 main，再重新读取版本/说明 */
  const switchToMain = () => {
    setSwitchConfirm(false);
    setSwitching(true);
    setSwitchError('');
    void post
      .branchSwitch('main')
      .then((r) => {
        if (!r.ok) {
          setSwitchError(t('ops.release.switchFailed', { msg: r.message }));
          return;
        }
        return get.releaseInfo().then((fresh) => {
          setInfo(fresh);
          setNote(fresh.note);
        });
      })
      .catch((e: Error) => setSwitchError(t('ops.release.switchFailed', { msg: e.message })))
      .finally(() => setSwitching(false));
  };

  const run = () => {
    setConfirming(false);
    setBusy(true);
    setResult(null);
    void post
      .releaseRun(level, note.trim())
      .then((r) => setResult({ ok: r.ok, message: r.message }))
      .catch((e: Error) => setResult({ ok: false, message: e.message }))
      .finally(() => setBusy(false));
  };

  useImperativeHandle(ref, () => ({ run }));

  // 把发布按钮的可用状态和文案上报给外层 foot；结果页禁用（用右上角关闭）
  useEffect(() => {
    onStateChange({
      disabled: disabled || !!result,
      label: busy ? t('ops.release.running') : t('ops.release.run', { tag }),
    });
  }, [disabled, busy, result, tag, onStateChange]);

  const levels: { key: Level; label: string }[] = [
    { key: 'patch', label: t('ops.release.levelPatch') },
    { key: 'minor', label: t('ops.release.levelMinor') },
    { key: 'major', label: t('ops.release.levelMajor') },
  ];

  return (
    <>
        {error && <ResultLine msg={error} err />}
        {!info && !error && <div className="loading">{t('ops.release.loading')}</div>}

        {info && !result && (
          <>
            <div className="row small" style={{ gap: 8, marginBottom: 10 }}>
              {/* 当前版本 */}
              <span className="dim">{t('ops.release.current')}</span>
              <span className="mono" style={{ fontWeight: 600 }}>{info.version}</span>
              <span className="dim">·</span>
              <span className="mono">{info.branch}</span>
            </div>

            {/* 升版本：三张选择卡片，选中高亮 */}
            <div style={{ marginBottom: 12 }}>
              <div className="dim small" style={{ marginBottom: 6 }}>{t('ops.release.level')}</div>
              <div className="row" style={{ gap: 8 }}>
                {levels.map((l) => {
                  const active = level === l.key;
                  return (
                    <label
                      key={l.key}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        background: active ? 'var(--panel2)' : 'transparent',
                        borderRadius: 8,
                        padding: '8px 10px',
                        cursor: busy ? 'default' : 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <input
                        type="radio"
                        name="release-level"
                        checked={active}
                        disabled={busy}
                        onChange={() => setLevel(l.key)}
                        style={{ display: 'none' }}
                      />
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            border: `2px solid ${active ? 'var(--accent)' : 'var(--dim)'}`,
                            background: active ? 'var(--accent)' : 'transparent',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontWeight: 600 }}>{l.key}</span>
                      </div>
                      <span className="mono small" style={{ color: active ? 'var(--accent)' : 'var(--dim)' }}>
                        {info.version} → {info.next[l.key]}
                      </span>
                      <span className="dim small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="form-row">
              {/* 发布说明 */}
              <label>{t('ops.release.note')}</label>
              <input
                type="text"
                value={note}
                maxLength={200}
                placeholder={t('ops.release.notePlaceholder')}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>

            {info.dirty && (
              // 工作区有未提交的改动，发布前请先提交或还原
              <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>{t('ops.release.dirty')}</div>
            )}
            {!onMain && (
              // 当前不在 main：发版前必须由用户确认并切换
              <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
                {t('ops.release.notMain', { branch: info.branch })}
                <button
                  className="mini"
                  style={{ marginLeft: 8 }}
                  disabled={switching || info.dirty}
                  onClick={() => setSwitchConfirm(true)}
                >
                  {switching ? t('ops.release.switching') : t('ops.release.switchMain')}
                </button>
              </div>
            )}
            {switchError && (
              <div className="small" style={{ color: 'var(--err)', marginTop: 4 }}>{switchError}</div>
            )}
            {info.ciReady === false && (
              // CI 文件没推到 origin/main：推 tag 也不会触发构建，只能打标签
              <div className="small" style={{ color: 'var(--warn)', marginTop: 8, lineHeight: 1.6 }}>
                {info.ciHasWorkflow
                  ? t('ops.release.ciNotPushed', { files: (info.ciMissing ?? []).join('、') })
                  : t('ops.release.ciNoWorkflow')}
                <br />
                {t('ops.release.ciOnlyTag')}
              </div>
            )}
            {/* 将执行：提交版本号 → 打 tag {tag} → 推送 → CI 出包 */}
            <div className="dim small" style={{ marginTop: 10, lineHeight: 1.8 }}>
              {t('ops.release.preview', { tag })}
            </div>

            {/* 本次发布包含：上个 tag 之后的提交主题 */}
            <div style={{ marginTop: 14, background: 'var(--panel2)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="dim small" style={{ marginBottom: 4 }}>{t('ops.release.commitsTitle')}</div>
              {info.commits.length > 0 ? (
                info.commits.map((c, i) => (
                  <div
                    key={i}
                    className="small"
                    title={c}
                    style={{
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    · {c}
                  </div>
                ))
              ) : (
                <div className="dim small">{t('ops.release.commitsEmpty')}</div>
              )}
            </div>

            {/* CI 将产出：优先读项目自定义的 deploy/release-artifacts.json */}
            <div style={{ marginTop: 14 }}>
              <div className="dim small" style={{ marginBottom: 6 }}>{t('ops.release.assetsTitle')}</div>
              {(info.artifacts?.length ?? 0) > 0 ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {info.artifacts!.map((tpl) => (
                    <span
                      key={tpl}
                      className="mono small"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        background: 'var(--panel2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                      }}
                    >
                      <IconPackage size={12} /> {tpl.replace(/\$\{version\}/g, next)}
                    </span>
                  ))}
                </div>
              ) : (
                // 产物由项目的 CI 配置决定
                <div className="dim small">{t('ops.release.assetsUnknown')}</div>
              )}
            </div>
          </>
        )}

        {result && (
          <>
            <div
              className="small"
              style={{ color: result.ok ? 'var(--ok)' : 'var(--err)', fontWeight: 600, marginBottom: 8 }}
            >
              {result.ok ? t('ops.release.done') : t('ops.release.failed')}
            </div>
            <pre
              className="mono small"
              style={{
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: 'var(--panel2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 8,
                margin: 0,
              }}
            >
              {result.message}
            </pre>
            {result.ok && (
              // CI 在 GitHub Actions 运行，完成后可在「发布历史」查看产物
              <div className="dim small" style={{ marginTop: 8 }}>{t('ops.release.ciHint')}</div>
            )}
          </>
        )}

      {confirming && (
        <ConfirmModal
          danger
          title={t('ops.release.confirmTitle', { tag })}
          message={t('ops.release.confirmMsg', { tag })}
          confirmLabel={t('ops.release.confirm')}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
      {switchConfirm && (
        <ConfirmModal
          title={t('ops.release.switchConfirmTitle')}
          message={t('ops.release.switchConfirmMsg', { branch: info?.branch ?? '' })}
          confirmLabel={t('ops.release.switchMain')}
          onConfirm={switchToMain}
          onCancel={() => setSwitchConfirm(false)}
        />
      )}
    </>
  );
});
