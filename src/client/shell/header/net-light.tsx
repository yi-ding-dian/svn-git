/** 顶栏远程网络状态灯：独立于仓库操作，只关心"远程服务达不达得到"。 */
import React, { useCallback, useEffect, useState } from 'react';
import { get } from '../../shared/api.js';
import { t } from '../../../shared/i18n/index.js';

/**
 * 远程网络状态灯：30s 检测一次（get /api/net-check，只握手不取数据）。
 * 最近 3 次滑动窗口 → 全成功=绿、混合=黄（时通时断）、连续失败=红、未出结果=灰。
 * 认证失败=网络通的（绿，tooltip 说明）。点击圆点可立即手动检测。
 */
export function NetLight({ hostCheckKey }: { hostCheckKey?: string }) {
  const [lastResult, setLastResult] = useState<{ ok: boolean; reason: string; at: number } | null>(null);
  const [history, setHistory] = useState<boolean[]>([]);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await get.netCheck();
      setLastResult({ ok: r.ok, reason: r.reason, at: Date.now() });
      setHistory((h) => [...h.slice(-2), r.ok]); // 滚动保留最近 3 次
    } catch {
      // 检测请求失败
      setLastResult({ ok: false, reason: t('shell.net.checkFailed'), at: Date.now() });
      setHistory((h) => [...h.slice(-2), false]);
    } finally {
      setChecking(false);
    }
  }, []);

  // 30s 周期 + 仓库变化时立即检测；页签隐藏暂停、切回补检
  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [check, hostCheckKey]);

  const h = history;
  const n = h.length;
  let color = 'var(--dim)'; // 灰:未出结果
  // 检测中…
  let label = t('shell.net.checking');
  if (n > 0) {
    const allOk = h.every(Boolean);
    // 远程网络正常
    if (allOk && n >= 2) { color = 'var(--ok)'; label = t('shell.net.ok'); }
    // 远程网络断开
    else if (!allOk && !h.some(Boolean)) { color = 'var(--err)'; label = t('shell.net.down'); }
    // 远程网络不稳定（近期检测有成功有失败）
    else { color = 'var(--warn)'; label = t('shell.net.unstable'); }
    // 远程网络正常
    if (h[0] === true && n === 1) { color = 'var(--ok)'; label = t('shell.net.ok'); } // 首检成功即绿
  }
  const tip = lastResult
    // 最近检测 {n} 秒前 / （{reason}） / 检测中… / 点击立即检测
    ? `${label} · ${t('shell.net.tipAgo', { n: Math.max(0, Math.round((Date.now() - lastResult.at) / 1000)) })}${lastResult.reason ? t('shell.net.tipReason', { reason: lastResult.reason }) : ''}${checking ? ` · ${t('shell.net.checking')}` : ''} · ${t('shell.net.tipClick')}`
    // 网络状态检测中…
    : t('shell.net.tipNoResult');
  return (
    <span
      className="dim small nowrap"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      title={tip}
      onClick={() => void check()}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', background: color,
          boxShadow: color === 'var(--dim)' ? 'none' : `0 0 0 3px ${color}33`, display: 'inline-block',
        }}
      />
    </span>
  );
}
