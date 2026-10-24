import { CalendarRecurrence } from '../../shared/types';
import { nextCalendarRun } from './calendar';
import { planRun } from './schedule';

const daily: CalendarRecurrence = {
  frequency: 'daily',
  time: '09:00',
  timeZone: 'America/New_York'
};
const next = (rule: CalendarRecurrence, after: string) =>
  nextCalendarRun(rule, new Date(after)).toISOString();

describe('source calendar slots', () => {
  it('keeps 9 AM Eastern across the spring and fall changes', () => {
    expect(next(daily, '2026-03-07T14:00:00Z')).toBe('2026-03-08T13:00:00.000Z');
    expect(next(daily, '2026-10-31T13:00:00Z')).toBe('2026-11-01T14:00:00.000Z');
  });
  it('skips nonexistent local times instead of shifting the requested clock time', () => {
    expect(next({ ...daily, time: '02:30' }, '2026-03-07T07:30:00Z')).toBe(
      '2026-03-09T06:30:00.000Z'
    );
  });
  it('uses the earlier repeated instant and never emits the second occurrence', () => {
    const rule = { ...daily, time: '01:30' };
    expect(next(rule, '2026-10-31T05:30:00Z')).toBe('2026-11-01T05:30:00.000Z');
    expect(next(rule, '2026-11-01T05:30:00Z')).toBe('2026-11-02T06:30:00.000Z');
    expect(next(rule, '2026-11-01T06:00:00Z')).toBe('2026-11-02T06:30:00.000Z');
  });
  it('handles half-hour DST transitions and non-hour UTC offsets', () => {
    expect(
      next({ ...daily, time: '02:15', timeZone: 'Australia/Lord_Howe' }, '2026-10-02T15:45:00Z')
    ).toBe('2026-10-04T15:15:00.000Z');
    expect(next({ ...daily, timeZone: 'Asia/Kathmandu' }, '2026-10-24T00:00:00Z')).toBe(
      '2026-10-24T03:15:00.000Z'
    );
  });
  it('skips weekends and preserves ISO weekday selections in the source zone', () => {
    expect(next({ ...daily, frequency: 'weekdays' }, '2026-03-06T14:00:00Z')).toBe(
      '2026-03-09T13:00:00.000Z'
    );
    expect(next({ ...daily, frequency: 'weekly', days: [1, 3, 7] }, '2026-10-24T20:00:00Z')).toBe(
      '2026-10-25T13:00:00.000Z'
    );
    expect(
      next({ ...daily, frequency: 'weekly', days: [1], time: '00:30' }, '2026-10-25T20:00:00Z')
    ).toBe('2026-10-26T04:30:00.000Z');
  });
  it('handles month and year boundaries', () => {
    expect(next(daily, '2026-12-31T14:00:00Z')).toBe('2027-01-01T14:00:00.000Z');
  });
});

describe('missed calendar runs', () => {
  const input = {
    recurrence: daily,
    intervalMinutes: null,
    nextRunAt: new Date('2026-03-06T14:00:00Z'),
    missedRunPolicy: 'ask' as const
  };
  it('counts actual slots over DST and asks once for several missed runs', () => {
    expect(planRun(input, new Date('2026-03-09T15:00:00Z'))).toEqual({
      start: false,
      ask: true,
      skipped: 4,
      slot: new Date('2026-03-09T13:00:00Z'),
      nextRunAt: new Date('2026-03-10T13:00:00Z')
    });
  });
  it('runs only the latest slot for run_once and skips all missed slots for skip', () => {
    expect(
      planRun({ ...input, missedRunPolicy: 'run_once' }, new Date('2026-03-09T15:00:00Z'))
    ).toMatchObject({ start: true, skipped: 3 });
    expect(
      planRun({ ...input, missedRunPolicy: 'skip' }, new Date('2026-03-09T15:00:00Z'))
    ).toMatchObject({ start: false, ask: false, skipped: 4 });
  });
  it('runs a single missed slot, but asks when the next actual slot is close', () => {
    expect(planRun(input, new Date('2026-03-06T16:00:00Z'))).toMatchObject({
      start: true,
      ask: false,
      skipped: 0
    });
    expect(planRun(input, new Date('2026-03-07T12:00:00Z'))).toMatchObject({
      start: false,
      ask: true,
      skipped: 1
    });
  });
  it('still runs within the grace period and does not count a gap as missed', () => {
    expect(
      planRun({ ...input, missedRunPolicy: 'skip' }, new Date('2026-03-09T13:05:00Z'))
    ).toMatchObject({ start: true, skipped: 3 });
    expect(
      planRun(
        {
          ...input,
          recurrence: { ...daily, time: '02:30' },
          nextRunAt: new Date('2026-03-07T07:30:00Z')
        },
        new Date('2026-03-09T06:31:00Z')
      )
    ).toMatchObject({ start: true, skipped: 1 });
  });
});
