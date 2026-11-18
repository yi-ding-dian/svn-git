/** App 的跟随鼠标轻提示（toast）状态：从 app.tsx 原样抽出。
 *
 *  - toast 文案 / 是否错误 / 是否轻提示 / 自定义时长
 *  - 停留计时（成功 1.5s、错误 3s、quick 1.5s，调用方可传 durationMs 覆盖）
 *  - 鼠标位置（提示跟随鼠标；App 的缩放提示与更新飞行线也读它，故一并暴露）
 *  - 错误出场时轻抖（shakeEl）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { shakeEl } from '../animations/index.js';

export function useToast() {
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState(false);
  /** 轻提示（1.5s 消失；重复操作提醒等"扫一眼就够"的）——见 showToast 的 quick 参数 */
  const [toastQuick, setToastQuick] = useState(false);
  /** 自定义停留时长（ms）：转后台提示用 2s；null = 按错误/成功/quick 的默认档 */
  const [toastDuration, setToastDuration] = useState<number | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  // toast：跟随鼠标位置悬浮提示，1.5 秒后淡出（不用底部固定条）
  const mouseRef = useRef({ x: window.innerWidth / 2, y: 60 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  useEffect(() => {
    if (!toast) return;
    // 成功 1.5s 淡出；失败停留 3 秒（够读完一行报错，又不至于赖着不走）；轻提示（quick）1.5s
    // 局部变量名用 timer 而非 t：本文件 import 了 i18n 的 t()，同名会遮蔽
    const timer = setTimeout(() => setToast(''), toastDuration ?? (toastQuick || !toastErr ? 1500 : 3000));
    return () => clearTimeout(timer);
  }, [toast, toastErr, toastQuick, toastDuration]);
  // 错误提示出场时轻抖一下（"出了状况"的肢体语言；成功提示不抖）
  useEffect(() => {
    if (toastErr) shakeEl(toastRef.current);
  }, [toast, toastErr]);

  /** 统一提示入口（**跟随鼠标**的即时反馈——你主动操作的反馈；后台任务的完成通知不在这里：
   *  走铃铛气泡，见 header）。默认按「成功」显示，是错误必须由调用方显式传 err=true。
   *  quick：**轻提示**（1.5s 且淡出动画配套缩短）——重复操作提醒这类"扫一眼就够"的，
   *  不需要错误那 3 秒的阅读时间（用户定稿：重复操作的提示 1.5s 消失）。
   *  旧写法把裸 setToast 当 onToast 往下传，而 toastErr 只在错误分支被置 true、
   *  成功分支没人复位，于是一次失败之后所有普通提示都红着显示（实报：右键「复制完整路径」弹红 ✗）——
   *  红不红与那次操作毫无关系，只取决于这次会话之前有没有出过错。此处默认复位，由调用方声明错误。 */
  const showToast = useCallback((msg: string, err = false, quick = false, durationMs?: number) => {
    setToastErr(err);
    setToastQuick(quick);
    // 每次显式设置（含 null）：上一次的自定义时长不能影响下一条提示
    setToastDuration(durationMs ?? null);
    setToast(msg);
  }, []);

  return { toast, toastErr, toastQuick, toastRef, mouseRef, showToast };
}
