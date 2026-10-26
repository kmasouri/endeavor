// Every event type written to a task's history. The runner rebuilds the model transcript from
// these, oldest first, so a name here must never change once it has shipped.
export const TASK_EVENTS = {
  // Lifecycle
  created: 'task.created',
  stateChanged: 'task.state.changed',
  paused: 'task.paused',
  resumed: 'task.resumed',
  restarted: 'task.restarted',
  reviewed: 'task.reviewed',
  versionMigrated: 'task.version.migrated',
  outputAdded: 'task.output.added',
  waitResolved: 'task.wait.resolved',

  // Runner
  modelTurn: 'model.turn',
  modelFailed: 'model.failed',
  toolResults: 'tool.results',
  messageReceived: 'message.received',
  nudge: 'runner.nudge',
  completionChecked: 'completion.checked',
  participantSuggested: 'participant.suggested',
  noteSaved: 'note.saved',
  resultPosted: 'result.posted',

  // Connections and approvals
  connectionCalled: 'connection.called',
  connectionDenied: 'connection.denied',
  connectionDiscoveryFailed: 'connection.discovery.failed',
  mcpCallStarted: 'connection.mcp.started',
  mcpCallResult: 'connection.mcp.result',
  approvalApproved: 'approval.approved',
  approvalRejected: 'approval.rejected',
  approvalExecuted: 'approval.executed'
} as const;
