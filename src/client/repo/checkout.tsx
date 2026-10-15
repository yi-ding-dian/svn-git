/** 仓库浏览右键「检出到本地」弹窗（不依赖已打开项目，URL 直连检出工作副本）：
 *  只收集参数（所在目录 / 本地名称 / 选择性检出）——点「检出」后交给调用方发起**后台任务**、
 *  本弹窗立刻关闭（与「获取仓库」同一套语义，不再有"弹窗里等 / − 最小化"两套）。
 *  进度与取消看顶栏沙漏，完成自动打开工作副本，失败进铃铛；
 *  认证失败由 checkout-task 的 CheckoutAuthModal 引导（账号密码**只本次用**、后端不落盘）。
 *
 *  入口：repo-browse.tsx 树里右键（目录行 + 空白 = 仓库根）。 */
import React, { useEffect, useState } from 'react';
import { get } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { launchMagicFlight } from '../shell/magic-flight.js';
import { PickDirModal } from './pick-dir.js';
import { FormRow } from '../ui/ui.js';
import { ResultLine } from '../ui/result-line.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { joinPath } from '../shared/utils.js';
import type { CheckoutParams } from './checkout-task.js';
import { t } from '../../shared/i18n/index.js';

/** URL 末段 → 默认本地名称（仓库根 URL 时即仓库名） */
function defaultName(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() ?? '');
  } catch {
    return url.replace(/\/+$/, '').split('/').pop() ?? '';
  }
}

export function CheckoutDialog(props: {
  /** 要检出的远程目录 URL（树行 = 行 URL；空白右键 = 仓库根） */
  url: string;
  onClose: () => void;
  /** 点「检出」：把参数交给调用方发起后台任务（本弹窗随即关闭） */
  onStart: (p: CheckoutParams) => void;
}) {
  const [dir, setDir] = useState('');
  const [name, setName] = useState(() => defaultName(props.url));
  const [picker, setPicker] = useState(false);
  /** 表单校验消息（任务自身的消息不在这里显示——弹窗已经关了） */
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  /** 标题右侧「当前检出账号」：工具配置 + 系统凭据缓存（挂载时一次查全） */
  const [cfgUser, setCfgUser] = useState('');
  const [cacheUser, setCacheUser] = useState('');
  /** 选择性检出：该 URL 下的一级子目录（null=加载中；[]=没有子目录，区块不显示）；dirsFail=列表拉取失败 */
  const [subDirs, setSubDirs] = useState<string[] | null>(null);
  const [dirsFail, setDirsFail] = useState(false);
  const [checkedDirs, setCheckedDirs] = useState<Set<string>>(() => new Set());

  // 默认所在目录 = home（与「打开项目」默认一致）；顺带查 SVN 身份（标题显示用：
  // 工具配置 + 系统凭据缓存——裸跑时 svn 实际用的就是缓存身份）
  useEffect(() => {
    get
      .info()
      .then((r) => setDir((d) => d || r.home || ''))
      .catch(() => {
        /* 拿不到就用空值，用户自行输入/浏览 */
      });
    get
      .svnIdentity(props.url)
      .then((r) => {
        setCfgUser(r.config?.username ?? '');
        setCacheUser(r.cache?.username ?? '');
      })
      .catch(() => {
        /* 拿不到身份按匿名显示 */
      });
    // 选择性检出：拉该 URL 的一级子目录清单（失败只提示、不影响完整检出）
    get
      .repoList(props.url)
      .then((r) => {
        if (r.ok && r.entries) setSubDirs(r.entries.filter((e) => e.isDir && e.name !== '..').map((e) => e.name));
        else setDirsFail(true);
      })
      .catch(() => setDirsFail(true));
  }, [props.url]);

  /** 点「检出」：校验 → 交参数给调用方发起后台任务 + 关窗 */
  const startCheckout = () => {
    if (!dir.trim() || !name.trim()) {
      // 请填写目标和名称
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return;
    }
    setMsg('');
    setMsgErr(false);
    props.onStart({ url: props.url, dir: dir.trim(), name: name.trim(), dirs: [...checkedDirs] });
    props.onClose();
  };

  // 标题右侧「当前检出账号」：工具配置 > 系统凭据缓存 > 匿名（本次临时凭据在失败后才输入）
  const who = cfgUser || cacheUser;
  const whoTip = cfgUser ? t('repo.co.whoTipSaved') : cacheUser ? t('repo.co.whoTipCache') : t('repo.co.whoTipAnon');

  return (
    <ModalShell
      icon="📡"
      title={
        <>
          {/* 检出到本地 */}
          {t('repo.co.title')}
          {/* 当前检出账号（标题右侧；悬浮说明账号来源） */}
          <span className="dim small mono" style={{ marginLeft: 8 }} title={whoTip}>
            👤 {who || t('repo.co.anonymous')}
          </span>
        </>
      }
      onClose={props.onClose}
      width={560}
      closeIcon
      foot={
        <>
          {/* 关闭：表单还没提交，关掉就是放弃填写（没有任务需要处理——任务归顶栏） */}
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button
            className="primary"
            disabled={!dir.trim() || !name.trim()}
            onClick={(e) => {
              // 先放飞行线（从本按钮飞向顶栏沙漏），再发起后台检出
              launchMagicFlight(e.currentTarget.getBoundingClientRect());
              startCheckout();
            }}
            title={cmdOfRepo('svn', 'checkout', { url: props.url, dir: joinPath(dir, name.trim() || '…') }) ?? ''}
          >
            {/* 检出 */}
            {t('repo.co.start')}
          </button>
        </>
      }
    >
      {/* 远程路径：只读展示（"上方显示要获取的仓库远程路径"） */}
      <FormRow label={t('repo.co.remote')}>
        <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{props.url}</div>
      </FormRow>
      {/* 所在目录（父目录路径） */}
      <FormRow label={t('repo.parentDir')}>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          {/* 打开文件夹浏览（可新建/重命名文件夹） */}
          <button className="mini tool-btn" title={t('repo.browseTip')} onClick={() => setPicker(true)}>
            {/* 📂 浏览 */}
            {t('repo.browse')}
          </button>
        </div>
      </FormRow>
      {/* 本地名称 */}
      <FormRow label={t('repo.co.localName')}>
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') startCheckout();
          }}
        />
      </FormRow>
      {/* 选择性检出（SVN 深度检出）：勾选后只检出勾选的子目录，后续更新也只更新它们 */}
      {subDirs === null && !dirsFail && (
        // 正在获取目录列表…
        <div className="dim small" style={{ marginBottom: 10 }}>{t('repo.co.sparseLoading')}</div>
      )}
      {dirsFail && (
        // 目录列表获取失败——不影响完整检出
        <div className="dim small" style={{ marginBottom: 10 }}>{t('repo.co.sparseLoadFail')}</div>
      )}
      {subDirs && subDirs.length > 0 && (
        <FormRow label={t('repo.co.sparseTitle')}>
          {/* 不勾选 = 完整检出；勾选后只检出这些目录（另含根目录文件），后续更新也只更新它们 */}
          <div className="dim small" style={{ marginBottom: 6 }}>{t('repo.co.sparseHint')}</div>
          <div style={{ maxHeight: 140, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
            {subDirs.map((d) => (
              // display:flex 必须 inline：.form-row label 的 display:block 会压过 .row
              <label key={d} className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0, padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={checkedDirs.has(d)}
                  onChange={(e) =>
                    setCheckedDirs((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(d);
                      else n.delete(d);
                      return n;
                    })
                  }
                />
                <span className="small mono">📁 {d}</span>
              </label>
            ))}
          </div>
        </FormRow>
      )}
      <ResultLine msg={msg} err={msgErr} />
      {/* 目录选择（与「打开项目」共用的目录浏览器）：选择所在目录 */}
      {picker && (
        <PickDirModal
          // 📂 选择所在目录
          title={t('repo.pickDirTitle')}
          startDir={dir}
          onPick={(p) => {
            setDir(p);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </ModalShell>
  );
}
