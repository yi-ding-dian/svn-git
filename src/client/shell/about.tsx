/** 关于弹窗：应用图标 + 名称 + 版本号 + 构建日期（数据来自 /api/info，构建信息由 build-web.mjs 写入） */
import React from 'react';
import { ModalShell } from './modal-shell.js';
import { t } from '../../shared/i18n/index.js';

export function AboutModal(props: { version: string; buildDate: string; onClose: () => void }) {
  return (
    <ModalShell
      // 关于
      title={t('shell.about.title')}
      width={420}
      onClose={props.onClose}
      foot={
        <button className="primary" onClick={props.onClose}>
          {/* 确定 */}
          {t('common.ok')}
        </button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 4px' }}>
        <img src="/icon.png" width="52" height="52" alt="logo" style={{ borderRadius: 10 }} />
        <div>
          {/* svn-git 文件版本管理 */}
          <div style={{ fontWeight: 600, fontSize: 16 }}>{t('shell.appName')}</div>
          {/* SVN / Git 双引擎图形化版本管理工具 */}
          <div className="dim small">{t('shell.about.tagline')}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, lineHeight: 2 }}>
        <div>
          {/* 版本： / （读取失败） */}
          <span className="dim">{t('shell.about.version')}</span>v{props.version || t('shell.about.versionFailed')}
        </div>
        <div>
          {/* 构建日期： */}
          <span className="dim">{t('shell.about.buildDate')}</span>
          {/* （未生成，npm run build 后更新） */}
          {props.buildDate || t('shell.about.buildDateMissing')}
        </div>
      </div>
    </ModalShell>
  );
}
