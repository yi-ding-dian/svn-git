/** 关于弹窗：应用图标 + 名称 + 版本号 + 构建日期/提交（数据来自 /api/info，构建信息由 build-web.mjs 写入）
 *  以及应用自身的在线升级：检查 → 下载 → 重启（Electron 打包版；纯 Node / 源码运行只显示说明）。 */
import React, { useEffect, useState } from 'react';
import { ModalShell } from './modal-shell.js';
import { Tooltip } from '../ui/tooltip.js';
import { get, post } from '../shared/api.js';
import { formatSize } from '../shared/format-size.js';
import { t } from '../../shared/i18n/index.js';
import { APP_RELEASES_LATEST_URL, type AppUpdateStatus } from '../../shared/app-update.js';

export function AboutModal(props: {
  version: string;
  buildDate: string;
  commit?: string;
  dirty?: boolean;
  /** 本机访问（false = 局域网共享的远程查看者）：不显示本机升级入口 */
  local?: boolean;
  onClose: () => void;
}) {
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  /** 下载加速开关 + 自定义前缀（存在 config.json，和 git 下载加速分开） */
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [proxyPrefix, setProxyPrefix] = useState('');
  const [proxyBusy, setProxyBusy] = useState(false);
  const [installError, setInstallError] = useState('');

  // 打开弹窗时取一次状态；纯 Node / 源码运行会返回 supported=false。
  // 还没检查过（idle）就顺手查一次：用户打开「关于」通常就是想看版本/更新。
  useEffect(() => {
    // 远程查看者看不到更新区，也不去请求本机专属接口
    if (props.local === false) return;
    let alive = true;
    get
      .appUpdateStatus()
      .then((s) => {
        if (!alive) return;
        setUpdate(s);
        setProxyEnabled(s.proxy.enabled);
        setProxyPrefix(s.proxy.prefix);
        if (s.supported && s.phase === 'idle') {
          setUpdate({ ...s, phase: 'checking' });
          void post.appUpdateCheck().then((r) => alive && setUpdate(r)).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [props.local]);

  // 检查/下载中轮询状态（主进程自动检查可能先于弹窗开始，这里把结果接上来）
  const phase = update?.phase;
  useEffect(() => {
    if (phase !== 'downloading' && phase !== 'checking') return;
    const timer = window.setInterval(() => {
      get.appUpdateStatus().then(setUpdate).catch(() => {});
    }, 700);
    return () => window.clearInterval(timer);
  }, [phase]);

  const check = async () => {
    setBusy(true);
    setInstallError('');
    try {
      setUpdate(await post.appUpdateCheck());
    } catch (e) {
      setUpdate((s) => (s ? { ...s, phase: 'error', error: (e as Error).message } : s));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setInstallError('');
    try {
      setUpdate(await post.appUpdateDownload());
    } catch (e) {
      setInstallError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setInstallError('');
    try {
      const r = await post.appUpdateInstall();
      if (!r.ok) {
        setInstallError(
          r.error === 'not-downloaded'
            ? t('shell.about.updateNotDownloaded')
            : r.error === 'read-only'
              ? t('shell.about.updateReadOnly')
              : t('shell.about.updateUnsupported'),
        );
      }
      // ok=true：主进程 400ms 后退出并安装，页面不用再做事
    } catch (e) {
      setInstallError((e as Error).message);
    }
  };

  const saveProxy = (enabled: boolean, prefix: string) => {
    if (proxyBusy) return;
    setProxyBusy(true);
    setProxyEnabled(enabled);
    void post
      .appUpdateProxySave(enabled, prefix)
      .then((r) => {
        setProxyEnabled(r.enabled);
        setProxyPrefix(r.prefix);
        // 换源后旧检查结果作废（主进程会把 available 重置为 idle），重新拉一次状态
        return get.appUpdateStatus();
      })
      .then((s) => setUpdate(s))
      .catch(() => {
        /* 保存失败保持界面现状 */
      })
      .finally(() => setProxyBusy(false));
  };

  const openReleases = () => {
    void post.openUrl(APP_RELEASES_LATEST_URL).catch(() => {});
  };

  const unsupportedText = (): string => {
    switch (update?.mode) {
      case 'portable':
        return t('shell.about.updatePortable');
      case 'unpacked':
        return t('shell.about.updateUnpacked');
      case 'browser':
        return t('shell.about.updateBrowser');
      case 'node':
        return t('shell.about.updateNode');
      case 'source':
        return t('shell.about.updateSource');
      default:
        return t('shell.about.updateUnsupported');
    }
  };

  const statusText = (): string => {
    if (!update) return t('shell.about.updateReading');
    // 初始化就失败（例如包里缺 app-update.yml）：把原因显示出来，比一句「不支持」有用
    if (!update.supported) {
      return update.error ? t('shell.about.updateError', { msg: update.error }) : unsupportedText();
    }
    switch (update.phase) {
      case 'checking':
        return t('shell.about.updateChecking');
      case 'latest':
        return t('shell.about.updateLatest');
      case 'available':
        return t('shell.about.updateAvailable', { version: update.version ?? '' });
      case 'downloading':
        return t('shell.about.updateDownloading', { percent: Math.round(update.percent ?? 0) });
      case 'downloaded':
        // Electron 关了应用也会在退出时装；WSL 包必须点「立即重启」才会跑换目录脚本
        return update.mode === 'node' ? t('shell.about.updateDownloadedNode') : t('shell.about.updateDownloaded');
      case 'error':
        return t('shell.about.updateError', { msg: update.error ?? '' });
      default:
        return t('shell.about.updateIdle');
    }
  };

  const supported = update?.supported === true;
  const canCheck =
    supported &&
    !busy &&
    update?.phase !== 'checking' &&
    update?.phase !== 'available' &&
    update?.phase !== 'downloading' &&
    update?.phase !== 'downloaded';
  const proxyLocked =
    proxyBusy ||
    update?.phase === 'checking' ||
    update?.phase === 'downloading' ||
    update?.phase === 'downloaded';
  const releaseDate = update?.releaseDate ? update.releaseDate.slice(0, 10) : '';

  return (
    <ModalShell
      // 关于
      title={t('shell.about.title')}
      width={440}
      onClose={props.onClose}
      foot={
        <button className="primary" onClick={props.onClose}>
          {/* 确定 */}
          {t('common.ok')}
        </button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 4px' }}>
        <img src="/icon.png" width="52" height="52" alt="logo" style={{ borderRadius: 10 }} />
        <div>
          {/* svn-git 文件版本管理 */}
          <div style={{ fontWeight: 600, fontSize: 16 }}>{t('shell.appName')}</div>
          {/* SVN / Git 双引擎图形化版本管理工具 */}
          <div className="dim small">{t('shell.about.tagline')}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, lineHeight: 2 }}>
        <div>
          {/* 版本： / （读取失败） */}
          <span className="dim">{t('shell.about.version')}</span>v{props.version || t('shell.about.versionFailed')}
          {/* 构建提交（括号里那个）：这个包打自哪次代码；带 * = 构建时工作区有未提交改动 */}
          {props.commit ? (
            <Tooltip content={props.dirty ? t('shell.about.dirty') : ''}>
              <span className="dim">
                （{props.commit}
                {props.dirty ? '*' : ''}）
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div>
          {/* 构建日期： */}
          <span className="dim">{t('shell.about.buildDate')}</span>
          {/* （未生成，npm run build 后更新） */}
          {props.buildDate || t('shell.about.buildDateMissing')}
        </div>
      </div>

      {/* 在线升级区：版本信息下方单独一条分隔线。远程查看者不显示（升级的是本机程序，
          且相关接口在访问门禁里是本机专属，远程点了也只会 403） */}
      {props.local !== false && (
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          {/* 更新： */}
          <span className="dim" style={{ flexShrink: 0 }}>{t('shell.about.updateLabel')}</span>
          <span className="small" style={{ flex: 1, minWidth: 0 }}>{statusText()}</span>
          {canCheck && (
            <button className="mini" disabled={busy} onClick={check}>
              {update?.phase === 'error' ? t('shell.about.updateRetry') : t('shell.about.updateCheck')}
            </button>
          )}
        </div>

        {/* 有新版：日期 / 大小（版本号已经在上面那行） */}
        {update?.phase === 'available' && (
          <div className="small dim" style={{ marginTop: 2 }}>
            {releaseDate}
            {update.sizeBytes ? `${releaseDate ? ' · ' : ''}${formatSize(update.sizeBytes)}` : ''}
          </div>
        )}

        {/* 下载进度 */}
        {update?.phase === 'downloading' && (
          <>
            <div style={{ height: 4, background: 'var(--panel2)', borderRadius: 2, margin: '6px 0 4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, Math.round(update.percent ?? 0)))}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width .3s',
                }}
              />
            </div>
            <div className="small dim">
              {formatSize(update.transferred ?? 0)} / {formatSize(update.total ?? 0)}
              {update.bytesPerSecond ? ` · ${formatSize(update.bytesPerSecond)}/s` : ''}
            </div>
          </>
        )}

        {/* 有新版：立即更新 / 查看发布页 */}
        {update?.phase === 'available' && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="mini" disabled={busy} onClick={download}>
              {t('shell.about.updateDownload')}
            </button>
            <button className="mini" onClick={openReleases}>
              {t('shell.about.updateReleasePage')}
            </button>
          </div>
        )}

        {/* 下载完成：立即重启 */}
        {update?.phase === 'downloaded' && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="primary" onClick={install}>
              {t('shell.about.updateInstall')}
            </button>
            <button className="mini" onClick={openReleases}>
              {t('shell.about.updateReleasePage')}
            </button>
          </div>
        )}

        {/* 免安装版不能自动替换：给个去发布页的入口 */}
        {update?.mode === 'portable' && (
          <div style={{ marginTop: 8 }}>
            <button className="mini" onClick={openReleases}>
              {t('shell.about.updateReleasePage')}
            </button>
          </div>
        )}

        {installError && (
          <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>{installError}</div>
        )}

        {/* 下载加速：默认勾选（国内直连 GitHub Releases 常失败）；可改成自己的中转前缀 */}
        {supported && (
          <div style={{ marginTop: 10 }}>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={proxyEnabled}
                disabled={proxyLocked}
                onChange={(e) => saveProxy(e.target.checked, proxyPrefix)}
              />
              {/* 下载加速 */}
              {t('shell.about.updateProxy')}
            </label>
            {proxyEnabled && (
              <>
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <input
                    type="text"
                    value={proxyPrefix}
                    placeholder={t('shell.about.updateProxyPlaceholder')}
                    onChange={(e) => setProxyPrefix(e.target.value)}
                    onBlur={() => saveProxy(proxyEnabled, proxyPrefix)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    disabled={proxyLocked}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '4px 8px',
                      background: 'var(--panel2)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                </div>
                {/* 更新包会经过第三方服务器；加速失败时主进程会自动尝试直连 */}
                <div className="small" style={{ color: 'var(--warn)', marginTop: 6, lineHeight: 1.6 }}>
                  {t('shell.about.updateProxyRisk')}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      )}
    </ModalShell>
  );
}
