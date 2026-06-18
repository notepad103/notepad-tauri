export function isSameCalendarDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function isTodayTimestamp(timestampSeconds: number | null): boolean {
  if (!timestampSeconds) return false;
  return isSameCalendarDay(new Date(timestampSeconds * 1000), new Date());
}

export function formatNoteDisplayTime(createdAt: number | null): string {
  if (!createdAt) return "";

  const date = new Date(createdAt * 1000);
  if (isSameCalendarDay(date, new Date())) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatReadingNoteTime(date = new Date()): string {
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
