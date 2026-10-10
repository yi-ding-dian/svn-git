/** 视图图标位 · 缩略图：图片文件显示这张图自己的缩略图（**原地替换**通用类型图标，尺寸由 box 决定、
 *  与它替换掉的图标一致，布局零变化）；非图片 / 磁盘缺失 / 图太大 / 加载失败 → 渲染传入的 fallback，
 *  绝不显示破图。三处共用：列表行（index.tsx renderEntryRow）、树与过滤树行（rows.tsx TreeRow）、
 *  浏览网格（grid.tsx GridItem）。
 *
 *  为什么版本号用「size-mtime」而不是刷新计数 tick：
 *  URL 是浏览器图片缓存的键。带 tick 的话每次刷新 URL 都变 → 缓存全失效、整屏缩略图重下且闪一下；
 *  带文件自身的 size-mtime 则"文件没变 URL 就不变"——连请求都不发，文件变了自动换新。
 *  盲区（写进注释免后人踩）：mtime 只到分钟（后端 fmtMtime），同一分钟内、字节数又完全相同的改写
 *  识别不出来，最长 60s 后才刷新。 */
import React, { useEffect, useState } from 'react';
import { isImageFile } from '../../shared/utils.js';

/** 超过这个体积不做缩略图：浏览器要把整图解码后再缩小，列表里几十张大图会明显拖慢；
 *  服务端 /api/file 的硬上限是 50MB，这里取更保守的一档。 */
const THUMB_MAX_BYTES = 8 * 1024 * 1024;

export function ThumbIcon(props: {
  rel: string;
  name: string;
  /** 文件字节数（列表数据里已有，无需额外请求）；缺失/删除的条目后端给 0 → 直接回退 */
  size: number;
  /** 修改时间（列表数据里已有）：与 size 一起当版本号，文件变了才重取 */
  mtime: string;
  isDir?: boolean;
  /** 磁盘上已缺失（svn '!' / git " D"）：没有文件可读，回退 */
  miss?: boolean;
  /** 图标位尺寸：行内给 '1.15em'（随界面字号缩放，行高零变化），网格给 '40px'（与 GridIcon 一致，
   *  一改整格节奏和右下角状态徽标的定位都会跑偏） */
  box: string;
  /** 不显示缩略图时的类型图标（行内 MiniIcon / 网格 GridIcon） */
  fallback: React.ReactNode;
}) {
  const ver = `${props.size}-${props.mtime}`;
  const canThumb =
    !props.isDir && !props.miss && props.size > 0 && props.size <= THUMB_MAX_BYTES && isImageFile(props.name);
  const [bad, setBad] = useState(false);
  // 换文件（版本号变）后清掉失败标记：否则文件被修好/还原了，也一直停在回退图标上
  useEffect(() => setBad(false), [ver]);
  return (
    <span className="fs-ico" style={{ width: props.box, height: props.box }}>
      {!canThumb || bad ? (
        props.fallback
      ) : (
        <img
          className="fs-thumb"
          src={`/api/file?path=${encodeURIComponent(props.rel)}&v=${encodeURIComponent(ver)}`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBad(true)}
        />
      )}
    </span>
  );
}
