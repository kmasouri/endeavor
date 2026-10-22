import { MissedRunPolicy } from '../../shared/types';

export interface RunPlan {
  // Whether to start a run now, and for which time slot (the run's key).
  start: boolean;
  slot: Date;
  // Slots that passed without a run, such as while the computer was off.
  skipped: number;
  nextRunAt: Date;
}

// Decides what a due responsibility does now. A run that is less than one interval late runs
// normally. If more slots went by (the service was down), 'run_once' starts one run for the
// latest missed slot and records the rest as skipped; 'skip' starts none. Either way the next
// run is the first slot after now, so missed runs never pile up.
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

  if (extraSlots === 0) {
    return { start: true, slot: latestSlot, skipped: 0, nextRunAt };
  }
  return input.missedRunPolicy === 'run_once'
    ? { start: true, slot: latestSlot, skipped: extraSlots, nextRunAt }
    : { start: false, slot: latestSlot, skipped: extraSlots + 1, nextRunAt };
}
