import {
  CalendarRecurrence,
  MissedRunPolicy,
  Responsibility,
  ResponsibilityStatus
} from '../../shared/types';

export interface CreateResponsibilityInput {
  projectId: string;
  agentId: string | null;
  conversationId: string | null;
  title: string;
  brief: string;
  completionCriteria: string;
  intervalMinutes: number | null;
  recurrence: CalendarRecurrence | null;
  missedRunPolicy: MissedRunPolicy;
  nextRunAt: Date;
  createdByHumanId: string;
}

export interface ResponsibilityChanges {
  agentId?: string | null;
  title?: string;
  brief?: string;
  completionCriteria?: string;
  intervalMinutes?: number | null;
  recurrence?: CalendarRecurrence | null;
  missedRunPolicy?: MissedRunPolicy;
  nextRunAt?: Date;
  status?: ResponsibilityStatus;
}

export interface CatchUpDecision {
  slot: Date;
  decision: 'run' | 'wait';
  taskId: string | null;
  runKey: string | null;
}

export interface ResponsibilityRepository {
  create(input: CreateResponsibilityInput): Promise<Responsibility>;
  getById(responsibilityId: string): Promise<Responsibility | null>;
  list(input: {
    agentId?: string;
    projectId?: string;
    status?: ResponsibilityStatus;
    limit: number;
    offset: number;
  }): Promise<Responsibility[]>;
  count(input: { agentId?: string; projectId?: string; status?: ResponsibilityStatus }): Promise<number>;
  // Cancelled is final: returns null without changing a cancelled responsibility.
  update(responsibilityId: string, changes: ResponsibilityChanges): Promise<Responsibility | null>;
  // Enabled responsibilities whose next run is due.
  listDue(now: Date, limit: number): Promise<Responsibility[]>;
  // Moves the schedule on, only if nobody else did since it was read. Returns false when
  // another runner got there first, so only one of them starts the run.
  advance(
    responsibilityId: string,
    expectedNextRunAt: Date,
    changes: {
      nextRunAt: Date;
      lastRunAt: Date | null;
      catchUp?: { slot: Date; missed: number } | null;
    }
  ): Promise<boolean>;
  // A saved answer remains replayable only in its enabled, unretimed, future schedule window.
  getCatchUpDecision(responsibilityId: string, slot?: Date): Promise<CatchUpDecision | null>;
}
