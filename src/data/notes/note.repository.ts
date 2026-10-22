import { Actor, AgentNote, NoteScope } from '../../shared/types';

// Which notes a list returns: every note ('all'), the notes a task in this conversation may see
// ({ conversationId }), or the notes this person may see ({ visibleToHumanId }). Agent-wide
// notes are included in all three.
export type NoteVisibility =
  'all' | { conversationId: string | null } | { visibleToHumanId: string };

export interface NoteRepository {
  // Saving again with the same clientKey returns the first note instead of a copy.
  create(input: {
    agentId: string;
    body: string;
    sourceTaskId: string | null;
    sourceConversationId: string | null;
    scope: NoteScope;
    createdBy: Actor;
    clientKey: string | null;
  }): Promise<AgentNote>;
  getById(noteId: string): Promise<AgentNote | null>;
  // Notes that aren't deleted, newest first.
  list(input: {
    agentId: string;
    visibility: NoteVisibility;
    limit: number;
    offset: number;
  }): Promise<AgentNote[]>;
  count(input: { agentId: string; visibility: NoteVisibility }): Promise<number>;
  update(
    noteId: string,
    changes: { body?: string; scope?: NoteScope },
    humanId: string
  ): Promise<AgentNote | null>;
  softDelete(noteId: string, humanId: string): Promise<boolean>;
}
