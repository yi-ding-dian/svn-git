/** 关于弹窗：应用图标 + 名称 + 版本号 + 构建日期（数据来自 /api/info，构建信息由 build-web.mjs 写入） */
import React from 'react';
import { ModalShell } from '../modal-shell.js';

export function AboutModal(props: { version: string; buildDate: string; onClose: () => void }) {
  return (
    <ModalShell
      title="关于"
      width={420}
      onClose={props.onClose}
      foot={
        <button className="primary" onClick={props.onClose}>
          确定
        </button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 4px' }}>
        <img src="/icon.png" width="52" height="52" alt="logo" style={{ borderRadius: 10 }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>svn-git 文件版本管理</div>
          <div className="dim small">SVN / Git 双引擎图形化版本管理工具</div>
        </div>
      </div>
      <div style={{ marginTop: 12, lineHeight: 2 }}>
        <div>
          <span className="dim">版本：</span>v{props.version || '（读取失败）'}
        </div>
        <div>
          <span className="dim">构建日期：</span>
          {props.buildDate || '（未生成，npm run build 后更新）'}
        </div>
      </div>
    </ModalShell>
  );
}
