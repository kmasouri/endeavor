import { MissedRunPolicy } from '../../shared/types';

export interface RunPlan {
  // Whether to start a run now, and for which time slot (the run's key).
  start: boolean;
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
// the latest slot is past the grace period (the service was down), 'run_once' still runs it
// once and 'skip' doesn't. Either way the next run is the first slot after now, so missed runs
// never pile up.
export function planRun(
  input: { nextRunAt: Date; intervalMinutes: number; missedRunPolicy: MissedRunPolicy },
  now: Date
): RunPlan | null {
  const intervalMs = input.intervalMinutes * 60_000;
  const lateMs = now.getTime() - input.nextRunAt.getTime();
  if (lateMs < 0) {
    return null;
  }
  const extraSlots = Math.floor(lateMs / intervalMs);
  const latestSlot = new Date(input.nextRunAt.getTime() + extraSlots * intervalMs);
  const nextRunAt = new Date(latestSlot.getTime() + intervalMs);
  const onTime = now.getTime() - latestSlot.getTime() <= graceMs(input.intervalMinutes);

  if (onTime || input.missedRunPolicy === 'run_once') {
    return { start: true, slot: latestSlot, skipped: extraSlots, nextRunAt };
  }
  return { start: false, slot: latestSlot, skipped: extraSlots + 1, nextRunAt };
}
