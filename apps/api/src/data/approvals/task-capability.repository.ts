import {
  AccessDuration,
  ConnectionScope,
  GrantTargetType,
  TaskCapability
} from '../../shared/types';

export interface TaskCapabilityRepository {
  // Adds the capability, or returns the one already added for this approval.
  add(input: {
    taskId: string;
    approvalId: string;
    targetType: GrantTargetType;
    targetId: string;
    skillVersionId: string | null;
    scope: ConnectionScope | null;
    duration: AccessDuration;
    grantedByHumanId: string;
  }): Promise<{ capability: TaskCapability; created: boolean }>;
  getById(capabilityId: string): Promise<TaskCapability | null>;
  listForTask(taskId: string, options: { activeOnly: boolean }): Promise<TaskCapability[]>;
  // Returns null when it was already revoked or doesn't exist.
  revoke(capabilityId: string, humanId: string): Promise<TaskCapability | null>;
}
