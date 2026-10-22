import {
  Approval,
  ApprovalResult,
  ApprovalStatus,
  ConnectionCallRequest
} from '../../shared/types';

export interface ApprovalRepository {
  // Creates the approval, or returns the existing one with the same clientKey.
  create(input: {
    clientKey: string;
    taskId: string;
    agentId: string;
    request: ConnectionCallRequest;
  }): Promise<{ approval: Approval; created: boolean }>;
  getById(approvalId: string): Promise<Approval | null>;
  list(input: {
    status?: ApprovalStatus;
    // Only approvals on tasks this person may see.
    visibleToHumanId?: string;
    limit: number;
    offset: number;
  }): Promise<Approval[]>;
  count(input: { status?: ApprovalStatus; visibleToHumanId?: string }): Promise<number>;
  // Records the decision only if the approval is still pending. Returns null otherwise.
  decide(input: {
    approvalId: string;
    status: 'approved' | 'rejected';
    humanId: string;
    reason: string | null;
  }): Promise<Approval | null>;
  listApprovedNotExecuted(limit: number): Promise<Approval[]>;
  // Claims the approved call before it is made, so it is never made twice, even after a crash.
  // Returns false if it was already claimed.
  markExecuted(approvalId: string, result: ApprovalResult): Promise<boolean>;
  saveResult(approvalId: string, result: ApprovalResult): Promise<void>;
}
