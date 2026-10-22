import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  NoteRepository
} from '../../data';
import { NoteLogger } from '../../observability';
import { requireHuman } from '../../shared/access';
import { AppError } from '../../shared/errors';
import { AgentNote, Human, NoteScope } from '../../shared/types';

// Saved notes (agent memory): what agents wrote down for later work. People inspect, correct,
// and delete them here. Notes are an agent's observations, not approved shared facts.
//
// Admins see and change every note. Members see and fix notes from conversations they belong
// to, and can read notes an admin made agent-wide. Only admins change a note's scope.
export class NoteService {
  constructor(
    private readonly noteRepository: NoteRepository,
    private readonly agentRepository: AgentRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly humanRepository: HumanRepository,
    private readonly noteLogger: NoteLogger
  ) {}

  async listNotes(
    actorId: string,
    agentId: string,
    input: { limit: number; offset: number }
  ): Promise<AgentNote[]> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    if (!(await this.agentRepository.getById(agentId))) {
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    }
    return this.noteRepository.list({
      agentId,
      conversationIds: human.role === 'admin' ? 'all' : await this.memberConversationIds(human),
      ...input
    });
  }

  async updateNote(
    actorId: string,
    noteId: string,
    changes: { body?: string; scope?: NoteScope }
  ): Promise<AgentNote> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const note = await this.requireEditableNote(human, noteId);
    if (changes.scope !== undefined && changes.scope !== note.scope && human.role !== 'admin') {
      throw new AppError('forbidden', "Only admins change a note's scope");
    }

    const updated = await this.noteRepository.update(note.id, changes, human.id);
    this.noteLogger.onNoteUpdated(note.id, note.agentId, human.id);
    return updated ?? note;
  }

  async deleteNote(actorId: string, noteId: string): Promise<void> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const note = await this.requireEditableNote(human, noteId);
    if (await this.noteRepository.softDelete(note.id, human.id)) {
      this.noteLogger.onNoteDeleted(note.id, note.agentId, human.id);
    }
  }

  // A note the person may not edit reads as not found, so its existence isn't revealed.
  private async requireEditableNote(human: Human, noteId: string): Promise<AgentNote> {
    const note = await this.noteRepository.getById(noteId);
    const editable =
      note &&
      (human.role === 'admin' ||
        (note.scope === 'conversation' &&
          note.sourceConversationId !== null &&
          (await this.conversationRepository.getMember(note.sourceConversationId, {
            type: 'human',
            id: human.id
          })) !== null));
    if (!note || !editable) {
      throw new AppError('noteNotFound', `Note ${noteId} was not found`);
    }
    return note;
  }

  private async memberConversationIds(human: Human): Promise<string[]> {
    const conversations = await this.conversationRepository.list({
      participant: { type: 'human', id: human.id },
      limit: 1000,
      offset: 0
    });
    return conversations.map((conversation) => conversation.id);
  }
}
