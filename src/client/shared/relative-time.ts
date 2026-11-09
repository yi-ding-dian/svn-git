/** 相对时间文案（最近推送 / 发布历史 / 我的仓库列表共用，避免各写一份）。 */
import { t } from '../../shared/i18n/index.js';

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return t('shell.time.justNow');
  if (mins < 60) return t('shell.time.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('shell.time.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('shell.time.daysAgo', { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('shell.time.monthsAgo', { n: months });
  return t('shell.time.yearsAgo', { n: Math.floor(months / 12) });
}

/** 绝对时间（本地时区 YYYY-MM-DD HH:mm；解析失败原样返回）——相对时间旁边的精确值 */
export function absTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
