/** 彩色 SVG 图标库（工具栏用，品牌色渐变，不依赖系统 emoji 字体） */
import React from 'react';

interface IconProps {
  size?: number;
}

/** 文件类型配色（按扩展名）：代码蓝 / 文本绿 / 配置黄 / 图片紫 / 脚本红 / 办公文档品牌色。
 *  GridIcon（大）与 MiniIcon（行内小）共用同一张表——同一文件在网格与列表里颜色一致 */
export function extColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (/^(c|cpp|h|hpp|cc|js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|cs|vue|svelte)$/.test(ext)) return '#58a6ff';
  if (/^(txt|md|log|rst)$/.test(ext)) return '#3fb950';
  if (/^(json|xml|yml|yaml|ini|conf|cfg)$/.test(ext)) return '#e0b25c';
  if (/^(png|jpg|jpeg|gif|svg|bmp|ico)$/.test(ext)) return '#a371f7';
  if (/^(sh|bat|cmd)$/.test(ext)) return '#f85149';
  // 办公文档品牌色（SVG 内不依赖系统字体,跨平台一致）: 蓝=Word 绿=Excel 橙=PPT 红=PDF
  if (/^(doc|docx|odt)$/.test(ext)) return '#2b579a';
  if (/^(xls|xlsx|csv|ods)$/.test(ext)) return '#217346';
  if (/^(ppt|pptx|odp)$/.test(ext)) return '#d24726';
  if (/^pdf$/.test(ext)) return '#e5484d';
  return '#8b949e';
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
  const ext = props.name.split('.').pop()?.toLowerCase() ?? '';
  const color = extColor(props.name);
  // 办公文档角标字母: PDF 用三字母,其余单字母,加强辨识度
  const BADGE = /^pdf$/.test(ext) ? 'PDF' : /^(doc|docx|odt)$/.test(ext) ? 'W' : /^(xls|xlsx|csv|ods)$/.test(ext) ? 'X' : /^(ppt|pptx|odp)$/.test(ext) ? 'P' : null;
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
      {BADGE && (
        <text x="24" y="41" textAnchor="middle" dominantBaseline="middle"
          fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="7" fill="#ffffff">
          {BADGE}
        </text>
      )}
    </svg>
  );
}

/** 行内小图标（列表/树模式每行图标位，默认 16px）：只画轮廓、不画内部横线与角标字母——
 *  GridIcon 那套细节缩到 16px 会糊成一团。配色与 GridIcon 同源（extColor），
 *  所以同一文件在网格视图与列表视图颜色一致；图片行的真实缩略图加载不了时也回退到它 */
export function MiniIcon(props: { isDir: boolean; name: string; size?: number }) {
  const s = props.size ?? 16;
  if (props.isDir) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="mi-folder" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f0c36d" />
            <stop offset="1" stopColor="#e8a13c" />
          </linearGradient>
        </defs>
        <path d="M6 14a4 4 0 0 1 4-4h10l4 5h14a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="url(#mi-folder)" />
      </svg>
    );
  }
  const ext = props.name.split('.').pop()?.toLowerCase() ?? '';
  const color = extColor(props.name);
  const id = `mi-${ext || 'file'}`;
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <path d="M10 4h20l8 8v30a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={`url(#${id})`} />
      <path d="M30 4l8 8h-8z" fill="#ffffff" fillOpacity="0.55" />
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

/** 调色盘（「自定义配色」入口）：原来用的是 emoji 🎨——没装彩色 emoji 字体的桌面上会渲染成
 *  灰扑扑的单色（用户实报"能不能改成彩色的"）。自绘 SVG：木色盘身 + 四个彩色颜料点，
 *  与 folder/plus 那几个图标同一路子，也不依赖系统字体 */
export function IconPalette({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: '-2px', flexShrink: 0 }}>
      <defs>
        <linearGradient id="ic-palette" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9b04a" />
          <stop offset="1" stopColor="#a97c1a" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.6C6.7 2.6 2.4 6.9 2.4 12.1S6.7 21.6 12 21.6c1.3 0 2.2-1 2.2-2.2 0-.6-.2-1.1-.6-1.5-.3-.4-.5-.9-.5-1.4 0-1.2 1-2.2 2.2-2.2h2.4c2.9 0 5.5-2.4 5.5-5.5 0-3.5-4.9-6.2-11.2-6.2z"
        fill="url(#ic-palette)"
      />
      <circle cx="7.1" cy="11.9" r="1.6" fill="#e5484d" />
      <circle cx="10.3" cy="7.3" r="1.6" fill="#f5a623" />
      <circle cx="15.6" cy="7.8" r="1.6" fill="#2f9e44" />
      <circle cx="17.7" cy="12.7" r="1.6" fill="#3b82f6" />
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

/** 重命名/移动：紫色铅笔 */
export function IconRename({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M4 20l1.3-4.3L15.5 5.5a2.1 2.1 0 0 1 3 3L8.3 18.7 4 20z" stroke="#a371f7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M13.8 7.2l3 3" stroke="#a371f7" strokeWidth="1.8" strokeLinecap="round" />
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

/** 获取（克隆/检出）：向下箭头 + 底线 */
export function IconDownload({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 6.5v10M7 12.5l5 5 5-5" stroke="#1f6feb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

/** 外部引用：灰色链环（svn:externals 引用的其他仓库内容） */
export function IconExternal({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path
        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        stroke="#8b949e"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
      />
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

/** 字体：A 与下划线（字体设置弹窗入口） */
export function IconFont({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M6 18L10.5 6h3L18 18M8 13.5h8" />
    </svg>
  );
}

/** 提示图标：线条勾（操作成功；颜色取 currentColor（=var(--ok)），无底填充随文字色，纯 SVG 跨平台一致） */
export function IconOk({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M5 12.5l4.6 4.5L19 7.5" />
    </svg>
  );
}

/** 提示图标：线条叉（操作失败；颜色取 currentColor（=var(--err)），无底填充随文字色，纯 SVG 跨平台一致） */
export function IconErr({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

/** 提示图标：线条感叹（操作警告/风险提示；颜色取 currentColor（=var(--warn)），无底填充随文字色） */
export function IconWarn({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 5v9.5" />
      <circle cx="12" cy="18.2" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 信息「i」图标（关于弹窗入口） */
export function IconInfo({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 帮助问号（黄）：长说明收进悬浮提示后的入口——不占版面，悬浮出全文。
 *  固定黄色（不走 currentColor）：在 16 套主题下都能一眼看出"这里可以问"，与文件夹图标同一套黄 */
export function IconHelp({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      {/* 圆底：浅黄填充 + 深黄描边 */}
      <circle cx="12" cy="12" r="9.2" fill="#f0c36d" stroke="#e8a13c" strokeWidth="1.6" />
      {/* 问号：白色（用户指定"黄底 + 白字"，与系统 help 光标同观感） */}
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 17h.01" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}
