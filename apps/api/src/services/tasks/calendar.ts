import { CalendarRecurrence } from '../../shared/types';

const DAY = 86_400_000;

// Use an explicit Gregorian calendar and hour cycle, independent of the server's locale.
function localParts(format: Intl.DateTimeFormat, instant: number): number[] {
  const parts = format.formatToParts(instant);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((name) =>
    Number(parts.find((part) => part.type === name)!.value)
  );
}
function wallTime(parts: number[]): number {
  return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

// A gap has no matching instant: skip that date. In a fold, use the earlier instant once.
// Probe both sides of the date to find offsets, including half-hour DST transitions and
// whole-day timezone changes. Always verify the resulting local date and time.
function slotOnDate(format: Intl.DateTimeFormat, date: number, time: string): Date | null {
  const [hour, minute] = time.split(':').map(Number);
  const wall = date + (hour * 60 + minute) * 60_000;
  const offsets = new Set<number>();
  for (const delta of [-2 * DAY, -DAY, 0, DAY, 2 * DAY]) {
    const probe = wall + delta;
    offsets.add(wallTime(localParts(format, probe)) - probe);
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wallTime(localParts(format, instant)) === wall);
  return matches.length ? new Date(Math.min(...matches)) : null;
}

// Returns the first matching slot strictly after the given instant. Calendar arithmetic
// uses source dates; adding an elapsed 24 hours would drift through daylight saving changes.
export function nextCalendarRun(rule: CalendarRecurrence, after: Date): Date {
  const format = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: rule.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = localParts(format, after.getTime());
  const firstDate = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  for (let day = 0; day < 16; day++) {
    const date = firstDate + day * DAY;
    const weekday = new Date(date).getUTCDay() || 7;
    if (rule.frequency === 'weekdays' && weekday > 5) continue;
    if (rule.frequency === 'weekly' && !rule.days?.includes(weekday)) continue;
    const slot = slotOnDate(format, date, rule.time);
    if (slot && slot > after) return slot;
  }
  throw new Error('Calendar rule has no matching date within 16 days');
}
