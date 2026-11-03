/** 批量清理弹窗：保留最近 N 个 Release，删除更早版本的安装包。
 *  **只删 assets**：Release 说明、tag、代码提交都保留。 */
import React, { useEffect, useState } from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { ConfirmModal } from '../ui/prompt.js';
import { ResultLine } from '../ui/result-line.js';
import { get, post, type ReleaseCleanupPreview } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';

function formatSize(n: number): string {
  if (!n || !Number.isFinite(n)) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const KEEP_OPTIONS = [1, 3, 5, 10];

export function ReleaseCleanupModal(props: { onClose: () => void; onDone: () => void }) {
  const [keep, setKeep] = useState(3);
  const [data, setData] = useState<ReleaseCleanupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; deleted: number; failed: number; error?: string } | null>(null);

  const load = (k: number) => {
    setLoading(true);
    setError('');
    get
      .githubReleaseCleanup(k)
      .then((r) => {
        setData(r);
        if (!r.ok) setError(r.error ?? '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load(keep);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeKeep = (k: number) => {
    setKeep(k);
    setResult(null);
    load(k);
  };

  const run = () => {
    setConfirming(false);
    setBusy(true);
    setResult(null);
    void post
      .githubReleaseCleanupRun(keep)
      .then((r) => {
        setResult({ ok: r.ok, deleted: r.deleted, failed: r.failed.length, error: r.error });
        props.onDone();
        load(keep);
      })
      .catch((e: Error) => setResult({ ok: false, deleted: 0, failed: 0, error: e.message }))
      .finally(() => setBusy(false));
  };

  const releases = data?.releases ?? [];
  const totalAssets = data?.totalAssets ?? 0;
  const totalSize = data?.totalSize ?? 0;

  return (
    <>
      <ModalShell
        title={t('ops.releaseCleanup.title')}
        width={560}
        minWidth={480}
        closeIcon
        onClose={props.onClose}
        foot={
          result ? (
            // 关闭
            <button onClick={props.onClose}>{t('common.close')}</button>
          ) : (
            <>
              {/* 取消 */}
              <button onClick={props.onClose}>{t('common.cancel')}</button>
              {/* 删除产物 */}
              <button
                className="danger"
                disabled={busy || loading || releases.length === 0}
                onClick={() => setConfirming(true)}
              >
                {busy ? t('ops.releaseCleanup.running') : t('ops.releaseCleanup.run')}
              </button>
            </>
          )
        }
      >
        <div className="small" style={{ lineHeight: 1.7 }}>{t('ops.releaseCleanup.intro')}</div>

        <div className="row small" style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
          <span className="dim">{t('ops.releaseCleanup.keepLabel')}</span>
          <select
            value={keep}
            disabled={busy || loading}
            onChange={(e) => changeKeep(Number(e.target.value))}
            style={{
              padding: '3px 8px',
              background: 'var(--panel2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {KEEP_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <span className="dim">{t('ops.releaseCleanup.keepUnit')}</span>
        </div>

        {loading && <div className="loading" style={{ marginTop: 10 }}>{t('ops.releaseCleanup.loading')}</div>}
        {!loading && error && <ResultLine msg={error} err />}
        {!loading && !error && releases.length === 0 && (
          <div className="dim small" style={{ marginTop: 10 }}>{t('ops.releaseCleanup.none')}</div>
        )}

        {!loading && !error && releases.length > 0 && (
          <>
            <div className="small" style={{ marginTop: 10 }}>
              {t('ops.releaseCleanup.preview', { n: releases.length, m: totalAssets, size: formatSize(totalSize) })}
            </div>
            <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {releases.map((r) => (
                <div
                  key={r.tagName}
                  className="row small"
                  style={{ gap: 8, padding: '5px 8px', borderTop: '1px solid var(--border)' }}
                >
                  <span className="mono" style={{ flex: 1 }}>{r.tagName}</span>
                  <span className="dim">
                    {r.assets.length} · {formatSize(r.assets.reduce((s, a) => s + a.size, 0))}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {result && (
          <div className="small" style={{ marginTop: 10, color: result.ok ? 'var(--ok)' : 'var(--err)' }}>
            {result.ok
              ? t('ops.releaseCleanup.done', { n: result.deleted })
              : t('ops.releaseCleanup.failed', { n: result.failed })}
            {result.error ? `：${result.error}` : ''}
          </div>
        )}
      </ModalShell>

      {confirming && (
        <ConfirmModal
          danger
          title={t('ops.releaseCleanup.confirmTitle')}
          message={t('ops.releaseCleanup.confirmMsg', { n: releases.length, m: totalAssets })}
          confirmLabel={t('ops.releaseCleanup.run')}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
