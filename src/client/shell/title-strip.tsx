/** 自绘标题条（仅 Windows 打包版）。
 *
 *  为什么存在：系统窗口标题永远左对齐贴着图标，Windows 没有「居中」这个开关，想居中只能自己画。
 *  主进程因此藏掉了系统标题栏（titleBarStyle:'hidden'），再用 titleBarOverlay 让最小化/最大化/关闭
 *  仍然由系统绘制（Snap 布局、双击最大化、悬停高亮都保留），这条 32px 的横条就是顶替出来的那一条：
 *  - 中间居中显示 svn-git-V<版本>（svn 紫 / git 橙，取图标里 S、G 色块的颜色）
 *  - 整条是窗口拖动区（-webkit-app-region: drag；双击 = 最大化/还原是 Chromium 原生行为）
 *
 *  这里不放 logo：标题条只有 32px 高，图标缩到 16px 已经认不出 S/G；双色文字本身就把品牌说清楚了，
 *  logo 留在顶栏（26px 才看得清）。
 *  浏览器打开（含打包版的 --browser 模式）没有 preload → window.svngit 不存在 → 不渲染；
 *  非 Windows（Linux）同样是原生的标题栏，也不用画。 */
import React from 'react';
import { TITLE_BAR_HEIGHT } from '../../shared/titlebar.js';

/** 是否运行在「藏了系统标题栏」的 Electron 窗口里（只有这种窗口才需要自绘条） */
function hasCustomTitleBar(): boolean {
  const bridge = (window as unknown as { svngit?: { platform?: string } }).svngit;
  return bridge?.platform === 'win32';
}

export function TitleStrip(props: {
  /** 应用版本（/api/info 的 version）：首帧还没到时先只显示 svn-git */
  version?: string;
}) {
  if (!hasCustomTitleBar()) return null;
  return (
    <div className="title-strip" style={{ height: TITLE_BAR_HEIGHT }}>
      {/* svn / git 的颜色来自主题的 --svn/--git（与顶栏 GIT/SVN 徽标同源，深色主题自动提亮）；
          连字符和版本号保持灰色：彩色是"身份"，版本号是"信息" */}
      <span className="title-strip-text">
        <span className="title-strip-svn">svn</span>-<span className="title-strip-git">git</span>
        {props.version ? `-V${props.version}` : ''}
      </span>
    </div>
  );
}
