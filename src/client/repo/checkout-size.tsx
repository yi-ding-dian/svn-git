/** 检出大小检测弹窗（检出弹窗「检测大小」按钮打开，按需触发）：
 *  流式读 /api/repo-size 的 NDJSON——数字实时滚动（大仓库要十几到几十秒，避免看起来卡死）、
 *  随时可取消（取消/关闭 = 断开请求 → 后端据此杀掉全部 svn 子进程）；
 *  完成后定格，可「重新检测」（服务端有缓存时秒出）。范围 = 打开时的勾选（含根目录文件）。 */
import React, { useEffect, useState } from 'react';
import { get } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { ResultLine } from '../ui/result-line.js';
import { t } from '../../shared/i18n/index.js';

/** 字节数 → B/KB/MB/GB（M 到 G 自动进位；小数值保留一位，读起来不跳） */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`;
}

export function CheckoutSizeDialog(props: {
  /** 要检测的远程 URL（检出目标） */
  url: string;
  /** 检出范围（勾选的相对路径；空 = 整个 URL） */
  include: string[];
  onClose: () => void;
}) {
  const [stat, setStat] = useState<{ files: number; dirs: number; bytes: number } | null>(null);
  const [phase, setPhase] = useState<'run' | 'done' | 'fail'>('run');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [nonce, setNonce] = useState(0);
  /** include 数组每次渲染都是新引用：用 join 键做依赖（内容变才重跑） */
  const incKey = props.include.join(',');

  useEffect(() => {
    const ac = new AbortController();
    setStat(null);
    setPhase('run');
    setNote('');
    setErr('');
    get
      .repoSize(
        props.url,
        props.include,
        (tk) => {
          if (tk.error) {
            setPhase('fail');
            setErr(tk.error);
            return;
          }
          if (tk.done) {
            setStat({ files: tk.files, dirs: tk.dirs, bytes: tk.bytes });
            setPhase('done');
            if (tk.partial) setNote(t('repo.co.sizePartial'));
          } else {
            setStat({ files: tk.files, dirs: tk.dirs, bytes: tk.bytes });
          }
        },
        ac.signal,
      )
      .catch((e: Error) => {
        if (!ac.signal.aborted) {
          setPhase('fail');
          setErr(e.message);
        }
      });
    return () => ac.abort();
    // include 内容变化用 incKey 表达（数组引用每渲染都变）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.url, incKey, nonce]);

  /** 结束前且规模已可观：提示「需要一些时间」（小仓库不会看到这行） */
  const heavy = phase === 'run' && stat !== null && (stat.files > 2000 || stat.dirs > 500);

  return (
    <ModalShell
      icon="🔍"
      // 检出大小检测
      title={t('repo.co.sizeTitle')}
      onClose={props.onClose}
      width={400}
      closeIcon
      foot={
        phase === 'run' ? (
          // 取消检测
          <button onClick={props.onClose}>{t('repo.co.sizeCancel')}</button>
        ) : (
          <>
            {/* 重新检测（服务端有缓存时秒出） */}
            <button onClick={() => setNonce((n) => n + 1)}>{t('repo.co.sizeRetry')}</button>
            <button className="primary" onClick={props.onClose}>
              {t('common.close')}
            </button>
          </>
        )
      }
    >
      {/* 检测范围：勾选的目录数 / 完整检出 */}
      <div className="dim small">
        {props.include.length > 0 ? t('repo.co.sizeScopePicked', { n: props.include.length }) : t('repo.co.sizeScopeAll')}
      </div>
      <div className="mono" style={{ fontSize: 22, textAlign: 'center', margin: '14px 0 6px' }}>
        {stat ? fmtBytes(stat.bytes) : '—'}
      </div>
      <div className="dim small" style={{ textAlign: 'center' }}>
        {/* 已扫描 {dirs} 个目录 · {files} 个文件 / 检测中… */}
        {stat ? t('repo.co.sizeDetail', { dirs: stat.dirs, files: stat.files }) : t('repo.co.sizeScanning')}
      </div>
      {heavy && (
        <div className="dim small" style={{ textAlign: 'center', marginTop: 10 }}>
          {/* 当前文件数量过多，检测需要一些时间 */}
          {t('repo.co.sizeHeavy')}
        </div>
      )}
      {phase === 'done' && (
        <div className="small" style={{ textAlign: 'center', marginTop: 10, color: 'var(--ok)' }}>
          {/* 检测完成 */}
          {t('repo.co.sizeDone')}
        </div>
      )}
      {note && (
        <div className="dim small" style={{ textAlign: 'center', marginTop: 6 }}>
          {note}
        </div>
      )}
      <ResultLine msg={err} err />
    </ModalShell>
  );
}
