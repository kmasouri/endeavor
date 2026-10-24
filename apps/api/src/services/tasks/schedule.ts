import { CalendarRecurrence, MissedRunPolicy } from '../../shared/types';
import { nextCalendarRun } from './calendar';

export interface RunPlan {
  // Whether to start a run now, and for which time slot (the run's key).
  start: boolean;
  // When true, don't run; ask a person whether to run now or wait for the next one.
  ask: boolean;
  slot: Date;
  // Slots that passed without a run, such as while the computer was off.
  skipped: number;
  nextRunAt: Date;
}

// How late a slot can be and still count as on time: half the interval, at most 15 minutes.
export function graceMs(intervalMinutes: number): number {
  return Math.min((intervalMinutes * 60_000) / 2, 15 * 60_000);
}

// Decides what a due responsibility does now. The latest slot runs if it is within the grace
// period, whatever the policy; any earlier slots were missed and are counted as skipped. If even
// the latest slot is past the grace period (the service was down):
// - 'ask' runs it if it is the only missed run and the next run isn't close (due within a
//   quarter of the interval). Otherwise it asks a person: run now, or wait for the next one.
// - 'run_once' always runs it once. 'skip' never does.
// Either way the next run is the first slot after now, so missed runs never pile up.
export function planRun(
  input: {
    nextRunAt: Date;
    intervalMinutes: number | null;
    recurrence?: CalendarRecurrence | null;
    missedRunPolicy: MissedRunPolicy;
  },
  now: Date
): RunPlan | null {
  if (now < input.nextRunAt) return null;
  let latestSlot = input.nextRunAt;
  let extraSlots = 0;
  let nextRunAt: Date;
  let intervalMs: number;
  if (input.recurrence) {
    nextRunAt = nextCalendarRun(input.recurrence, latestSlot);
    while (nextRunAt <= now) {
      latestSlot = nextRunAt;
      extraSlots++;
      nextRunAt = nextCalendarRun(input.recurrence, latestSlot);
    }
    intervalMs = nextRunAt.getTime() - latestSlot.getTime();
  } else {
    intervalMs = input.intervalMinutes! * 60_000;
    extraSlots = Math.floor((now.getTime() - latestSlot.getTime()) / intervalMs);
    latestSlot = new Date(latestSlot.getTime() + extraSlots * intervalMs);
    nextRunAt = new Date(latestSlot.getTime() + intervalMs);
  }
  const onTime = now.getTime() - latestSlot.getTime() <= graceMs(intervalMs / 60_000);

  if (onTime || input.missedRunPolicy === 'run_once') {
    return { start: true, ask: false, slot: latestSlot, skipped: extraSlots, nextRunAt };
  }
  const missed = extraSlots + 1;
  if (input.missedRunPolicy === 'ask') {
    const nextIsClose = nextRunAt.getTime() - now.getTime() < intervalMs / 4;
    if (missed === 1 && !nextIsClose) {
      return { start: true, ask: false, slot: latestSlot, skipped: 0, nextRunAt };
    }
    return { start: false, ask: true, slot: latestSlot, skipped: missed, nextRunAt };
  }
  return { start: false, ask: false, slot: latestSlot, skipped: missed, nextRunAt };
}
