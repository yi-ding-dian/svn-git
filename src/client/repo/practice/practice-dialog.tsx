/** 练习仓库弹窗（容器）：类型/父目录/场景 → 创建 → 交给上层自动打开 */
import React, { useEffect, useMemo, useState } from 'react';
import { get, post } from '../../shared/api.js';
import { ModalShell } from '../../shell/modal-shell.js';
import { joinPath } from '../../shared/utils.js';
import { t } from '../../../shared/i18n/index.js';
import { OpenBrowser } from '../open.js';
import { DEFAULT_SCENARIOS, type PracticeScenarios, type PracticeType } from './practice-shared.js';

export function PracticeRepoDialog(props: {
  onClose: () => void;
  /** 创建成功后打开工作副本（复用「打开项目」链路，由 modal-host 提供） */
  onOpened: (dir: string) => void;
  /** 目录浏览的起始位置（通常是用户 home） */
  startDir?: string;
  onToast?: (msg: string, err?: boolean) => void;
}) {
  const [type, setType] = useState<PracticeType>('git');
  const [parentDir, setParentDir] = useState('');
  /** 目录浏览视图（复用「打开项目」的 pick 模式：路径输入 + 网格 + 选择此目录） */
  const [picking, setPicking] = useState(false);
  const [scenarios, setScenarios] = useState<PracticeScenarios>(DEFAULT_SCENARIOS);
  /** SVN：多项目布局（版本库内 projects/demo-project/…）——项目迁移/多项目练习用 */
  const [projectLayout, setProjectLayout] = useState(false);
  const [probe, setProbe] = useState<{ git: boolean; svn: boolean; svnadmin: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    get
      .practiceProbe()
      .then(setProbe)
      .catch(() => setProbe({ git: false, svn: false, svnadmin: false }));
  }, []);

  const gitAvailable = probe?.git !== false;
  const svnAvailable = probe ? probe.svn && probe.svnadmin : true;

  // 探测结果回来发现当前类型不可用 → 自动切到可用的那个
  useEffect(() => {
    if (!probe) return;
    if (type === 'git' && !gitAvailable && svnAvailable) setType('svn');
    if (type === 'svn' && !svnAvailable && gitAvailable) setType('git');
  }, [probe, type, gitAvailable, svnAvailable]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await post.practiceCreate({ type, parentDir, scenarios, projectLayout: type === 'svn' ? projectLayout : undefined });
      if (!r.ok || !r.workDir) {
        setError(r.message || t('repo.practice.failed'));
        return;
      }
      // 成功后由上层关闭弹窗并打开新仓库
      props.onOpened(r.workDir);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const typeUnavailable = !probe ? false : type === 'git' ? !gitAvailable : !svnAvailable;
  const typeMissing = type === 'git' ? t('repo.practice.gitMissing') : t('repo.practice.svnMissing');
  const canCreate = !busy && Boolean(parentDir.trim()) && !typeUnavailable;

  /** 生成路径预览：与后端同名规则（<父目录>/svn-git-practice/<类型>-<时间戳>）。
   *  秒级时间戳在真正创建时定稿，这里只是预览；目录/类型变化时重新取时间。 */
  const previewRoot = useMemo(() => {
    const parent = parentDir.trim();
    if (!parent) return '';
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return joinPath(joinPath(parent, 'svn-git-practice'), `${type}-${stamp}`);
  }, [parentDir, type]);

  return (
    <ModalShell
      icon={<span>🧪</span>}
      title={picking ? t('repo.practice.pickTitle') : t('repo.practice.title')}
      onClose={props.onClose}
      width={620}
      closeIcon
      hideFoot={picking}
      foot={
        <>
          <button onClick={props.onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="primary" disabled={!canCreate} onClick={() => void create()}>
            {busy ? t('repo.practice.creating') : t('repo.practice.create')}
          </button>
        </>
      }
    >
      {picking ? (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="mini" onClick={() => setPicking(false)}>← {t('repo.practice.back')}</button>
          </div>
          {/* 复用「打开项目」的目录浏览（pick 模式：路径输入 + 网格 + 选择此目录） */}
          <OpenBrowser
            startDir={parentDir || props.startDir || ''}
            showRecents={false}
            pick={{
              onPick: (dir) => {
                setParentDir(dir);
                setPicking(false);
                setError('');
              },
            }}
            onToast={props.onToast}
          />
        </>
      ) : (
        <>
      <div className="small dim" style={{ marginBottom: 12 }}>{t('repo.practice.intro')}</div>

      {/* 类型：缺命令的选项禁用并说明原因 */}
      <div className="row" style={{ gap: 16, marginBottom: 4 }}>
        <strong>{t('repo.practice.typeLabel')}</strong>
        <label className="row" style={{ gap: 4, cursor: gitAvailable ? 'pointer' : 'not-allowed' }} title={gitAvailable ? undefined : t('repo.practice.gitMissing')}>
          <input type="radio" name="practice-type" checked={type === 'git'} disabled={!gitAvailable} onChange={() => setType('git')} />
          {t('repo.practice.typeGit')}
        </label>
        <label className="row" style={{ gap: 4, cursor: svnAvailable ? 'pointer' : 'not-allowed' }} title={svnAvailable ? undefined : t('repo.practice.svnMissing')}>
          <input type="radio" name="practice-type" checked={type === 'svn'} disabled={!svnAvailable} onChange={() => setType('svn')} />
          {t('repo.practice.typeSvn')}
        </label>
      </div>
      <div className="dim small" style={{ marginBottom: 12 }}>
        {type === 'git' ? t('repo.practice.typeGitTip') : t('repo.practice.typeSvnTip')}
      </div>

      {/* 父目录：浏览视图复用「打开项目」的目录选择（路径输入 + 网格 + 选择此目录） */}
      <div className="row" style={{ marginBottom: 6 }}>
        <input
          type="text"
          style={{ flex: 1 }}
          // 选择一个已存在、可写的目录
          placeholder={t('repo.practice.parentPlaceholder')}
          value={parentDir}
          onChange={(e) => setParentDir(e.target.value)}
        />
        <button onClick={() => setPicking(true)} title={t('repo.practice.browseTip')}>{t('repo.practice.browse')}</button>
      </div>
      <div className="dim small" style={{ marginBottom: 12 }}>{t('repo.practice.pathNote')}</div>

      {/* 场景：基础固定；远程同步仅 Git；冲突可选 */}
      <div style={{ marginBottom: 6 }}><strong>{t('repo.practice.scenarios')}</strong></div>
      <label className="row" style={{ gap: 6, marginBottom: 4, cursor: 'default' }}>
        <input type="checkbox" checked disabled />
        <span>{t('repo.practice.basic')}</span>
        <span className="dim small">{t('repo.practice.basicTip')}</span>
      </label>
      {/* 远程同步只对 Git 有意义：SVN 下整行不显示（没有 fetch/upstream 概念） */}
      {type === 'git' && (
        <label className="row" style={{ gap: 6, marginBottom: 4, cursor: 'pointer' }} title={t('repo.practice.remoteTip')}>
          <input
            type="checkbox"
            checked={scenarios.remote}
            onChange={(e) => setScenarios((s) => ({ ...s, remote: e.target.checked }))}
          />
          <span>{t('repo.practice.remote')}</span>
          <span className="dim small">{t('repo.practice.remoteTip')}</span>
        </label>
      )}
      {/* 多项目布局仅 SVN 有：版本库内 projects/demo-project/{trunk,branches,tags}，
          项目根不再等于版本库根，才能练习「项目迁移 → 独立项目」 */}
      {type === 'svn' && (
        <label className="row" style={{ gap: 6, marginBottom: 4, cursor: 'pointer' }} title={t('repo.practice.projectLayoutTip')}>
          <input type="checkbox" checked={projectLayout} onChange={(e) => setProjectLayout(e.target.checked)} />
          <span>{t('repo.practice.projectLayout')}</span>
          <span className="dim small">{t('repo.practice.projectLayoutTip')}</span>
        </label>
      )}
      <label className="row" style={{ gap: 6, marginBottom: 10, cursor: 'pointer' }} title={t('repo.practice.conflictTip')}>
        <input
          type="checkbox"
          checked={scenarios.conflict}
          onChange={(e) => setScenarios((s) => ({ ...s, conflict: e.target.checked }))}
        />
        <span>{t('repo.practice.conflict')}</span>
        <span className="dim small">{t('repo.practice.conflictTip')}</span>
      </label>

      {/* 生成路径预览：选完父目录后明确告诉用户会建到哪里、里面有什么 */}
      <div style={{ marginTop: 10, padding: '8px 10px', border: '1px dashed var(--border)', borderRadius: 6 }}>
        <div className="dim small" style={{ marginBottom: 4 }}>{t('repo.practice.previewLabel')}</div>
        {previewRoot ? (
          <div className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {previewRoot}
            {'\n'}
            {type === 'git'
              ? `  remote.git/  ${t('repo.practice.previewRemote')}\n  work/        ${t('repo.practice.previewWork')}`
              : projectLayout
                ? `  repo/        ${t('repo.practice.previewRepoMulti')}\n  work/        ${t('repo.practice.previewWork')}`
                : `  repo/        ${t('repo.practice.previewRepo')}\n  work/        ${t('repo.practice.previewWork')}`}
          </div>
        ) : (
          <div className="dim small">{t('repo.practice.previewEmpty')}</div>
        )}
        {previewRoot && <div className="dim small" style={{ marginTop: 4 }}>{t('repo.practice.previewNote')}</div>}
      </div>

      {error && <div className="small" style={{ color: 'var(--err)', whiteSpace: 'pre-wrap' }}>{error}</div>}
      {typeUnavailable && <div className="small" style={{ color: 'var(--warn)' }}>{typeMissing}</div>}
        </>
      )}
    </ModalShell>
  );
}
