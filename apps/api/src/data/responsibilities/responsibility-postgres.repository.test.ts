import { FastifyInstance } from 'fastify';
import { ResponsibilityPostgresRepository } from './responsibility-postgres.repository';

const oldSlot = new Date('2026-10-24T12:00:00Z');
const oldRun = new Date('2026-10-24T11:00:00Z');
const oldQuestion = new Date('2026-10-24T10:00:00Z');
const legacy = {
  id: 'r1',
  agent_id: 'a1',
  project_id: 'p1',
  conversation_id: null,
  title: 'Legacy',
  brief: 'Test',
  completion_criteria: 'Report',
  interval_minutes: 60,
  recurrence: null,
  missed_run_policy: 'ask',
  status: 'enabled',
  next_run_at: oldSlot,
  last_run_at: oldRun,
  catch_up_slot: oldQuestion,
  catch_up_missed: 2,
  created_by_human_id: 'h1',
  created_at: oldRun,
  updated_at: oldRun
};

describe('responsibility persistence compatibility', () => {
  it('reads a migrated interval row without changing its slots or open question', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [legacy] });
    const repository = new ResponsibilityPostgresRepository({
      query
    } as unknown as FastifyInstance['pg']);
    expect(await repository.getById('r1')).toMatchObject({
      intervalMinutes: 60,
      recurrence: null,
      nextRunAt: oldSlot,
      lastRunAt: oldRun,
      catchUp: { slot: oldQuestion, missed: 2 },
      status: 'enabled'
    });
  });
  it('round-trips a source calendar rule alongside its UTC slot, without inventing an interval', async () => {
    const recurrence = {
      frequency: 'weekly' as const,
      days: [1, 3],
      time: '09:00',
      timeZone: 'America/New_York'
    };
    const slot = new Date('2026-11-02T14:00:00Z');
    const query = jest.fn().mockResolvedValue({
      rows: [{ ...legacy, interval_minutes: null, recurrence, next_run_at: slot }]
    });
    const repository = new ResponsibilityPostgresRepository({
      query
    } as unknown as FastifyInstance['pg']);
    const result = await repository.create({
      agentId: 'a1',
      projectId: 'p1',
      conversationId: null,
      title: 'Weekly',
      brief: 'Test',
      completionCriteria: 'Report',
      intervalMinutes: null,
      recurrence,
      missedRunPolicy: 'ask',
      nextRunAt: slot,
      createdByHumanId: 'h1'
    });
    expect(query.mock.calls[0][1]).toEqual([
      expect.any(String),
      'a1',
      null,
      'Weekly',
      'Test',
      'Report',
      null,
      'ask',
      slot,
      'h1',
      recurrence,
      'p1'
    ]);
    expect(result).toMatchObject({ intervalMinutes: null, recurrence, nextRunAt: slot });
  });
});
