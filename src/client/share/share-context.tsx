/** 共享访问状态（远程只读/在线人数）：由 ShareGuard 注入，顶栏等组件读取。 */
import React, { createContext, useContext } from 'react';
import type { ShareAccess } from '../../shared/share.js';

const ShareContext = createContext<ShareAccess | null>(null);

export function ShareProvider(props: { value: ShareAccess; children: React.ReactNode }) {
  return <ShareContext.Provider value={props.value}>{props.children}</ShareContext.Provider>;
}

/** 当前访问状态；未经过共享门禁（理论上不会）时返回 null */
export function useShareStatus(): ShareAccess | null {
  return useContext(ShareContext);
}
