import { AgentGrant, GrantTargetType } from '../../shared/types';

export interface GrantRepository {
  // Grants (again) access. A revoked grant becomes active again.
  grant(input: {
    agentId: string;
    targetType: GrantTargetType;
    targetId: string;
    grantedByHumanId: string;
    // Set false when reading back an atomic configuration grant to preserve later revocation.
    restoreRevoked?: boolean;
  }): Promise<AgentGrant>;
  // Returns false when there was no active grant.
  revoke(input: {
    agentId: string;
    targetType: GrantTargetType;
    targetId: string;
    revokedByHumanId: string;
  }): Promise<boolean>;
  listGrants(agentId: string, options: { activeOnly: boolean }): Promise<AgentGrant[]>;
}
