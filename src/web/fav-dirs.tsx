/** 常用文件夹管理弹窗：查看/移除/重新预加载（预加载后进入目录命中缓存秒开） */
import React from 'react';
import { ResizableModal } from './modal-shell.js';

export interface FavDir {
  path: string;
  name: string;
  addedAt: number;
}

export function FavDirsModal(props: {
  favs: FavDir[];
  preload: { done: number; total: number; cur: string; running: boolean } | null;
  onRemove: (path: string) => void;
  onPreloadAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask">
      <ResizableModal width={520} minWidth={440}>
        <h3>⭐ 常用文件夹</h3>
        <div className="body">
          <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.8 }}>
            右键文件夹 →「加入常用文件夹（预加载缓存）」后，该文件夹下所有子目录会在后台递归预加载并缓存，
            之后点击里面的任何内容都秒开（本机保存，仅当前电脑生效）。
          </div>
          {props.favs.length === 0 && (
            <div className="dim" style={{ padding: '12px 0' }}>还没有常用文件夹</div>
          )}
          <div className="vcs-list" style={{ border: '1px solid var(--border)', borderRadius: 8, minHeight: 120, overflow: 'auto' }}>
            {props.favs.map((f) => (
              <div key={f.path} className="vcs-row">
                <span className="badge" style={{ background: '#f59e0b', flexShrink: 0 }}>⭐</span>
                <span
                  className="mono small"
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={f.path}
                >
                  {f.path}
                </span>
                <button className="mini" onClick={() => props.onRemove(f.path)}>移除</button>
              </div>
            ))}
          </div>
          {props.preload && (
            <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>
              {props.preload.running
                ? `⏳ 正在后台预加载：${props.preload.done}/${props.preload.total}（${props.preload.cur}）`
                : `✅ 后台预加载完成（${props.preload.done} 个目录）`}
            </div>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>关闭</button>
          {props.favs.length > 0 && (
            <button className="primary" disabled={props.preload?.running} onClick={props.onPreloadAll}>
              {props.preload?.running ? '预加载中…' : '全部重新预加载'}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}
