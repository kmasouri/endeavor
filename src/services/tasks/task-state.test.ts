import { TASK_STATES } from '../../shared/types';
import { canTransition, isFinished } from './task-state';

describe('task state rules', () => {
  it.each([
    ['working', 'waiting'],
    ['working', 'completed'],
    ['working', 'blocked'],
    ['working', 'cancelled'],
    ['waiting', 'working'],
    ['waiting', 'completed'],
    ['waiting', 'blocked'],
    ['waiting', 'cancelled'],
    ['blocked', 'working'],
    ['blocked', 'cancelled']
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['blocked', 'completed'],
    ['blocked', 'waiting']
  ] as const)('does not allow %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('never leaves completed or cancelled', () => {
    for (const to of TASK_STATES) {
      expect(canTransition('completed', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
  });

  it('treats completed and cancelled as finished', () => {
    expect(TASK_STATES.filter((state) => isFinished({ state }))).toEqual([
      'completed',
      'cancelled'
    ]);
  });
});
