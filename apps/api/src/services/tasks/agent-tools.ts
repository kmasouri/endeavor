import { ModelToolDefinition } from '../../integrations';

// The platform tools every agent gets. Agents act only through these: the runner runs them and
// checks each one. Connections add http_request.
export const AGENT_TOOLS = {
  sendMessage: 'send_message',
  ask: 'ask',
  saveOutput: 'save_output',
  completeTask: 'complete_task',
  reportBlocked: 'report_blocked',
  suggestParticipant: 'suggest_participant',
  httpRequest: 'http_request',
  saveNote: 'save_note',
  listFiles: 'list_files',
  readFile: 'read_file',
  writeFile: 'write_file',
  findCapabilities: 'find_capabilities',
  requestAccess: 'request_access'
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
      'Attach an output or piece of evidence to your task, such as a document, a calculation, a source link, a log, or a file from your workspace. People can inspect it, and the completion check reads it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'The text, unless you give a path.' },
        kind: { type: 'string', enum: ['text', 'link', 'data', 'log'] },
        uri: { type: 'string', description: 'A link, for kind "link".' },
        path: {
          type: 'string',
          description: 'A file in your workspace to attach instead of content, like report.md.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.completeTask,
    description:
      'Finish your task with its result. A separate check reads the result and your outputs against the completion criteria first; if it finds gaps, you get them back to fix. Then the result is saved and posted to whoever asked. Say how it meets each criterion in criteria_check.',
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
    name: AGENT_TOOLS.saveNote,
    description:
      'Save a note for your later work, like "Yesterday\'s check ruled out the payment gateway." Notes are your own memory, not approved facts, and people can read, fix, or delete them. A note saved here is only shown to you in this conversation. Save only what will help later; don\'t copy whole messages.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'The note, in a sentence or two.' } },
      required: ['note'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.listFiles,
    description:
      "List the files in your task's workspace: a private folder for this task only. It starts empty. Paths are relative, like notes/plan.md.",
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'A folder inside the workspace. Leave out for all.' }
      },
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.readFile,
    description:
      'Read a text file from your workspace. Files longer than 100,000 characters are cut off.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path inside the workspace, like notes/plan.md.' }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.writeFile,
    description:
      'Write a text file in your workspace, replacing it if it exists. Folders are made as needed. Use it for drafts, data, and working notes; use save_output for results people should see. At most 1 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path inside the workspace, like notes/plan.md.' },
        content: { type: 'string', description: 'The whole file content.' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.findCapabilities,
    description:
      'List skills and connections that people made discoverable, with what each allows and whether you can use it now. Finding one gives you no access: use request_access to ask a person.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for in names and descriptions.' }
      },
      additionalProperties: false
    }
  },
  {
    name: AGENT_TOOLS.requestAccess,
    description:
      'Ask a person for access to a skill or connection you found with find_capabilities. Say plainly why this task needs it. Your work pauses until they decide. They choose whether access lasts for this task only (the usual choice) or is ongoing. If they decline, continue without it or explain the limitation; do not ask again for the same thing.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['skill', 'connection'] },
        name: { type: 'string', description: 'The name from find_capabilities.' },
        reason: { type: 'string', description: 'Why this task needs it, in a sentence or two.' },
        recommended_duration: {
          type: 'string',
          enum: ['task', 'ongoing'],
          description:
            'Optional. "task" for this task only, or "ongoing" if your future work will need it too.'
        },
        duration_reason: {
          type: 'string',
          description: 'Optional. Why you recommend that duration.'
        }
      },
      required: ['type', 'name', 'reason'],
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

// Offered only to agents with at least one usable connection.
export const HTTP_REQUEST_TOOL: ModelToolDefinition = {
  name: AGENT_TOOLS.httpRequest,
  description:
    'Call an outside API through one of your connections. The platform adds the credentials and checks the method and path. Responses longer than 20,000 characters are cut off.',
  inputSchema: {
    type: 'object',
    properties: {
      connection: { type: 'string', description: 'The connection name.' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      path: {
        type: 'string',
        description: 'Path on the connection, starting with "/". May include a query string.'
      },
      body: { type: 'string', description: 'Request body, usually JSON.' }
    },
    required: ['connection', 'method', 'path'],
    additionalProperties: false
  }
};

// The tools that end the runner's work on a task for now: the task completes, waits, or is
// blocked.
export const STOPPING_TOOLS: ReadonlySet<string> = new Set([
  AGENT_TOOLS.ask,
  AGENT_TOOLS.completeTask,
  AGENT_TOOLS.reportBlocked
]);
