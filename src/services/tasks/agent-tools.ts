import { ModelToolDefinition } from '../../integrations';

// The platform tools every agent gets. Agents act only through these: the runner runs them and
// checks each one. Skills and connections will add more tools (CA-1).
export const AGENT_TOOLS = {
  sendMessage: 'send_message',
  ask: 'ask',
  saveOutput: 'save_output',
  completeTask: 'complete_task',
  reportBlocked: 'report_blocked',
  suggestParticipant: 'suggest_participant'
} as const;

export type AgentToolName = (typeof AGENT_TOOLS)[keyof typeof AGENT_TOOLS];

const participantList = {
  type: 'array',
  items: { type: 'string' },
  description: 'Names of conversation participants to address. Only these get notified.'
};

export const AGENT_TOOL_DEFINITIONS: ModelToolDefinition[] = [
  {
    name: AGENT_TOOLS.sendMessage,
    description:
      'Post a message in the conversation. Use it for updates or to share findings. Addressed participants are notified; others can still read it. It does not wait for an answer: use ask for that.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'The message text.' },
        to: participantList,
        reply_to_message_id: {
          type: 'string',
          description: 'ID of the message this answers, if any.'
        }
      },
      required: ['body'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.ask,
    description:
      'Ask one participant a question and wait for their reply. Your work pauses until they answer; their reply arrives as a new message. Use it to get help or clarification from a person or another agent.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Name of the participant to ask.' },
        question: { type: 'string', description: 'The question, with the context they need.' }
      },
      required: ['to', 'question'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.saveOutput,
    description:
      'Attach an output or piece of evidence to your task, such as a document, a calculation, a source link, or a log.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        kind: { type: 'string', enum: ['text', 'link', 'data', 'log'] },
        uri: { type: 'string', description: 'A link, for kind "link".' }
      },
      required: ['title', 'content'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.completeTask,
    description:
      'Finish your task with its result. The result is saved as an output and posted as your answer to whoever asked. Only call this when the result meets the completion criteria; say how in criteria_check.',
    inputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'Your answer or result.' },
        criteria_check: {
          type: 'string',
          description: 'How the result meets each completion criterion, or what is missing.'
        },
        criteria_met: { type: 'boolean' }
      },
      required: ['result', 'criteria_check', 'criteria_met'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.reportBlocked,
    description:
      "Stop because you can't go on without a person: you need a decision, access, or information nobody here can give. Say exactly what you need. A person will resume the task.",
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'What you need and from whom.' }
      },
      required: ['reason'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.suggestParticipant,
    description:
      'Suggest that a person add an agent from the directory to this conversation. It only posts the suggestion to the people here; it does not add anyone or contact the agent.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The agent name, from the directory.' },
        reason: { type: 'string', description: 'Why they would help.' }
      },
      required: ['name', 'reason'],
      additionalProperties: false
    }
  }
];

// The tools that end the runner's work on a task for now: the task completes, waits, or is
// blocked.
export const STOPPING_TOOLS: ReadonlySet<string> = new Set([
  AGENT_TOOLS.ask,
  AGENT_TOOLS.completeTask,
  AGENT_TOOLS.reportBlocked
]);
