/** GitHub 仓库信息弹窗（顶栏 ⋯ 菜单入口；仅 origin 指向 github.com 的项目可见）：
 *  一屏卡片——描述 / Stars·Forks·Issues·Watchers / 许可 / 最近推送 / Topics / 语言构成条。
 *  数据来自 /api/github-repo（服务端代问 GitHub 官方，缓存 30 分钟）；接口不通时降级
 *  本地统计（顶部如实说明原因）。「在浏览器打开」走 /api/open-url（系统默认浏览器）；
 *  刷新按钮 = force 跳过服务端缓存重新拉（网络恢复后不用等缓存过期）。 */

import React, { useEffect, useState } from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { get, post, type GitHubRepoResult } from '../shared/api.js';
import { IconGitHub, IconStar, IconClock, IconEye, IconRefresh, IconExternal } from '../ui/icons.js';
import { t } from '../../shared/i18n/index.js';

/** GitHub 官方语言配色（常见子集）；未收录的语言按兜底色板轮转（顺序稳定） */
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Java: '#b07219', Python: '#3572A5',
  'C#': '#178600', 'C++': '#f34b7d', C: '#555555', Go: '#00ADD8', Rust: '#dea584',
  Ruby: '#701516', PHP: '#4F5D95', Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c',
  SCSS: '#c6538c', Vue: '#41b883', Svelte: '#ff3e00', Kotlin: '#A97BFF', Swift: '#F05138',
  Dart: '#00B4AB', 'Objective-C': '#438eff', Lua: '#000080', Perl: '#0298c3', R: '#198CE7',
  Scala: '#c22d40', Groovy: '#4298b8', PowerShell: '#012456', Batchfile: '#C1F12E',
  Makefile: '#427819', Dockerfile: '#384d54', CMake: '#DA3434', Markdown: '#083fa1',
  JSON: '#292929', YAML: '#cb171e', XML: '#0060ac', SQL: '#e38c00', TeX: '#3D6117',
  Assembly: '#6E4C13', Haskell: '#5e5086', Elixir: '#6e4a7e', Erlang: '#B83998',
  Clojure: '#db5855', 'Jupyter Notebook': '#DA5B0B', Zig: '#ec915c', Nim: '#ffc200', Julia: '#a270ba',
};
const FALLBACK_COLORS = ['#8b949e', '#a371f7', '#e0b25c', '#58a6ff', '#3fb950', '#f85149'];

/** 语言构成（字节数）→ 排序 + 百分比；前 8 种单列，其余归并「其他语言」 */
function langRows(langs: Record<string, number>): { name: string; pct: number; color: string }[] {
  const total = Object.values(langs).reduce((a, b) => a + b, 0);
  if (!total) return [];
  const sorted = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  const rows = sorted.slice(0, 8).map(([name, bytes], i) => ({
    name,
    pct: (bytes / total) * 100,
    color: LANG_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
  }));
  const rest = sorted.slice(8);
  if (rest.length > 0) {
    rows.push({ name: t('repo.github.otherLangs'), pct: (rest.reduce((a, [, b]) => a + b, 0) / total) * 100, color: '#6e7681' });
  }
  return rows;
}

/** 相对时间（最近推送；复用"最近项目"的时间文案，补 小时/月/年 三档）。
 *  export 给「我的 GitHub 仓库」列表复用（同一套时间文案，别再实现第三份）。 */
export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return t('shell.time.justNow');
  if (mins < 60) return t('shell.time.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('shell.time.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('shell.time.daysAgo', { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('shell.time.monthsAgo', { n: months });
  return t('shell.time.yearsAgo', { n: Math.floor(months / 12) });
}

/** 语言构成条 + 图例（官方/本地两种来源共用） */
function LangBar(props: { rows: { name: string; pct: number; color: string }[] }) {
  if (props.rows.length === 0) {
    // （没有可统计的代码文件）
    return <div className="dim small">{t('repo.github.noLangs')}</div>;
  }
  return (
    <>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {props.rows.map((r) => (
          <div key={r.name} style={{ width: `${r.pct}%`, background: r.color }} title={`${r.name} ${r.pct.toFixed(1)}%`} />
        ))}
      </div>
      <div className="row small" style={{ gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
        {props.rows.map((r) => (
          <span key={r.name} className="row" style={{ gap: 5, alignItems: 'center' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.color, display: 'inline-block', flexShrink: 0 }} />
            {r.name} <span className="dim">{r.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </>
  );
}

export function GitHubRepoModal(props: { onClose: () => void }) {
  const [data, setData] = useState<GitHubRepoResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const load = (force = false) => {
    setBusy(true);
    setErr('');
    get
      .githubRepo(force)
      .then((r) => {
        setData(r);
        if (!r.ok) setErr(r.error ?? '');
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load(); // 初始加载走服务端缓存（30 分钟内直接秒出）；刷新按钮才 force 重拉
  }, []);

  const meta = data?.repo;
  const rows = data?.languages ? langRows(data.languages) : [];

  return (
    <ModalShell
      icon={<IconGitHub size={16} />}
      title={t('repo.github.title')}
      width={560}
      onClose={props.onClose}
      closeIcon
      hideFoot
      titleExtra={
        // 操作按钮固定在**标题栏右侧**（✕ 左侧，✕ 占 right 14~42px，这里接在 48px 处）。
        // 注意：ModalShell 的 titleExtra 是内联在标题文字之后渲染的，直接放会跟着标题流式排——
        // 窄了换行掉到标题下方、左对齐"悬挂"着（实报"位置不好"），故这里自己绝对定位到右上
        <span
          style={{ position: 'absolute', right: 48, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', gap: 6 }}
        >
          {meta && (
            <button className="mini" onClick={() => void post.openUrl(meta.htmlUrl)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <IconExternal size={12} />
                {/* 在浏览器打开 */}
                {t('repo.github.openInBrowser')}
              </span>
            </button>
          )}
          <button className="mini" onClick={() => load(true)} disabled={busy} title={t('repo.github.refreshTip')}>
            <IconRefresh size={12} />
          </button>
        </span>
      }
    >
      {busy ? (
        <div className="dim row" style={{ gap: 6, alignItems: 'center', padding: '8px 0' }}>
          <span className="search-spin" /> {t('ops.loading')}
        </div>
      ) : err && !meta ? (
        <div className="error small" style={{ wordBreak: 'break-all' }}>{err}</div>
      ) : (
        <>
          {/* 降级说明（拿不到 GitHub 官方数据：网络不通/限流/私有库） */}
          {data?.source === 'local' && (
            <div className="small" style={{ color: 'var(--warn)', marginBottom: 8, wordBreak: 'break-all' }}>
              {/* ⚠ GitHub 接口不可用（{msg}）——语言构成为本地统计 */}
              ⚠ {t('repo.github.localNote', { msg: data.error ?? '' })}
            </div>
          )}
          {meta && (
            <>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontWeight: 600 }}>{meta.fullName}</span>
                {meta.archived && (
                  <span className="dim small" style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>
                    {/* 已归档 */}
                    {t('repo.github.archived')}
                  </span>
                )}
              </div>
              {/* 描述（没有描述时也是 dim 的占位文案） */}
              <div className="small" style={{ margin: '6px 0', color: meta.description ? 'var(--text)' : 'var(--dim)' }}>
                {meta.description || t('repo.github.noDesc')}
              </div>
              {meta.homepage && (
                <div className="small" style={{ marginBottom: 6, wordBreak: 'break-all' }}>
                  <span className="dim">{t('repo.github.homepage')}: </span>
                  {meta.homepage}
                </div>
              )}
              {/* 数字行：Stars / Forks / Issues / Watchers / 许可 / 最近推送 */}
              <div className="row small" style={{ gap: 14, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
                <span className="row" style={{ gap: 4, alignItems: 'center' }} title={t('repo.github.stars')}>
                  <IconStar size={13} /> {meta.stars}
                </span>
                <span>{meta.forks} {t('repo.github.forks')}</span>
                <span>{meta.issues} {t('repo.github.issues')}</span>
                <span className="row" style={{ gap: 4, alignItems: 'center' }} title={t('repo.github.watchers')}>
                  <IconEye size={13} /> {meta.watchers}
                </span>
                {meta.license && <span>{meta.license}</span>}
                {meta.pushedAt && (
                  <span className="row" style={{ gap: 4, alignItems: 'center' }} title={t('repo.github.pushed')}>
                    <IconClock size={13} /> {relTime(meta.pushedAt)}
                  </span>
                )}
              </div>
              {/* Topics */}
              {meta.topics.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
                  {meta.topics.map((tp) => (
                    <span key={tp} className="dim small" style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 8px' }}>
                      {tp}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          {/* 语言构成（官方 Linguist 统计 / 降级本地统计） */}
          <div style={{ marginTop: 10 }}>
            <div className="dim small" style={{ marginBottom: 5 }}>
              {/* 语言构成（本地统计） */}
              {t('repo.github.langs')}
              {data?.source === 'local' ? t('repo.github.localSuffix') : ''}
            </div>
            <LangBar rows={rows} />
          </div>
        </>
      )}
    </ModalShell>
  );
}
