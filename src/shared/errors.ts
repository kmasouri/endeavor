interface ErrorDefinition {
  code: number;
  statusCode: number;
  message: string;
}

// The error catalog: every error the API can return, each with its own code.
// The key is the error's name in responses. docs/errors.md documents each one.
//
// Codes are grouped by feature: 10xxx general, 20xxx items, 30xxx people and access, 40xxx tasks,
// 50xxx agents, 60xxx conversations, 70xxx catalogs.
// Never change or reuse a code once it has shipped; clients may depend on it.
export const ERRORS = {
  // 10xxx: general
  internalError: { code: 10000, statusCode: 500, message: 'Unexpected server error' },
  validationError: { code: 10001, statusCode: 400, message: 'Request validation failed' },
  routeNotFound: { code: 10002, statusCode: 404, message: 'Route not found' },
  invalidRequest: { code: 10003, statusCode: 400, message: 'The request could not be read' },
  payloadTooLarge: { code: 10004, statusCode: 413, message: 'The request body is too large' },
  unsupportedMediaType: {
    code: 10005,
    statusCode: 415,
    message: 'The request content type is not supported'
  },

  // 20xxx: items
  itemNameTaken: { code: 20001, statusCode: 409, message: 'An item with this name already exists' },
  itemNotFound: { code: 20002, statusCode: 404, message: 'Item not found' },

  // 30xxx: people and access
  actorNotFound: {
    code: 30001,
    statusCode: 401,
    message: 'The x-actor-id header does not name a known person'
  },
  forbidden: { code: 30002, statusCode: 403, message: 'You are not allowed to do this' },

  // 40xxx: tasks
  taskNotFound: { code: 40001, statusCode: 404, message: 'Task not found' },
  taskStateConflict: {
    code: 40002,
    statusCode: 409,
    message: 'The task is not in a state that allows this'
  },
  taskCompletionRejected: {
    code: 40003,
    statusCode: 422,
    message: 'The task does not meet what completion needs'
  },
  taskWaitNotFound: { code: 40004, statusCode: 404, message: 'Open task wait not found' },
  approvalNotFound: { code: 40005, statusCode: 404, message: 'Approval not found' },
  approvalAlreadyDecided: {
    code: 40006,
    statusCode: 409,
    message: 'This approval was already decided'
  },

  // 50xxx: agents
  agentNotFound: { code: 50001, statusCode: 404, message: 'Agent not found' },
  agentUnavailable: {
    code: 50002,
    statusCode: 409,
    message: 'The agent is disabled or has no saved configuration'
  },
  agentNameTaken: {
    code: 50003,
    statusCode: 409,
    message: 'An agent with this name already exists'
  },
  agentVersionNotFound: {
    code: 50004,
    statusCode: 404,
    message: "Version not found for this task's agent"
  },

  // 60xxx: conversations
  conversationNotFound: { code: 60001, statusCode: 404, message: 'Conversation not found' },
  notConversationMember: {
    code: 60002,
    statusCode: 403,
    message: 'You are not a member of this conversation'
  },
  mentionNotMember: {
    code: 60003,
    statusCode: 422,
    message: 'A mentioned participant is not a member of this conversation'
  },
  messageNotFound: { code: 60004, statusCode: 404, message: 'Message not found' },
  participantNotFound: { code: 60005, statusCode: 404, message: 'Participant not found' },
  suggestionNotAvailable: {
    code: 60006,
    statusCode: 422,
    message: 'That agent is not in the directory outside this conversation'
  },

  // 70xxx: catalogs (skills, connections, grants)
  skillNotFound: { code: 70001, statusCode: 404, message: 'Skill not found' },
  connectionNotFound: { code: 70002, statusCode: 404, message: 'Connection not found' },
  catalogNameTaken: { code: 70003, statusCode: 409, message: 'This name is already used' },
  catalogEntryUnavailable: {
    code: 70004,
    statusCode: 409,
    message: 'The skill or connection is disabled or has no saved version'
  },
  credentialsKeyMissing: {
    code: 70005,
    statusCode: 409,
    message: 'CREDENTIALS_KEY is not set, so credentials cannot be stored'
  },
  toolAccessDenied: {
    code: 70006,
    statusCode: 403,
    message: 'The agent is not allowed to make this call'
  }
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorName = keyof typeof ERRORS;

// Services throw this with a name from the catalog:
//   throw new AppError('itemNotFound', `Item ${itemId} was not found`);
// The message is optional; it defaults to the one in the catalog.
export class AppError extends Error {
  constructor(name: ErrorName, message: string = ERRORS[name].message) {
    super(message);
    this.name = name;
    this.code = ERRORS[name].code;
    this.statusCode = ERRORS[name].statusCode;
  }

  public override readonly name: ErrorName;
  public readonly code: number;
  public readonly statusCode: number;
}
