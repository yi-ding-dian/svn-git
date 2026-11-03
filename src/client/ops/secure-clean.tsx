/** 安全清理弹窗：离职/交接前删除本机保存的凭据与私钥配置。
 *  两步确认：先勾选清理项 → 点「执行清理」→ 二次确认 → 执行。
 *  只删应用自己管理的内容；GitHub 上的公钥/Token 需用户按提示手动撤销。 */
import React, { useState } from 'react';
import { post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { ConfirmModal } from '../ui/prompt.js';
import { HelpNote } from '../ui/ui.js';
import { t } from '../../shared/i18n/index.js';

type Options = {
  removeKey: boolean;
  removeSshConfig: boolean;
  removeInsteadOf: boolean;
  clearGithubToken: boolean;
  clearSvnPassword: boolean;
  clearHistory: boolean;
};

type Result = {
  ok: boolean;
  removed: string[];
  failed: { item: string; error: string }[];
  publicKey: string;
};

/** 服务端返回的清理项标识 → 界面文案 */
function itemLabel(item: string): string {
  const key = `ops.secureClean.item.${item}`;
  return t(key as Parameters<typeof t>[0]);
}

export function SecureCleanModal(props: {
  /** 当前配置的私钥路径：弹窗里明确显示要删的是哪一个文件 */
  keyPath: string;
  onClose: () => void;
  /** 清理完成：宿主刷新 Git 信息回显 */
  onDone: () => void;
  onToast: (m: string, err?: boolean) => void;
}) {
  const [opts, setOpts] = useState<Options>({
    removeKey: true,
    removeSshConfig: true,
    removeInsteadOf: true,
    clearGithubToken: true,
    clearSvnPassword: true,
    clearHistory: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (k: keyof Options) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOpts({ ...opts, [k]: e.target.checked });

  const run = () => {
    setConfirming(false);
    setBusy(true);
    void post
      .secureClean(opts)
      .then((r) => {
        setResult(r);
        props.onDone();
      })
      .catch((e: Error) => props.onToast(e.message, true))
      .finally(() => setBusy(false));
  };

  const copyKey = () => {
    if (!result?.publicKey) return;
    void navigator.clipboard.writeText(result.publicKey).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={560} minWidth={480} onEsc={props.onClose}>
        {/* 🧹 安全清理 */}
        <h3>{t('ops.secureClean.title')}</h3>
        <div className="body">
          {!result ? (
            <>
              <HelpNote>
                {/* 永久删除本机保存的凭据和私钥配置。清理后无法恢复。 */}
                {t('ops.secureClean.intro')}
              </HelpNote>
              <div style={{ marginTop: 12, lineHeight: 2 }}>
                <label className="row small" style={{ gap: 8, cursor: props.keyPath ? 'pointer' : 'not-allowed' }}>
                  <input type="checkbox" checked={opts.removeKey} disabled={!props.keyPath} onChange={toggle('removeKey')} />
                  {/* 删除项目内 SSH 私钥 */}
                  {t('ops.secureClean.optKey')}
                </label>
                <div className="dim small mono" style={{ marginLeft: 22, wordBreak: 'break-all' }}>
                  {props.keyPath ? t('ops.secureClean.optKeyPath', { path: props.keyPath }) : t('ops.secureClean.optKeyNone')}
                </div>
                <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts.removeSshConfig} onChange={toggle('removeSshConfig')} />
                  {t('ops.secureClean.optSshConfig')}
                </label>
                <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts.removeInsteadOf} onChange={toggle('removeInsteadOf')} />
                  {t('ops.secureClean.optInsteadOf')}
                </label>
                <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts.clearGithubToken} onChange={toggle('clearGithubToken')} />
                  {t('ops.secureClean.optGithubToken')}
                </label>
                <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts.clearSvnPassword} onChange={toggle('clearSvnPassword')} />
                  {t('ops.secureClean.optSvnPassword')}
                </label>
                <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={opts.clearHistory} onChange={toggle('clearHistory')} />
                  {t('ops.secureClean.optHistory')}
                </label>
              </div>
              <div className="small" style={{ marginTop: 12, color: 'var(--warn)', lineHeight: 1.7 }}>
                {/* ⚠ GitHub 上的公钥和 Token 不会自动删除，清理后请按提示手动撤销。 */}
                {t('ops.secureClean.warn')}
              </div>
            </>
          ) : (
            <>
              <div className="small" style={{ color: result.ok ? 'var(--ok)' : 'var(--warn)', fontWeight: 600, marginBottom: 8 }}>
                {result.ok ? t('ops.secureClean.done') : t('ops.secureClean.failed')}
              </div>
              {result.removed.length > 0 && (
                <div className="small" style={{ lineHeight: 1.9 }}>
                  <div className="dim">{t('ops.secureClean.removed')}</div>
                  {result.removed.map((item) => (
                    <div key={item}>· {itemLabel(item)}</div>
                  ))}
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="small" style={{ lineHeight: 1.9, marginTop: 8, color: 'var(--err)' }}>
                  <div>{t('ops.secureClean.failed')}</div>
                  {result.failed.map((f) => (
                    <div key={f.item}>· {itemLabel(f.item)}：{f.error}</div>
                  ))}
                </div>
              )}
              <div className="small" style={{ marginTop: 14, lineHeight: 1.9 }}>
                <div className="dim">{t('ops.secureClean.manual')}</div>
                <div>
                  1.{' '}
                  <a href="https://github.com/settings/keys" target="_blank" rel="noreferrer">
                    {t('ops.secureClean.manualKeys')}
                  </a>
                </div>
                <div>
                  2.{' '}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                    {t('ops.secureClean.manualTokens')}
                  </a>
                </div>
                <div>3. {t('ops.secureClean.manualBrowser')}</div>
                <div>4. {t('ops.secureClean.manualCopy')}</div>
              </div>
              {result.publicKey && (
                <div style={{ marginTop: 12 }}>
                  <div className="dim small">{t('ops.secureClean.publicKey')}</div>
                  <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.6, marginTop: 4, padding: 8, background: 'var(--bg2)', borderRadius: 6 }}>
                    {result.publicKey}
                  </div>
                  <button className="mini" style={{ marginTop: 6 }} onClick={copyKey}>
                    {copied ? t('ops.secureClean.copied') : t('ops.secureClean.copy')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="foot">
          {!result ? (
            <>
              {/* 取消 */}
              <button onClick={props.onClose}>{t('common.cancel')}</button>
              {/* 执行清理 */}
              <button className="danger" disabled={busy} onClick={() => setConfirming(true)}>
                {t('ops.secureClean.run')}
              </button>
            </>
          ) : (
            // 关闭
            <button onClick={props.onClose}>{t('common.close')}</button>
          )}
        </div>
      </ResizableModal>
      {confirming && (
        <ConfirmModal
          danger
          title={t('ops.secureClean.confirmTitle')}
          message={t('ops.secureClean.confirmMsg')}
          confirmLabel={t('ops.secureClean.confirm')}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
