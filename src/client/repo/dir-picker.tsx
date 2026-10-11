/** 目录选择器：「所在目录」用 —— 浏览视图与「打开项目」共用 DirBrowser（路径输入/拖拽/网格一致），
 *  这里只补选择器自己的东西：新建文件夹、右键重命名、底部「选择此目录」。
 *  新建/重命名反馈显示在自身弹窗内（不外抛），避免污染外层弹窗的结果行 */
import React, { useEffect, useState } from 'react';
import { get, post, type BrowseResult } from '../shared/api.js';
import { IconOk, IconErr } from '../ui/icons.js';
import { ContextMenu } from '../ui/context-menu.js';
import { joinPath } from '../shared/utils.js';
import { DirBrowser } from './dir-browser.js';
import { t } from '../../shared/i18n/index.js';

export function DirPicker(props: {
  /** 初始浏览目录（默认 home） */
  startDir: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [dir, setDir] = useState(props.startDir);
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); // 新建/重命名反馈（自身弹窗内显示）
  const [noticeErr, setNoticeErr] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  // 路径输入行（与「打开项目」同款：回车切换目录）
  const [pathInput, setPathInput] = useState('');
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
  }, [dir]);

  /** 路径输入提交：先预检（同「打开项目」的 openPath，只是不做仓库识别）——成功才切目录并清空输入，
   *  失败保留输入便于修改；输入的就是当前目录时只清输入，不发请求也不报错 */
  const submitPath = () => {
    const p = pathInput.trim();
    if (!p) return;
    if (p === dir) {
      setPathInput('');
      return;
    }
    setError('');
    setNotice('');
    void get
      .browse(p)
      .then(() => {
        setDir(p);
        setPathInput('');
      })
      .catch((e: Error) => setError(e.message));
  };

  /** 新建确认：创建后自动进入新文件夹 */
  const confirmCreate = (n: string) => {
    const name = n.trim();
    if (!name) return;
    const target = joinPath(dir, name);
    void post
      .mkdir(target)
      .then(() => {
        setCreating(false);
        // 已创建 {name}
        setNotice(t('repo.picker.created', { name }));
        setNoticeErr(false);
        setDir(target); // 创建后默认进入
      })
      .catch((e: Error) => {
        // 创建失败: {msg}
        setNotice(t('repo.picker.createFailed', { msg: e.message }));
        setNoticeErr(true);
      });
  };

  /** 重命名确认 */
  const confirmRename = (oldName: string, n: string) => {
    const name = n.trim();
    setRenaming(null);
    if (!name || name === oldName) return;
    void post
      .rename(joinPath(dir, oldName), joinPath(dir, name))
      .then(() => {
        // 已重命名 {from} → {to}
        setNotice(t('repo.picker.renamed', { from: oldName, to: name }));
        setNoticeErr(false);
        load(dir);
      })
      .catch((e: Error) => {
        // 重命名失败: {msg}
        setNotice(t('repo.picker.renameFailed', { msg: e.message }));
        setNoticeErr(true);
      });
  };

  return (
    <>
      <DirBrowser
        dir={dir}
        data={data}
        error={error}
        onError={setError}
        onDirChange={setDir}
        // 拖入文件夹 / 系统选择器：切换到该目录
        onPathPicked={setDir}
        pathInput={{
          value: pathInput,
          onChange: setPathInput,
          // 输入完整目录路径后回车，或拖入文件夹切换目录…
          placeholder: t('repo.picker.pathPlaceholder'),
          onSubmit: submitPath,
          // 📁 或将文件夹直接拖入此窗口，切换到该目录
          hint: t('repo.picker.dropHint'),
        }}
        // 没有可进入的子文件夹就提示（有文件但无子目录时也算，文案已按此措辞）
        isEmpty={(d) => !d.entries.some((e) => e.isDir && e.name !== '..')}
        // 没有子文件夹（可新建文件夹，或直接选择当前目录）
        emptyText={t('repo.picker.noSubdir')}
        // {name}/\n双击进入 · 右键重命名
        tipFor={(e) => (e.isDir ? t('repo.picker.dirTip', { name: e.name }) : e.name)}
        onDirContextMenu={(e, name) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, name });
        }}
        rename={renaming ? { name: renaming, onSubmit: confirmRename, onCancel: () => setRenaming(null) } : undefined}
        slots={{
          // 面包屑行右侧：新建文件夹（行内输入，回车确认）
          toolbar: creating ? (
            <input
              autoFocus
              type="text"
              // 输入文件夹名称，回车创建
              placeholder={t('repo.picker.newPlaceholder')}
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
            // 在当前位置新建文件夹 / 📁 新建文件夹
            <button className="mini primary" onClick={() => setCreating(true)} title={t('repo.picker.newTip')}>{t('repo.picker.newFolder')}</button>
          ),
          // 新建/重命名反馈（自身弹窗内显示，不外抛）
          notice: notice ? (
            <div
              className={noticeErr ? 'error' : 'small'}
              style={{
                ...(noticeErr ? {} : { color: 'var(--ok)' }),
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {noticeErr ? <IconErr /> : <IconOk />}
              <span>{notice}</span>
            </div>
          ) : null,
          // 底部：当前路径 + 确定/取消（foot 风格：分隔线 + 贴底右对齐）
          footer: (
            <div className="foot" style={{ margin: 0, padding: '12px 0 0' }}>
              {/* 当前: {path} */}
              <span className="dim small" style={{ flex: 1, wordBreak: 'break-all' }}>{t('repo.picker.current', { path: dir })}</span>
              {/* 取消 */}
              <button onClick={props.onClose}>{t('common.cancel')}</button>
              {/* 选择此目录 */}
              <button className="primary" onClick={() => props.onPick(dir)}>{t('repo.picker.choose')}</button>
            </div>
          ),
        }}
      />
      {/* 右键菜单：重命名（fixed 定位，放组件树哪个位置都行） */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          onClose={() => setMenu(null)}
          items={[
            {
              icon: '✏️',
              // 重命名
              label: t('repo.picker.rename'),
              action: () => {
                const n = menu.name;
                setRenaming(n);
              },
            },
            // 取消
            { icon: '✕', label: t('common.cancel') },
          ]}
        />
      )}
    </>
  );
}
