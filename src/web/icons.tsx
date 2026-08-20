/** 彩色 SVG 图标库（工具栏用，品牌色渐变，不依赖系统 emoji 字体） */
import React from 'react';

interface IconProps {
  size?: number;
}

/** 大图标（文件浏览器风格）：文件夹彩色 / 文件按类型配色（打开项目/浏览模式共用） */
export function GridIcon(props: { isDir: boolean; name: string; size?: number }) {
  const s = props.size ?? 40;
  if (props.isDir) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <defs>
          <linearGradient id="gi-folder" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f0c36d" />
            <stop offset="1" stopColor="#e8a13c" />
          </linearGradient>
        </defs>
        <path d="M6 14a4 4 0 0 1 4-4h10l4 5h14a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="url(#gi-folder)" />
      </svg>
    );
  }
  // 文件类型配色
  const ext = props.name.split('.').pop()?.toLowerCase() ?? '';
  let color = '#8b949e';
  if (/^(c|cpp|h|hpp|cc|js|ts|tsx|jsx|py|java|go|rs|cs)$/.test(ext)) color = '#58a6ff';
  else if (/^(txt|md|log|rst|doc)$/.test(ext)) color = '#3fb950';
  else if (/^(json|xml|yml|yaml|ini|conf|cfg)$/.test(ext)) color = '#e0b25c';
  else if (/^(png|jpg|jpeg|gif|svg|bmp|ico)$/.test(ext)) color = '#a371f7';
  else if (/^(sh|bat|cmd)$/.test(ext)) color = '#f85149';
  const id = `gi-${ext || 'file'}`;
  return (
    <svg width={s} height={s} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <path d="M10 4h20l8 8v30a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={`url(#${id})`} />
      <path d="M30 4l8 8h-8z" fill="#ffffff" fillOpacity="0.55" />
      <path d="M14 22h20M14 28h20M14 34h12" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 齿轮：Git 信息与配置 */
export function IconGear({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** 分支：经典 git 分支图形（SVN 紫 → GIT 橙 渐变主干） */
export function IconBranch({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-branch" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a2be2" />
          <stop offset="1" stopColor="#e85d26" />
        </linearGradient>
      </defs>
      <path d="M8 2.5v7.5" stroke="url(#ic-branch)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 10c0 4.2 8 2.6 8 6.6v3.2" stroke="url(#ic-branch)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="2.5" r="2.5" fill="#e85d26" />
      <circle cx="8" cy="11" r="2.8" fill="#8a2be2" />
      <circle cx="16" cy="20.8" r="2.5" fill="#3fb950" />
    </svg>
  );
}

/** 标签：彩色菱形标签 */
export function IconTag({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-tag" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#58a6ff" />
          <stop offset="1" stopColor="#a371f7" />
        </linearGradient>
      </defs>
      <path d="M4.5 4.5h6.5L20.5 14 14 20.5 4.5 11z" fill="url(#ic-tag)" stroke="none" />
      <circle cx="9.5" cy="9.5" r="2" fill="#ffffff" />
    </svg>
  );
}

/** Stash：彩色收纳箱 */
export function IconStash({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-stash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0b25c" />
          <stop offset="1" stopColor="#b8860b" />
        </linearGradient>
      </defs>
      <path d="M4 7.5 6 4.5h12l2 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="url(#ic-stash)" />
      <path d="M4 7.5h16" stroke="#8a6d1a" strokeWidth="1.6" />
      <path d="M8.5 11h7" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 新建仓库：绿色圆 + 白加号 */
export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-plus" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fb950" />
          <stop offset="1" stopColor="#1a7f37" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#ic-plus)" />
      <path d="M12 7v10M7 12h10" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** 清理：彩色垃圾桶 */
export function IconClean({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-clean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f85149" />
          <stop offset="1" stopColor="#b62324" />
        </linearGradient>
      </defs>
      <path d="M5 6h14l-1.2 14a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" fill="url(#ic-clean)" />
      <path d="M3.5 6h17" stroke="#b62324" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9 2.8h6l1 3.2H8z" fill="#e0b25c" />
      <path d="M10 10.5v6M14 10.5v6" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 打开项目：彩色文件夹 */
export function IconFolder({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-folder" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0c36d" />
          <stop offset="1" stopColor="#e8a13c" />
        </linearGradient>
      </defs>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h5l2 2.5h8A1.5 1.5 0 0 1 21 8v10.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z" fill="url(#ic-folder)" />
    </svg>
  );
}

/** 刷新：蓝绿循环箭头 */
export function IconRefresh({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-refresh" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#58a6ff" />
          <stop offset="1" stopColor="#3fb950" />
        </linearGradient>
      </defs>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" stroke="url(#ic-refresh)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M20 3.5v4h-4" stroke="#58a6ff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** SVN 登录：金色钥匙 */
export function IconLogin({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-login" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0b25c" />
          <stop offset="1" stopColor="#a371f7" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="14" r="5.5" fill="none" stroke="url(#ic-login)" strokeWidth="2.6" />
      <path d="M12 12l8.5-8.5M16.5 8l2.5-2.5M14 10.5l2-2" stroke="#a371f7" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** diff：蓝色左右箭头对比 */
export function IconDiff({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M8 7l-4 4 4 4M16 7l4 4-4 4" stroke="#58a6ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M13 4l-2 16" stroke="#a371f7" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 还原：橙色撤销箭头 */
export function IconRevert({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M8 5L4 9l4 4" stroke="#e0b25c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M4 9h9a6 6 0 0 1 0 12h-3" stroke="#e0b25c" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 历史：蓝色时钟 */
export function IconClock({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="8.5" stroke="#58a6ff" strokeWidth="2.2" fill="none" />
      <path d="M12 7v5l3.5 2" stroke="#58a6ff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 忽略：紫色斜杠眼睛 */
export function IconEyeOff({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M2.5 3.5l19 17" stroke="#a371f7" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 12s3.5-6 8-6c1.2 0 2.3.4 3.3 1M20 12s-3.5 6-8 6c-1.2 0-2.3-.4-3.3-1" stroke="#a371f7" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 锁定：绿色锁 */
export function IconLock({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="5" y="10" width="14" height="10" rx="2" fill="#3fb950" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#2e8b57" strokeWidth="2.2" fill="none" />
      <circle cx="12" cy="15" r="1.6" fill="#ffffff" />
    </svg>
  );
}

/** 解锁：橙色开锁 */
export function IconUnlock({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="5" y="10" width="14" height="10" rx="2" fill="#e0b25c" />
      <path d="M8 10V7a4 4 0 0 1 7.5-1.8" stroke="#b8860b" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="15" r="1.6" fill="#ffffff" />
    </svg>
  );
}

/** 提交：绿色勾选圆 */
export function IconCommit({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="#3fb950" />
      <path d="M8 12.5l3 3 5-6" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** 列表视图：蓝灰三横线 */
export function IconList({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="#58a6ff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 树视图：绿蓝分支结构 */
export function IconTree({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M6 3v10M6 13c0 4 8 3 8 7" stroke="#3fb950" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="6" cy="3" r="2.3" fill="#3fb950" />
      <circle cx="6" cy="14" r="2.3" fill="#58a6ff" />
      <circle cx="14" cy="20.5" r="2.3" fill="#e0b25c" />
    </svg>
  );
}

/** 浏览视图：紫蓝九宫格 */
export function IconGrid({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="#58a6ff" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" fill="#a371f7" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" fill="#a371f7" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" fill="#58a6ff" />
    </svg>
  );
}

/** 眼睛：显示（绿色） */
export function IconEye({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" stroke="#3fb950" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="3" fill="#3fb950" />
    </svg>
  );
}

/** 回到根目录：绿色房子 */
export function IconHome({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M4 11l8-7 8 7" stroke="#3fb950" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M6 10v10h12V10" stroke="#3fb950" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M10 20v-6h4v6" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** 上一级：橙色上箭头 */
export function IconUp({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 4v16" stroke="#e0b25c" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6 10l6-6 6 6" stroke="#e0b25c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** 退出：红色门/箭头 */
export function IconExit({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-exit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f85149" />
          <stop offset="1" stopColor="#d73a49" />
        </linearGradient>
      </defs>
      <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" stroke="url(#ic-exit)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M11 12h9M16 8l4 4-4 4" stroke="#f85149" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// ============ 右键菜单彩色图标（不依赖系统 emoji 字体） ============

/** 提交：蓝色上传箭头 */
export function IconUpload({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 16.5v-10M7 10.5l5-5 5 5" stroke="#1f6feb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M4.5 19.5h15" stroke="#58a6ff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** 查看历史：蓝色时钟 */
export function IconHistory({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="8.5" stroke="#1f6feb" strokeWidth="2.2" fill="none" />
      <path d="M12 7.5V12l3 2" stroke="#58a6ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="12" cy="12" r="1.6" fill="#1f6feb" />
    </svg>
  );
}

/** 忽略：灰色眼睛 + 红色斜线 */
export function IconIgnore({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="#8b949e" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="3" stroke="#8b949e" strokeWidth="2" fill="none" />
      <path d="M5 19L19 5" stroke="#f85149" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** 常用文件夹：黄色星星 */
export function IconStar({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17l-5.7 3.2 1.2-6.3L2.8 9.5l6.4-.8z" fill="#e3b341" />
    </svg>
  );
}

/** 复制完整路径：灰色双页 */
export function IconCopy({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="#8b949e" strokeWidth="2" fill="none" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="#b1bac4" strokeWidth="2" fill="none" />
    </svg>
  );
}


/** 查看内容：蓝色文件页 */
export function IconFile({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5z" fill="#58a6ff" />
      <path d="M14 3.5l4 4h-4z" fill="#dbeafe" />
      <path d="M8.5 12h7M8.5 15.5h7" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
