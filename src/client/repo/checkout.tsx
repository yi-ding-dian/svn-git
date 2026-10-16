/** 仓库浏览右键「检出到本地」弹窗（不依赖已打开项目，URL 直连检出工作副本）：
 *  只收集参数（所在目录 / 本地名称 / 选择性检出）——点「检出」后交给调用方发起**后台任务**、
 *  本弹窗立刻关闭（与「获取仓库」同一套语义，不再有"弹窗里等 / − 最小化"两套）。
 *  进度与取消看顶栏沙漏，完成自动打开工作副本，失败进铃铛；
 *  认证失败由 checkout-task 的 CheckoutAuthModal 引导（账号密码**只本次用**、后端不落盘）。
 *
 *  入口：repo-browse.tsx 树里右键（目录行 + 空白 = 仓库根）。 */
import React, { useEffect, useRef, useState } from 'react';
import { get } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { launchMagicFlight } from '../animations/index.js';
import { PickDirModal } from './pick-dir.js';
import { CheckoutTree } from './checkout-tree.js';
import { CheckoutSizeDialog } from './checkout-size.js';
import { CheckoutConfirmDialog } from './checkout-confirm.js';
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
  /** 选择性检出：树勾选的相对路径（可多级，如 branches/AnHui） */
  const [checkedDirs, setCheckedDirs] = useState<Set<string>>(() => new Set());
  /** 根级一级目录（树汇报；「全选」按钮与默认全选用） */
  const [rootDirs, setRootDirs] = useState<string[]>([]);
  /** 默认全选已初始化的 URL（同一弹出实例只自动勾一次；用户取消过就不再打扰） */
  const initedUrlRef = useRef('');
  /** 树汇报一级目录：首次（每个 URL）自动全选——打开弹窗默认即为完整检出 */
  const onRootDirs = (dirs: string[]) => {
    setRootDirs(dirs);
    if (initedUrlRef.current !== props.url) {
      initedUrlRef.current = props.url;
      setCheckedDirs(new Set(dirs));
    }
  };
  /** 全选态判断：全部一级目录都显式在勾选集合里（深层拆开会把一级从集合里拆出 → 自然回到"全选"态） */
  const allRootChecked = rootDirs.length > 0 && rootDirs.every((d) => checkedDirs.has(d));
  /** 检出大小检测弹窗（按需触发） */
  const [sizeOpen, setSizeOpen] = useState(false);
  /** 检出二次确认弹窗（列范围树与落地信息，确认后才真正发起） */
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  }, [props.url]);

  /** 表单校验（「检出」按钮与回车都先过这里）：通过则进入二次确认 */
  const validate = (): boolean => {
    if (checkedDirs.size === 0) {
      // 请先勾选要检出的目录（可点「全选」）
      setMsg(t('repo.co.needPick'));
      setMsgErr(true);
      return false;
    }
    if (!dir.trim() || !name.trim()) {
      // 请填写目标和名称
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return false;
    }
    setMsg('');
    setMsgErr(false);
    return true;
  };
  /** 二次确认里点「确认检出」：交参数给调用方发起后台任务 + 关窗 */
  const startCheckout = () => {
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
            disabled={!dir.trim() || !name.trim() || checkedDirs.size === 0}
            onClick={() => {
              // 先过校验，再进二次确认（核对范围树与落地信息后才真正发起——防误操作）
              if (validate()) setConfirmOpen(true);
            }}
            // 一个都没勾：提示先勾选（默认全选后"全取消"= 明确什么都不检出——别走旧"空=完整检出"兜底）
            title={checkedDirs.size === 0 ? t('repo.co.needPick') : (cmdOfRepo('svn', 'checkout', { url: props.url, dir: joinPath(dir, name.trim() || '…') }) ?? '')}
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
            if (e.key === 'Enter' && validate()) setConfirmOpen(true);
          }}
        />
      </FormRow>
      {/* 选择性检出（SVN 深度检出）：树勾选后只检出勾选项（可到任意层级），后续更新也只更新它们；
          FormRow 常弹性：窗口/弹窗拉大时树跟着长高（不再是固定高度、下面留一片空） */}
      <FormRow label={t('repo.co.sparseTitle')} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {/* 不勾选 = 完整检出；勾选后只检出这些目录（另含根目录文件），后续更新也只更新它们 */}
          <div className="dim small" style={{ flex: 1 }}>{t('repo.co.sparseHint')}</div>
          {/* 全选/全不选（开关式）：全选态（全部一级都在）再点 = 清空；否则 = 全选（并重置深层取消） */}
          <button
            className="mini tool-btn"
            disabled={rootDirs.length === 0}
            onClick={() => setCheckedDirs(allRootChecked ? new Set() : new Set(rootDirs))}
            title={allRootChecked ? t('repo.co.unselectAllTip') : t('repo.co.selectAllTip')}
          >
            {allRootChecked ? t('repo.co.unselectAll') : t('repo.co.selectAll')}
          </button>
          {/* 检出大小检测（按需点；只读，不下载文件）；一个都没勾时不可点（与检出按钮同一门槛） */}
          <button
            className="mini tool-btn"
            disabled={checkedDirs.size === 0}
            onClick={() => setSizeOpen(true)}
            title={checkedDirs.size === 0 ? t('repo.co.needPick') : t('repo.co.sizeTip')}
          >
            {t('repo.co.sizeBtn')}
          </button>
        </div>
        <CheckoutTree rootUrl={props.url} value={checkedDirs} onChange={setCheckedDirs} onRootDirs={onRootDirs} />
      </FormRow>
      <ResultLine msg={msg} err={msgErr} />
      {/* 检出二次确认（范围树 + 远程/落地路径；确认后才真正发起） */}
      {confirmOpen && (
        <CheckoutConfirmDialog
          url={props.url}
          target={joinPath(dir.trim(), name.trim())}
          dirs={[...checkedDirs]}
          onConfirm={(e) => {
            // 先放飞行线（从本按钮飞向顶栏沙漏），再发起后台检出
            launchMagicFlight(e.currentTarget.getBoundingClientRect());
            startCheckout();
          }}
          onBack={() => setConfirmOpen(false)}
        />
      )}
      {/* 检出大小检测（按需；范围 = 打开时的勾选） */}
      {sizeOpen && <CheckoutSizeDialog url={props.url} include={[...checkedDirs]} onClose={() => setSizeOpen(false)} />}
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
