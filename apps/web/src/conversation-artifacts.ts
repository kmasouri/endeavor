import type { Message, Task, TaskOutput } from './api';

export type ConversationOutput = TaskOutput & { taskId: string };

// The runner saves its completed answer as a generic Result and posts the same text to chat.
// That record belongs in run inspection; it is not a second deliverable in the conversation.
export function collectConversationArtifacts(
  outputs: ConversationOutput[],
  messages: Message[],
  tasks: Task[]
): ConversationOutput[] {
  const text = (value: string) => value.replace(/\r\n/g, '\n').trim();
  return outputs.filter((output) => {
    const task = tasks.find((task) => task.id === output.taskId);
    if (task?.reviewRequired && task.state === 'waiting' && task.criteriaCheck && !task.review)
      return true;
    if (
      output.kind !== 'text' ||
      output.title !== 'Result' ||
      output.uri ||
      !output.content?.trim()
    )
      return true;
    return !messages.some(
      (message) =>
        message.authorType === 'agent' &&
        message.taskId === output.taskId &&
        text(message.body) === text(output.content!)
    );
  });
}
