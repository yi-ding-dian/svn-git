/** 通用提示类弹窗：InfoModal（单按钮说明）/ ConfirmModal（确认 + 可选副操作） */
import React from 'react';
import { t } from '../../shared/i18n/index.js';
import { ResizableModal } from '../shell/modal-shell.js';

/** 信息提示弹窗（单按钮，用于"不可操作"类说明提示） */
export function InfoModal(props: { title: string; message: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onClose}>
        <h3>{props.title}</h3>
        <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
          {/* 内层文本流容器：body 是 flex column，message 若是裸片段（无外层元素）会被拆成一行一个段，
              包一层 div 让文本自然内联（行宽不足才换行），所有调用方一致 */}
          <div style={{ lineHeight: 1.7 }}>{props.message}</div>
        </div>
        <div className="foot">
          {/* 知道了 */}
          <button className="primary" onClick={props.onClose}>{t('ui.modal.gotIt')}</button>
        </div>
      </ResizableModal>
    </div>
  );
}

export function ConfirmModal(props: {
  /** 弹窗标题（可含 SVG 图标，如 <IconErr/> 推送失败） */
  title: React.ReactNode;
  message: React.ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  secondaryLabel?: string;
  /** 副按钮是否红色（危险选项） */
  secondaryDanger?: boolean;
  /** 隐藏「取消」按钮：仅"知道了"一种回应（信息型通知） */
  hideCancel?: boolean;
  /** 命令预览：鼠标悬浮按钮时显示将执行的命令 */
  confirmCmd?: string;
  secondaryCmd?: string;
  /** 弹窗宽度（默认 440） */
  width?: number;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}) {
  return (
    <div className="modal-mask">
      <ResizableModal width={props.width ?? 440} minWidth={420} onEsc={props.onCancel}>
        <h3>{props.title}</h3>
        <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
          {/* 内层文本流容器：body 是 flex column，message 若是裸片段（无外层元素）会被拆成一行一个段，
              包一层 div 让文本自然内联（行宽不足才换行），所有调用方一致 */}
          <div style={{ lineHeight: 1.7 }}>{props.message}</div>
        </div>
        <div className="foot">
          {/* 取消 */}
          {!props.hideCancel && <button onClick={props.onCancel}>{t('common.cancel')}</button>}
          {props.secondaryLabel && props.onSecondary && (
            <button
              className={props.secondaryDanger ? 'danger' : 'primary'}
              onClick={props.onSecondary}
              title={props.secondaryCmd ? `${props.secondaryCmd}` : undefined}
            >
              {props.secondaryLabel}
            </button>
          )}
          <button
            className={props.danger ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            title={props.confirmCmd ? `${props.confirmCmd}` : undefined}
          >
            {/* 确认 */}
            {props.confirmLabel ?? t('ui.modal.confirm')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
