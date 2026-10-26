import { calculateGraceMs, planRun } from './schedule';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 0, minutes));
const hourly = (policy: 'ask' | 'run_once' | 'skip') => ({
  nextRunAt: at(60),
  intervalMinutes: 60,
  missedRunPolicy: policy
});

describe('planRun', () => {
  it('waits until the run is due', () => {
    expect(planRun(hourly('run_once'), at(59))).toBeNull();
  });

  it('runs a slot within the grace period, whatever the policy', () => {
    expect(planRun(hourly('skip'), at(70))).toEqual({
      start: true,
      ask: false,
      slot: at(60),
      skipped: 0,
      nextRunAt: at(120)
    });
  });

  it('runs once for missed slots with run_once, and moves to the next future slot', () => {
    // Off from 0:59 to 4:30: the 1:00, 2:00, 3:00, and 4:00 slots passed.
    expect(planRun(hourly('run_once'), at(270))).toEqual({
      start: true,
      ask: false,
      slot: at(240),
      skipped: 3,
      nextRunAt: at(300)
    });
  });

  it('skips every missed slot with skip', () => {
    expect(planRun(hourly('skip'), at(270))).toEqual({
      start: false,
      ask: false,
      slot: at(240),
      skipped: 4,
      nextRunAt: at(300)
    });
  });

  it('still runs the latest slot under skip when only earlier slots were missed', () => {
    // Back at 4:05: 1:00 to 3:00 were missed, but 4:00 is only 5 minutes late.
    expect(planRun(hourly('skip'), at(245))).toEqual({
      start: true,
      ask: false,
      slot: at(240),
      skipped: 3,
      nextRunAt: at(300)
    });
  });

  describe('ask (the default)', () => {
    it('runs a single missed run when the next one is not close', () => {
      // Back at 1:20: only 1:00 was missed, and 2:00 is 40 minutes away.
      expect(planRun(hourly('ask'), at(80))).toEqual({
        start: true,
        ask: false,
        slot: at(60),
        skipped: 0,
        nextRunAt: at(120)
      });
    });

    it('asks a person when the next run is close', () => {
      // Back at 1:50: 2:00 is 10 minutes away, under a quarter of the hour.
      expect(planRun(hourly('ask'), at(110))).toEqual({
        start: false,
        ask: true,
        slot: at(60),
        skipped: 1,
        nextRunAt: at(120)
      });
    });

    it('asks a person when several runs were missed', () => {
      expect(planRun(hourly('ask'), at(270))).toEqual({
        start: false,
        ask: true,
        slot: at(240),
        skipped: 4,
        nextRunAt: at(300)
      });
    });

    it('still runs an on-time slot without asking', () => {
      expect(planRun(hourly('ask'), at(245))).toMatchObject({ start: true, ask: false });
    });
  });

  it('gives short intervals a shorter grace period', () => {
    expect(calculateGraceMs(10)).toBe(5 * 60_000);
    expect(calculateGraceMs(600)).toBe(15 * 60_000);
  });
});
