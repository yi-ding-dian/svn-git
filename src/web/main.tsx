/** Web 前端入口 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';

/** 开发模式标记（esbuild define 注入：dev 构建为 true，生产为 false） */
declare const __DEV__: boolean;

// 开发模式热刷新：app.js/style.css 变化或服务重启时自动刷新页面
if (__DEV__) {
  const lastM = new Map<string, string>();
  let failCount = 0;
  const check = async () => {
    try {
      const [a, c] = await Promise.all([
        fetch('/app.js', { method: 'HEAD', cache: 'no-store' }),
        fetch('/style.css', { method: 'HEAD', cache: 'no-store' }),
      ]);
      if (failCount > 0) {
        location.reload(); // 服务重启过（后端代码更新）
        return;
      }
      for (const [url, r] of [
        ['/app.js', a],
        ['/style.css', c],
      ] as const) {
        const lm = r.headers.get('last-modified') ?? '';
        if (lastM.has(url) && lm && lm !== lastM.get(url)) {
          location.reload(); // 前端代码/样式更新
          return;
        }
        if (lm) lastM.set(url, lm);
      }
      failCount = 0;
    } catch {
      failCount += 1; // 服务重启瞬间请求失败，恢复后自动刷新
    }
  };
  setInterval(check, 1500);
}

const container = document.getElementById('root')!;
createRoot(container).render(<App />);
