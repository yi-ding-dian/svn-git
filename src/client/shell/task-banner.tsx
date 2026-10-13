/** 后台任务完成横幅：贴顶栏下方的**浮层**横条——绿 ✓ 成功 / 红 ✗ 失败 + 任务名 + 结果消息，
 *  3 秒自动淡出（keyframes 在 style.css 的 task-banner-fade）。fixed 定位不推挤内容、
 *  pointer-events:none 不挡操作；错过不丢——铃铛留档（shared/notices）。
 *  用户定稿："在这里提示行不行…成功绿色带√，错误红色带x。显示3s"。 */
import React, { useEffect, useState } from 'react';
import { IconOk, IconErr } from '../ui/icons.js';

export function TaskBanner({ info }: { info: { title: string; message: string; err: boolean } }) {
  const [top, setTop] = useState(43);
  // 顶栏高度动态量取（字号/主题/缩放都可能改高度——别硬编码导致 1~2px 漂移）
  useEffect(() => {
    const h = document.querySelector('.header');
    if (h) setTop(h.getBoundingClientRect().height);
  }, []);
  return (
    <div className={`task-banner${info.err ? ' err' : ''}`} style={{ top }}>
      {info.err ? <IconErr size={15} /> : <IconOk size={15} />}
      <span style={{ fontWeight: 600, flexShrink: 0 }}>{info.title}</span>
      {info.message && (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info.message}>
          {info.message}
        </span>
      )}
    </div>
  );
}
