/** 共享配置弹窗：访问范围（本机/局域网/自定义 IP）、人数上限、访问地址、保存并重启。 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconServer } from '../ui/icons.js';
import { t } from '../../shared/i18n/index.js';
import { DEFAULT_SHARE, type ShareMode, type ShareSettings } from '../../shared/share.js';

const MODES: { key: ShareMode; labelKey: 'share.modeLocal' | 'share.modeLan' | 'share.modeCustom'; descKey: 'share.modeLocalDesc' | 'share.modeLanDesc' | 'share.modeCustomDesc' }[] = [
  { key: 'local', labelKey: 'share.modeLocal', descKey: 'share.modeLocalDesc' },
  { key: 'lan', labelKey: 'share.modeLan', descKey: 'share.modeLanDesc' },
  { key: 'custom', labelKey: 'share.modeCustom', descKey: 'share.modeCustomDesc' },
];

const ACCESS_OPTS = [
  { v: true, labelKey: 'share.modeReadOnly', descKey: 'share.modeReadOnlyDesc' },
  { v: false, labelKey: 'share.modeReadWrite', descKey: 'share.modeReadWriteDesc' },
] as const;

export function ShareDialog(props: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ShareSettings | null>(null);
  const [mode, setMode] = useState<ShareMode>('local');
  const [allowText, setAllowText] = useState('');
  const [maxViewers, setMaxViewers] = useState(DEFAULT_SHARE.maxViewers);
  const [readOnly, setReadOnly] = useState(true);
  const [allowSwitchProject, setAllowSwitchProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    get
      .share()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setMode(s.config.mode);
        setAllowText(s.config.allow.join('\n'));
        setMaxViewers(s.config.maxViewers);
        setReadOnly(s.config.readOnly);
        setAllowSwitchProject(s.config.allowSwitchProject);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setErr(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setErr('');
    setNotice('');
    const allow = allowText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await post.shareSave({ mode, allow, maxViewers, readOnly, allowSwitchProject });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      return;
    }
    setNotice(t('share.restarting'));
    // 重启会切断当前连接：请求失败属于预期
    post.shareRestart().catch(() => {});
    // 轮询服务恢复，恢复后自动刷新页面（本机重新打开；远程同事刷新即可）
    const started = Date.now();
    const timer = window.setInterval(async () => {
      try {
        await get.info();
        window.clearInterval(timer);
        window.location.reload();
      } catch {
        if (Date.now() - started > 20_000) {
          window.clearInterval(timer);
          setErr(t('share.restartFailed'));
          setBusy(false);
        }
      }
    }, 800);
  };

  return (
    <ModalShell
      title={t('share.title')}
      icon={<IconServer size={16} />}
      width={620}
      onClose={props.onClose}
      closeIcon
      foot={
        <>
          <button onClick={props.onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="primary" onClick={() => void save()} disabled={busy || loading}>
            {busy ? t('share.restarting') : t('share.saveAndRestart')}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="dim">…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="small" style={{ fontWeight: 600 }}>{t('share.mode')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MODES.map((m) => (
              <label
                key={m.key}
                className="row"
                style={{
                  gap: 8,
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${mode === m.key ? 'var(--accent)' : 'var(--border)'}`,
                  background: mode === m.key ? 'var(--panel2)' : undefined,
                }}
              >
                <input type="radio" checked={mode === m.key} onChange={() => setMode(m.key)} style={{ marginTop: 2 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{t(m.labelKey)}</span>
                  <span className="dim small">{t(m.descKey)}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === 'custom' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="small" style={{ fontWeight: 600 }}>{t('share.allowLabel')}</span>
              <textarea
                className="mono"
                rows={4}
                value={allowText}
                placeholder={t('share.allowPlaceholder')}
                onChange={(e) => setAllowText(e.target.value)}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </label>
          )}

          <div className="small" style={{ fontWeight: 600 }}>{t('share.accessMode')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCESS_OPTS.map((opt) => (
              <label
                key={String(opt.v)}
                className="row"
                style={{
                  flex: 1,
                  gap: 8,
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${readOnly === opt.v ? 'var(--accent)' : 'var(--border)'}`,
                  background: readOnly === opt.v ? 'var(--panel2)' : undefined,
                }}
              >
                <input type="radio" checked={readOnly === opt.v} onChange={() => setReadOnly(opt.v)} style={{ marginTop: 2 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{t(opt.labelKey)}</span>
                  <span className="dim small">{t(opt.descKey)}</span>
                </span>
              </label>
            ))}
          </div>

          <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={allowSwitchProject}
              onChange={(e) => setAllowSwitchProject(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600 }}>{t('share.allowSwitchProject')}</span>
              <span className="dim small">{t('share.allowSwitchProjectHint')}</span>
            </span>
          </label>

          <label className="row" style={{ gap: 10 }}>
            <span className="small" style={{ fontWeight: 600 }}>{t('share.maxViewers')}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={maxViewers}
              onChange={(e) => setMaxViewers(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              style={{ width: 90 }}
            />
            <span className="dim small" style={{ flex: 1, minWidth: 0 }}>{t('share.maxViewersHint')}</span>
          </label>

          <div
            className="small"
            style={{
              color: readOnly ? 'var(--dim)' : 'var(--err)',
              background: 'var(--panel2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            {readOnly ? t('share.readOnlyNote') : t('share.readWriteWarn')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small" style={{ fontWeight: 600 }}>{t('share.addresses')}</span>
            {settings && settings.addresses.length > 0 ? (
              settings.addresses.map((a) => (
                <span key={a} className="mono small" style={{ userSelect: 'all' }}>{a}</span>
              ))
            ) : (
              <span className="dim small">{t('share.noAddress')}</span>
            )}
            {settings && (
              <span className="dim small">{t('share.addressesHint', { port: settings.port })}</span>
            )}
          </div>

          {notice && <div className="small" style={{ color: 'var(--accent)' }}>{notice}</div>}
          {err && <div className="error small">{err}</div>}
        </div>
      )}
    </ModalShell>
  );
}
