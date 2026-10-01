/** 목록에 보여줄 짧은 상대 시간 ("방금 전", "3분 전", "어제", "9월 12일") */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 0 || diff < 60_000) return '방금 전';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;

  const d = new Date(ts);
  const n = new Date(now);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(n) - startOfDay(d)) / 86_400_000);

  if (dayDiff === 0) return `${Math.floor(min / 60)}시간 전`;
  if (dayDiff === 1) return '어제';
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
