import type { HumanPreferences } from './api';

// Display only: every formatter keeps the original instant and uses the device timezone.
export const timeDisplay = $state<{ format: HumanPreferences['timeFormat'] }>({ format: '12h' });
export function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: timeDisplay.format === '12h' ? 'h12' : 'h23'
  }).format(Date.parse(value));
}
export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: timeDisplay.format === '12h' ? 'h12' : 'h23'
  }).format(Date.parse(value));
}
export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
