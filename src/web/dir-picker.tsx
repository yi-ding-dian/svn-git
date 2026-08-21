/** 目录选择器：浏览文件夹、新建（行内输入）、重命名（行内输入、自动全选），确定返回路径（创建/克隆仓库的"所在目录"用） */
import React, { useEffect, useState } from 'react';
import { get, post, type BrowseResult } from './api.js';
import { GridIcon } from './icons.js';
import { ContextMenu } from './context-menu.js';

export function DirPicker(props: {
  /** 初始浏览目录（默认 home） */
  startDir: string;
  onPick: (path: string) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [dir, setDir] = useState(props.startDir);
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  // 行内编辑：creating=新建输入框；renaming=正在重命名的文件夹名
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = (d: string) => {
    setError('');
    get
      .browse(d)
      .then((r) => setData(r))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    if (!dir) return;
    load(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  const goUp = () => setDir((d) => (d === '/' ? '/' : d.slice(0, d.lastIndexOf('/')) || '/'));

  /** 新建确认：创建后自动进入新文件夹 */
  const confirmCreate = (n: string) => {
    const name = n.trim();
    if (!name) return;
    void post
      .mkdir(`${dir}/${name}`)
      .then(() => {
        setCreating(false);
        props.onToast(`已创建 ${name}`);
        setDir(`${dir}/${name}`); // 创建后默认进入
      })
      .catch((e: Error) => props.onToast(`创建失败: ${e.message}`));
  };

  /** 重命名确认 */
  const confirmRename = (oldName: string, n: string) => {
    const name = n.trim();
    setRenaming(null);
    if (!name || name === oldName) return;
    void post
      .rename(`${dir}/${oldName}`, `${dir}/${name}`)
      .then(() => {
        props.onToast(`已重命名 ${oldName} → ${name}`);
        load(dir);
      })
      .catch((e: Error) => props.onToast(`重命名失败: ${e.message}`));
  };

  return (
    <div>
      {/* 工具栏：当前路径 + 新建文件夹（行内输入，回车确认） */}
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <div className="breadcrumb" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dir}
          {dir !== '/' && (
            <a href="#" onClick={(e) => { e.preventDefault(); goUp(); }}>
              {' '}← 上级
            </a>
          )}
        </div>
        {creating ? (
          <input
            autoFocus
            type="text"
            placeholder="输入文件夹名称，回车创建"
            style={{ width: 200, padding: '5px 10px', fontSize: 13 }}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v.includes('/')) e.currentTarget.value = v.replace(/[/\\]/g, '');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCreate(e.currentTarget.value);
              if (e.key === 'Escape') setCreating(false);
            }}
          />
        ) : (
          <button className="mini primary" onClick={() => setCreating(true)} title="在当前位置新建文件夹">📁 新建文件夹</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {/* 文件夹网格：单击进入 · 右键重命名（行内输入自动全选） */}
      <div className="open-grid" style={{ maxHeight: 260 }}>
        {data?.entries.map((it) =>
          it.isDir ? (
            renaming === it.name ? (
              // 重命名输入框：自动全选原文件名，回车确认
              <div key={it.name} className="open-grid-item dir" style={{ padding: '10px 6px 2px' }}>
                <GridIcon isDir name={it.name} size={38} />
                <input
                  autoFocus
                  type="text"
                  defaultValue={it.name}
                  style={{ width: '100%', padding: '3px 5px', fontSize: 12, textAlign: 'center' }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename(it.name, e.currentTarget.value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              </div>
            ) : (
              <div
                key={it.name}
                className="open-grid-item dir"
                title={`${it.name}/\n单击进入 · 右键重命名`}
                onClick={() => setDir((d) => (d === '/' ? `/${it.name}` : `${d}/${it.name}`))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, name: it.name });
                }}
              >
                <GridIcon isDir name={it.name} size={38} />
                <span className="open-grid-name">{it.name}/</span>
              </div>
            )
          ) : null,
        )}
        {data && data.entries.filter((e) => e.isDir).length === 0 && <div className="empty" style={{ gridColumn: '1 / -1' }}>空目录（可新建文件夹）</div>}
      </div>
      {/* 右键菜单：重命名 */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          onClose={() => setMenu(null)}
          items={[
            {
              icon: '✏️',
              label: '重命名',
              action: () => {
                const n = menu.name;
                setRenaming(n);
              },
            },
            { icon: '✕', label: '取消' },
          ]}
        />
      )}
      {/* 底部：当前路径 + 确定/取消（foot 风格：分隔线 + 贴底右对齐） */}
      <div className="foot" style={{ margin: 0, padding: '12px 0 0' }}>
        <span className="dim small" style={{ flex: 1, wordBreak: 'break-all' }}>当前: {dir}</span>
        <button onClick={props.onClose}>取消</button>
        <button className="primary" onClick={() => props.onPick(dir)}>选择此目录</button>
      </div>
    </div>
  );
}
