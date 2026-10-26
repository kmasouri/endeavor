import type { Responsibility } from './api';

export const weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];
export const policyLabels = {
  ask: 'Run one, and ask me if several were missed',
  run_once: 'Always run once when back',
  skip: 'Skip missed runs'
} as const;

export function formatTimezoneLabel(timeZone: string): string {
  return (
    new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  );
}

// Source weekdays and wall-clock time always stay in the source timezone.
export function summarizeRecurrence(
  schedule: Pick<Responsibility, 'intervalMinutes' | 'recurrence'>,
  hour12 = true
): string {
  const rule = schedule.recurrence;
  if (!rule) return `Every ${schedule.intervalMinutes} minutes`;
  const clock = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12
  }).format(new Date(`2000-01-01T${rule.time}:00Z`));
  const repeat =
    rule.frequency === 'daily'
      ? 'Every day'
      : rule.frequency === 'weekdays'
        ? 'Every weekday'
        : `Every ${(rule.days ?? [])
            .slice()
            .sort((a, b) => a - b)
            .map((day) => weekdays[day - 1])
            .join(', ')}`;
  return `${repeat} at ${clock} · ${formatTimezoneLabel(rule.timeZone)} (${rule.timeZone})`;
}

// Actual instants are formatted separately from the rule, in the viewer's timezone.
export function scheduleInstant(value: string, timeZone?: string, hour12 = true): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    hour12
  }).format(new Date(value));
}
