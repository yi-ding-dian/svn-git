/** 新建 / 获取仓库弹窗：新建仓库（CreateRepoDialog，git init / svnadmin create）+ 获取仓库（GetRepoDialog，git clone / svn checkout） */
import React, { useState } from 'react';
import { post, type RepoCheck } from '../api.js';
import { ModalShell, ResizableModal } from '../modal-shell.js';
import { IconDownload, IconPlus } from '../icons.js';
import { DirPicker } from '../dir-picker.js';
import { HelpNote, FormRow } from '../ui.js';
import { ConfirmModal } from '../modals.js';
import { cmdOfRepo } from '../cmd-preview.js';
import { ResultLine, runAction } from './common.js';
// ==================== 创建 / 克隆仓库 ====================

export function CreateRepoDialog(props: { home?: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [standard, setStandard] = useState(true); // svn 标准布局（trunk/branches/tags），默认勾选
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false); // 文件夹浏览选择器
  const [pending, setPending] = useState<RepoCheck | null>(null); // 二次确认数据（打开确认框）

  const submit = () => {
    if (!dir.trim() || !name.trim()) {
      setMsg('请填写目录和名称');
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  // 二次确认后执行创建
  const doCreate = () => {
    setPending(null);
    setBusy(true);
    void runAction(
      () => post.repoCreate(type, dir.trim(), name.trim(), '', standard),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      // 打开服务端返回的仓库路径（git=目标目录；svn=xxx-wc 工作副本），没返回时兜底拼路径
      (r) => props.onCreated(r.repoDir ?? `${dir.trim().replace(/\/$/, '')}/${name.trim()}`)
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      icon={<IconPlus size={16} />}
      title="新建仓库"
      onClose={props.onClose}
      width={540}
      foot={
        <>
          <button onClick={props.onClose}>关闭</button>
          <button
            className="primary"
            disabled={busy}
            onClick={submit}
            title={
              `${
                type === 'git'
                  ? (cmdOfRepo('git', 'init', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
                  : (cmdOfRepo('svn', 'create', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
              }`
            }
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <HelpNote>
        两种方式：Git 仓库 = 在本地目录初始化新仓库（git init）；SVN 仓库 = 用 svnadmin 创建本地仓库，默认创建标准布局（trunk / branches / tags）并检出 trunk 作为工作副本（目录名 + "-wc"）。
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            ['git', 'Git 仓库 (init)'],
            ['svn', 'SVN 仓库（svnadmin）'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      <FormRow label="所在目录（父目录路径）">
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <button className="mini tool-btn" title="打开文件夹浏览（可新建/重命名文件夹）" onClick={() => setPicker(true)}>
            📂 浏览
          </button>
        </div>
      </FormRow>
      <FormRow label="仓库名称">
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </FormRow>
      <div className="dim small" style={{ whiteSpace: 'pre-line' }}>
        {(() => {
          const base = `${dir.trim().replace(/\/$/, '')}/${name.trim() || '…'}`;
          if (type === 'git') return `将创建：Git 仓库 ${base}\ngit init 创建，创建后自动打开`;
          return `将创建：SVN 版本库 ${base}（服务器存储，不能直接编辑）\n并检出工作副本 ${base}-wc（创建后自动打开；日常编辑、添加、提交都在工作副本进行）`;
        })()}
      </div>
      {/* SVN 标准布局选项（默认勾选，非标准布局仓库分支管理受限） */}
      {type === 'svn' && (
        <>
          <label className="row" style={{ gap: 6, marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} />
            <span className="small">创建标准布局（trunk / branches / tags），工作副本检出 trunk</span>
          </label>
          {!standard && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
              ⚠ 不创建标准布局：分支 / 标签管理将不可用（后续无法自动创建分支和标签）
            </div>
          )}
        </>
      )}
      <ResultLine msg={msg} err={msgErr} />
      {/* 二次确认：目标路径 + 命令 + 风险检测 */}
      {pending && (
        <ConfirmModal
          title="确认创建仓库？"
          message={
            <>
              <div>目标路径：{pending.target}</div>
              <div>将执行：{type === 'git' ? 'git init 初始化仓库' : 'svnadmin create 创建版本库 + 检出工作副本'}（命令预览见按钮）</div>
              {pending.inRepo && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标位于 {pending.inRepo.type.toUpperCase()} 仓库内（{pending.inRepo.root}）——在其内部创建会成为外层仓库的未版本化内容，状态/数据可能错乱
                </div>
              )}
              {pending.existsNonEmpty && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标目录已存在且非空（{pending.target}）——可能已有仓库/文件，继续创建可能失败或产生嵌套
                </div>
              )}
            </>
          }
          confirmLabel="确认创建"
          confirmCmd={
            type === 'git'
              ? (cmdOfRepo('git', 'init', { dir: pending.target }) ?? '')
              : (cmdOfRepo('svn', 'create', { dir: pending.target }) ?? '')
          }
          onConfirm={doCreate}
          onCancel={() => setPending(null)}
        />
      )}
      {/* 文件夹浏览选择器：新建/重命名，确定填充所在目录 */}
      {picker && (
        <div className="modal-mask">
          <ResizableModal width={640}>
            <h3>📂 选择所在目录</h3>
            <div className="body">
              <DirPicker
                startDir={props.home ?? ''}
                onPick={(p) => {
                  setDir(p);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            </div>
          </ResizableModal>
        </div>
      )}
    </ModalShell>
  );
}

/** 获取仓库：Git 克隆 / SVN 检出（成员从服务器/远程获取工作副本，不是新建） */
export function GetRepoDialog(props: { home?: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [url, setUrl] = useState('');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState<RepoCheck | null>(null); // 二次确认数据

  const submit = () => {
    if (!url.trim()) {
      setMsg('请填写地址（URL）');
      setMsgErr(true);
      return;
    }
    if (!dir.trim() || !name.trim()) {
      setMsg('请填写目标和名称');
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim(), url.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  // 二次确认后执行获取
  const doGet = () => {
    setPending(null);
    setBusy(true);
    void runAction(
      () => post.repoCreate(type, dir.trim(), name.trim(), url.trim(), true),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      // 打开服务端返回的仓库路径（git/svn 均为目标目录），没返回时兜底拼路径
      (r) => props.onCreated(r.repoDir ?? `${dir.trim().replace(/\/$/, '')}/${name.trim()}`)
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      icon={<IconDownload size={16} />}
      title="获取仓库"
      onClose={props.onClose}
      width={540}
      foot={
        <>
          <button onClick={props.onClose}>关闭</button>
          <button
            className="primary"
            disabled={busy}
            onClick={submit}
            title={
              `${
                type === 'git'
                  ? (cmdOfRepo('git', 'clone', { url: url.trim() || '…', dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
                  : (cmdOfRepo('svn', 'checkout', { url: url.trim() || '…', dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
              }`
            }
          >
            {busy ? '获取中…' : '获取'}
          </button>
        </>
      }
    >
      <HelpNote>
        两种方式：Git 克隆 = git clone（从地址复制一份到本地）；SVN 检出 = svn checkout（从服务器获取工作副本，目标目录即本地名称）。
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            ['git', 'Git 克隆'],
            ['svn', 'SVN 检出'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      <FormRow label="地址（URL）">
        <input
          type="text"
          placeholder={type === 'git' ? 'https://github.com/xxx/repo.git' : 'http://192.168.0.30:8080/software2/projects/xxx/trunk'}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormRow>
      <FormRow label="所在目录（父目录路径）">
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <button className="mini tool-btn" title="打开文件夹浏览（可新建/重命名文件夹）" onClick={() => setPicker(true)}>
            📂 浏览
          </button>
        </div>
      </FormRow>
      <FormRow label="本地名称（工作副本名）">
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </FormRow>
      <div className="dim small" style={{ whiteSpace: 'pre-line' }}>
        {(() => {
          const base = `${dir.trim().replace(/\/$/, '')}/${name.trim() || '…'}`;
          const u = url.trim() || '…';
          if (type === 'git') return `将克隆：${u} → ${base}\ngit clone 后自动打开`;
          return `将检出：${u} → ${base}\nsvn checkout 后自动打开（SVN 建议检出 trunk 或目标分支/标签）`;
        })()}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {/* 二次确认：目标路径 + 命令 + 风险检测 */}
      {pending && (
        <ConfirmModal
          title="确认获取仓库？"
          message={
            <>
              <div>目标路径：{pending.target}</div>
              <div>将执行：{type === 'git' ? `git clone ${url.trim()}` : `svn checkout ${url.trim()}`}（命令预览见按钮）</div>
              {pending.inRepo && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标位于 {pending.inRepo.type.toUpperCase()} 仓库内（{pending.inRepo.root}）——检出的文件会成为外层仓库的未版本化内容，状态/数据可能错乱
                </div>
              )}
              {pending.existsNonEmpty && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标目录已存在且非空（{pending.target}）——克隆/检出到非空目录会失败，可能已有仓库/文件
                </div>
              )}
            </>
          }
          confirmLabel="确认获取"
          confirmCmd={
            type === 'git'
              ? (cmdOfRepo('git', 'clone', { url: url.trim(), dir: pending.target }) ?? '')
              : (cmdOfRepo('svn', 'checkout', { url: url.trim(), dir: pending.target }) ?? '')
          }
          onConfirm={doGet}
          onCancel={() => setPending(null)}
        />
      )}
      {/* 文件夹浏览选择器：选择所在目录 */}
      {picker && (
        <div className="modal-mask">
          <ResizableModal width={640}>
            <h3>📂 选择所在目录</h3>
            <div className="body">
              <DirPicker
                startDir={props.home ?? ''}
                onPick={(p) => {
                  setDir(p);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            </div>
          </ResizableModal>
        </div>
      )}
    </ModalShell>
  );
}
