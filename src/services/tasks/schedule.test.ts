import { planRun } from './schedule';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 0, minutes));
const hourly = (policy: 'run_once' | 'skip') => ({
  nextRunAt: at(60),
  intervalMinutes: 60,
  missedRunPolicy: policy
});

describe('planRun', () => {
  it('waits until the run is due', () => {
    expect(planRun(hourly('run_once'), at(59))).toBeNull();
  });

  it('runs a slot that is less than one interval late', () => {
    expect(planRun(hourly('skip'), at(90))).toEqual({
      start: true,
      slot: at(60),
      skipped: 0,
      nextRunAt: at(120)
    });
  });

  it('runs once for missed slots with run_once, and moves to the next future slot', () => {
    // Off from 0:59 to 4:30: the 1:00, 2:00, 3:00, and 4:00 slots passed.
    expect(planRun(hourly('run_once'), at(270))).toEqual({
      start: true,
      slot: at(240),
      skipped: 3,
      nextRunAt: at(300)
    });
  });

  it('skips every missed slot with skip', () => {
    expect(planRun(hourly('skip'), at(270))).toEqual({
      start: false,
      slot: at(240),
      skipped: 4,
      nextRunAt: at(300)
    });
  });
});
