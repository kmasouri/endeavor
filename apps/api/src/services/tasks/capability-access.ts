import { AgentConfigConflictError, AgentRepository, CatalogRepository } from '../../data';
import { pathWithin } from '../../shared/connection-access';
import { AppError } from '../../shared/errors';
import { Connection, ConnectionScope, GrantTargetType } from '../../shared/types';

// What a connection lets an agent do right now, as shown in discovery and access requests.
export function scopeOf(connection: Connection): ConnectionScope {
  return connection.kind === 'mcp'
    ? { kind: 'mcp', tools: [...(connection.allowedTools ?? [])] }
    : {
        kind: 'http',
        methods: [...connection.allowedMethods],
        pathPrefixes: [...connection.allowedPathPrefixes]
      };
}

// The overlap of an approved scope and the connection's current scope. A later catalog edit can
// narrow what a person approved, but never widen it. Two path prefixes overlap when one lies
// within the other, and the narrower one is the overlap.
export function narrowScope(approved: ConnectionScope, current: ConnectionScope): ConnectionScope {
  if (approved.kind === 'mcp' || current.kind === 'mcp') {
    const tools =
      approved.kind === 'mcp' && current.kind === 'mcp'
        ? approved.tools.filter((tool) => current.tools.includes(tool))
        : [];
    return { kind: 'mcp', tools };
  }
  const prefixes = new Set<string>();
  for (const a of approved.pathPrefixes) {
    for (const b of current.pathPrefixes) {
      if (pathWithin(a, b)) prefixes.add(a);
      else if (pathWithin(b, a)) prefixes.add(b);
    }
  }
  return {
    kind: 'http',
    methods: approved.methods.filter((method) => current.methods.includes(method)),
    pathPrefixes: [...prefixes]
  };
}

// The connection with only the approved scope. Per-call approval rules stay as they are.
export function limitConnection(connection: Connection, approved: ConnectionScope): Connection {
  const scope = narrowScope(approved, scopeOf(connection));
  return scope.kind === 'mcp'
    ? { ...connection, allowedTools: scope.tools }
    : { ...connection, allowedMethods: scope.methods, allowedPathPrefixes: scope.pathPrefixes };
}

export function isEmptyScope(scope: ConnectionScope): boolean {
  return scope.kind === 'mcp'
    ? scope.tools.length === 0
    : scope.methods.length === 0 || scope.pathPrefixes.length === 0;
}

export function describeScope(scope: ConnectionScope): string {
  return scope.kind === 'mcp'
    ? `tools: ${scope.tools.join(', ') || 'none'}`
    : `methods: ${scope.methods.join(', ') || 'none'}; paths: ${scope.pathPrefixes.join(', ') || 'none'}`;
}

// Ongoing access adds the item to the agent's configuration as a new version, with its grant,
// in one statement. An item that is already chosen only gets its grant restored. Skills are
// pinned at the approved version. This matches POST /agents/:agentId/grants.
export async function addOngoingAccess(
  repositories: { agentRepository: AgentRepository; catalogRepository: CatalogRepository },
  input: {
    agentId: string;
    target: { type: GrantTargetType; id: string; skillVersionId: string | null };
    humanId: string;
  }
): Promise<void> {
  const { agentRepository, catalogRepository } = repositories;
  const agent = await agentRepository.getById(input.agentId);
  const current = agent?.currentVersionId
    ? await agentRepository.getVersion(agent.currentVersionId)
    : null;
  if (!agent || agent.deletedAt || !current) {
    throw new AppError('agentUnavailable', 'The agent has no configuration to add access to.');
  }
  let { skillVersionIds, connectionIds } = current;
  if (input.target.type === 'skill') {
    const chosen = await catalogRepository.getSkillVersions(skillVersionIds);
    if (!chosen.some((version) => version.skillId === input.target.id)) {
      skillVersionIds = [...skillVersionIds, input.target.skillVersionId as string];
    }
  } else if (!connectionIds.includes(input.target.id)) {
    connectionIds = [...connectionIds, input.target.id];
  }
  const changed =
    skillVersionIds !== current.skillVersionIds || connectionIds !== current.connectionIds;
  if (changed) {
    await agentRepository
      .addVersion(
        agent.id,
        {
          instructions: current.instructions,
          provider: current.provider,
          model: current.model,
          limits: current.limits,
          skillVersionIds,
          connectionIds,
          createdByHumanId: input.humanId
        },
        {
          actorId: input.humanId,
          expectedVersionId: current.id,
          grant: [{ type: input.target.type, id: input.target.id }],
          revoke: []
        }
      )
      .catch((error: unknown) => {
        if (error instanceof AgentConfigConflictError)
          throw new AppError('validationError', error.message);
        throw error;
      });
  }
  await catalogRepository.grant({
    agentId: agent.id,
    targetType: input.target.type,
    targetId: input.target.id,
    grantedByHumanId: input.humanId,
    restoreRevoked: !changed
  });
}
