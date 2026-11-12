/** 标签管理弹窗（TagDialog，含 RemoteList 辅助）：SVN 标签 = tags/ 目录快照；Git 标签 = ref。
 *  SVN/Git 共用列表渲染，按 repoType 区分帮助文案、检出方式与详情（Git 带发布说明/远程列表，
 *  SVN 带版本/作者/时间）。入口：工具栏「标签」。 */
import React, { useEffect, useMemo, useState } from 'react';
import { get, post, type SvnLayout } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconTag } from '../ui/icons.js';
import { Tooltip } from '../ui/tooltip.js';
import { HelpNote } from '../ui/ui.js';
import { ConfirmModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { isImeComposing } from '../shared/utils.js';
import { runAction } from '../shared/vcs-action.js';
import { ResultLine } from '../ui/result-line.js';
import { t } from '../../shared/i18n/index.js';
import { LayoutNote } from './layout-note.js';

// ==================== 标签管理 ====================

/** 标签行数据：点「检出」时交给 shell 层（SVN 用标签目录 URL；Git 用克隆来源 + ref） */
export interface TagEntry {
  repoType: 'svn' | 'git';
  name: string;
  /** svn：标签目录 URL；git：克隆来源（origin；无 origin 时本地仓库路径） */
  url: string;
  /** svn：版本号；git：标签指向的提交短哈希 */
  rev?: string;
  /** git：最后提交的第一行信息 */
  subject?: string;
  author?: string;
  date?: string;
  /** git 附注标签的创建者/创建时间（轻量标签为空） */
  tagAuthor?: string;
  tagDate?: string;
  /** git：来源是本地路径（仓库没有 origin） */
  localSource?: boolean;
}

export function TagDialog(props: {
  repoType: 'svn' | 'git';
  onClose: () => void;
  onChanged: () => void;
  /** 某行点「检出」→ 交给 shell 层打开检出界面（ops 域不能直接引用 repo 域的检出弹窗） */
  onCheckout?: (tag: TagEntry) => void;
}) {
  const [data, setData] = useState<{
    tags: string[];
    layout?: SvnLayout;
    baseUrl?: string;
    details?: {
      name: string;
      hash: string;
      subject?: string;
      author?: string;
      date?: string;
      tagAuthor?: string;
      tagDate?: string;
      /** 附注标签的说明正文（发布说明）；轻量标签没有 */
      message?: string;
      source: string;
      localSource: boolean;
    }[];
  } | null>(null);
  /** 标签详情（版本/作者/时间）：由 tags 目录的 repo-list 补全；失败时缺席，不阻断检出 */
  const [details, setDetails] = useState<Record<string, { rev?: string; author?: string; date?: string }>>({});
  /** Git 标签详情（最后提交 + 附注标签创建信息 + 克隆来源） */
  const [gitDetails, setGitDetails] = useState<
    Record<
      string,
      {
        hash: string;
        subject?: string;
        author?: string;
        date?: string;
        tagAuthor?: string;
        tagDate?: string;
        /** 附注标签的说明正文（发布说明）；轻量标签没有 */
        message?: string;
        source: string;
        localSource: boolean;
      }
    >
  >({});
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; commands?: string[]; action: () => void } | null>(null);

  const load = () => {
    get
      .tags()
      .then((r) => {
        setData(r);
        // Git 标签详情（最后提交 + 附注标签创建信息 + 来源）：后端 for-each-ref 一次返回
        if (r.details) {
          const next: typeof gitDetails = {};
          for (const d of r.details) {
            next[d.name] = {
              hash: d.hash,
              subject: d.subject,
              author: d.author,
              date: d.date,
              tagAuthor: d.tagAuthor,
              tagDate: d.tagDate,
              message: d.message,
              source: d.source,
              localSource: d.localSource,
            };
          }
          setGitDetails(next);
        }
        // SVN 标签详情（版本/作者/时间）复用仓库浏览的列目录接口；失败静默降级（检出界面仍可用）
        const base = r.baseUrl?.replace(/\/+$/, '');
        if (!base || props.repoType !== 'svn') return;
        get
          .repoList(base)
          .then((lr) => {
            if (!lr.ok || !lr.entries) return;
            const next: Record<string, { rev?: string; author?: string; date?: string }> = {};
            for (const e of lr.entries) {
              if (!e.isDir) continue;
              next[e.name.replace(/\/+$/, '')] = { rev: e.rev, author: e.author, date: e.date };
            }
            setDetails(next);
          })
          .catch(() => {
            /* 详情失败只影响展示，不影响列表与检出 */
          });
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, [props.repoType]);

  const act = (action: 'create' | 'delete', name: string) => {
    setBusy(true);
    void runAction(
      () => post.tag(action, name),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      () => {
        load();
        props.onChanged();
      }
    ).finally(() => setBusy(false));
  };

  /** 点「检出」：SVN 用 tags 目录 URL；Git 用标签详情里的来源地址 + ref（由 shell 层渲染检出界面） */
  const checkoutTag = (tag: string) => {
    if (props.repoType === 'svn') {
      const base = data?.baseUrl?.replace(/\/+$/, '');
      if (!base) {
        setMsg(t('ops.tag.checkoutNoUrl'));
        setMsgErr(true);
        return;
      }
      // 标签名按 URL 段编码（中文/特殊字符标签也能检出）
      props.onCheckout?.({ repoType: 'svn', name: tag, url: `${base}/${encodeURIComponent(tag)}`, ...details[tag] });
      return;
    }
    const d = gitDetails[tag];
    if (!d) {
      setMsg(t('ops.tag.checkoutNoSource'));
      setMsgErr(true);
      return;
    }
    props.onCheckout?.({
      repoType: 'git',
      name: tag,
      url: d.source,
      rev: d.hash,
      subject: d.subject,
      author: d.author,
      date: d.date,
      tagAuthor: d.tagAuthor,
      tagDate: d.tagDate,
      localSource: d.localSource,
    });
  };

  /** 列表顺序：**最新发布的在前**（按打标签时间倒序）。轻量标签没有打标签时间，
   *  用它指向的提交时间；SVN 标签用它的版本号（复制成 tags/ 目录的那次提交）。
   *  全都取不到时退回名称倒序，时间相同也用它做 tie-break（v1.3.0 / v1.3.1 这种同日的）。 */
  const orderedTags = useMemo(() => {
    const timeOf = (tag: string): number => {
      if (props.repoType === 'git') {
        const iso = gitDetails[tag]?.tagDate ?? gitDetails[tag]?.date;
        const t = iso ? Date.parse(iso) : NaN;
        return Number.isNaN(t) ? 0 : t;
      }
      const rev = Number(details[tag]?.rev ?? 0);
      return Number.isFinite(rev) ? rev : 0;
    };
    return [...(data?.tags ?? [])].sort((a, b) => {
      const dt = timeOf(b) - timeOf(a);
      return dt !== 0 ? dt : b.localeCompare(a, undefined, { numeric: true });
    });
  }, [data?.tags, gitDetails, details, props.repoType]);

  return (
    // 标签管理
    <ModalShell icon={<IconTag size={16} />} title={`${t('ops.tag.title')} (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={560}>
      <HelpNote>
        {/* 标签是给当前提交打的固定名字，常用于标记发布版本（v1.0、v2.0 等）。用法：输入名称回车 = 给当前代码打标签；列表中的标签可「删除」。 / SVN 标签是版本库中的目录快照（tags/），只读性质，用于标记发布版本。用法：输入名称回车 = 复制 trunk（或当前目录）创建标签；列表中的标签可「删除」（危险操作会确认）。 */}
        {props.repoType === 'git' ? t('ops.tag.helpGit') : t('ops.tag.helpSvn')}
      </HelpNote>
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          // 新标签名称…（回车创建）
          placeholder={t('ops.tag.namePlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter' && newName.trim()) act('create', newName.trim());
          }}
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || !newName.trim()}
          onClick={() => act('create', newName.trim())}
          title={cmdOfRepo(props.repoType, 'tag_create', { name: newName.trim() || '…', msg: '…' })}
        >
          {/* 🏷 创建标签 */}
          {t('ops.tag.create')}
        </button>
      </div>
      {/* 列表高度按「最多露出 10 个标签」定：行高 37px × 10 + 容器内边距与描边 ≈ 380。
          更多的标签在框内滚动（.vcs-list 自带 overflow:auto）——标签可能几十个，
          全铺开会把弹窗顶到屏幕外，而老版本也要能滚回来「检出 / 删除」 */}
      <div className="vcs-list" style={{ maxHeight: 380 }}>
        {/* 加载中… */}
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>}
        {/* 暂无标签 */}
        {data && data.tags.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.tag.none')}</div>}
        {orderedTags.map((tag) => {
          // 发布说明：附注标签取说明正文（发布流程写进去的就是它）；轻量标签没有说明，
          // 退到它指向的提交信息第一行——至少能看出这版是什么
          const d = props.repoType === 'git' ? gitDetails[tag] : undefined;
          const info = d ? d.message || d.subject : undefined;
          const infoTip = d
            ? d.message
              ? `${d.message}${d.tagAuthor ? `\n\n${d.tagAuthor}${d.tagDate ? ` · ${d.tagDate.slice(0, 10)}` : ''}` : ''}`
              : `${t('ops.tag.lightweightTip')}\n${d.subject ?? ''}`
            : '';
          return (
          <div key={tag} className="changed-row">
            <span style={{ color: 'var(--accent)' }}>🏷</span>
            {/* 名字固定不压缩到看不见；说明占剩余宽度，放不下就省略号，悬浮看全文。
                45% 上限只在有说明时生效：SVN 行没有说明元素，再限宽会让按钮后面留一大块空白 */}
            <span
              className="mono"
              style={{
                flex: info ? '0 0 auto' : 1,
                minWidth: 0,
                maxWidth: info ? '45%' : undefined,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              title={tag}
            >
              {tag}
            </span>
            {info && (
              <Tooltip content={infoTip}>
                <span className="dim small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {info.split('\n')[0]}
                </span>
              </Tooltip>
            )}
            {/* 检出：交给 shell 层打开检出界面（SVN / Git 各一套） */}
            {props.onCheckout && (
              <button
                className="mini"
                disabled={busy}
                onClick={() => checkoutTag(tag)}
                title={t('ops.tag.checkoutTip', { name: tag })}
              >
                {/* 检出 */}
                {t('ops.tag.checkout')}
              </button>
            )}
            <button
              className="mini danger"
              disabled={busy}
              onClick={() =>
                setCfm({
                  // 删除标签
                  title: t('ops.tag.delTitle'),
                  // 确认删除标签 {name}？
                  msg: t('ops.tag.delMsg', { name: tag }),
                  commands: [cmdOfRepo(props.repoType, 'tag_delete', { name: tag }) ?? ''],
                  action: () => act('delete', tag),
                })
              }
              title={cmdOfRepo(props.repoType, 'tag_delete', { name: tag })}
            >
              {/* 删除 */}
              {t('common.delete')}
            </button>
          </div>
          );
        })}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {/* 远程仓库（git） */}
      {props.repoType === 'git' && <RemoteList />}
      {/* 二次确认（工具风格） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          commands={cfm.commands}
          // 确认
          confirmLabel={t('ui.modal.confirm')}
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}

/** git 远程列表展示 */
function RemoteList() {
  const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    get
      .remotes()
      .then((r) => setRemotes(r.remotes))
      .catch(() => {});
  }, []);
  if (remotes.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {/* 远程仓库： */}
      <div className="dim small" style={{ marginBottom: 4 }}>{t('ops.tag.remotes')}</div>
      {remotes.map((r) => (
        <div key={r.name} className="changed-row">
          <span className="badge git" style={{ background: 'var(--accent)', fontSize: 9 }}>{r.name}</span>
          <span className="mono small dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
        </div>
      ))}
    </div>
  );
}
