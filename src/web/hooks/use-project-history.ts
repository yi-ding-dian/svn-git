/** 最近项目列表（侧边栏）：从 App 抽出（原 app.tsx:36 状态 + 141-147 + 163-177）。
 *  打开过的仓库列表，"常用"标记的项目下次启动优先打开；删除/设常用都由后端返回新列表。
 */
import { useCallback, useRef, useState } from 'react';
import { get, post, type HistoryItem } from '../api.js';

export function useProjectHistory(onError: (msg: string) => void) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  /** 回调存 ref：调用方不必为它包 useCallback，也不会因它变化重建这几个方法 */
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const loadHistory = useCallback(() => {
    get
      .history()
      .then((r) => setHistory(r.items))
      .catch(() => {});
  }, []);

  /** 删除最近项目（侧边栏右键菜单）：删除后刷新列表 */
  const removeHistory = useCallback((path: string) => {
    void post
      .historyRemove(path)
      .then((r) => setHistory(r.items))
      .catch(() => onErrorRef.current('删除失败'));
  }, []);

  /** 设置/取消常用项目（侧边栏右键菜单）：星号标记，下次启动优先打开 */
  const setFav = useCallback((path: string, fav: boolean) => {
    void post
      .historyFav(path, fav)
      .then((r) => setHistory(r.items))
      .catch(() => onErrorRef.current(fav ? '设置常用失败' : '取消常用失败'));
  }, []);

  return { history, loadHistory, removeHistory, setFav };
}
