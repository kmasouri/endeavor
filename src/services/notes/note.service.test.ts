import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockNoteRepository
} from '../../data/repositories.test-helper';
import { NoteLogger } from '../../observability';
import { AgentNote, Human } from '../../shared/types';
import { NoteService } from './note.service';

const MEMBER = '00000000-0000-4000-8000-000000000002';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const CONV = '00000000-0000-4000-8000-0000000000f1';

const member: Human = { id: MEMBER, name: 'Lee', role: 'member', createdAt: new Date() };
const note: AgentNote = {
  id: 'n1',
  agentId: AGENT,
  body: 'The gateway was ruled out',
  sourceTaskId: 't1',
  sourceConversationId: CONV,
  scope: 'conversation',
  createdBy: { type: 'agent', id: AGENT },
  updatedByHumanId: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function setup(human: Human = member) {
  const notes = mockNoteRepository();
  const agents = mockAgentRepository();
  const conversations = mockConversationRepository();
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(human);
  agents.getById.mockResolvedValue({ id: AGENT } as never);
  notes.getById.mockResolvedValue(note);
  notes.update.mockImplementation(async (_id, changes) => ({ ...note, ...changes }));
  const logger = {
    onNoteUpdated: jest.fn(),
    onNoteDeleted: jest.fn()
  } as unknown as jest.Mocked<NoteLogger>;
  const service = new NoteService(notes, agents, conversations, humans, logger);
  return { service, notes, conversations, logger };
}

describe('NoteService', () => {
  it('shows a member only notes from their conversations (plus agent-wide ones)', async () => {
    const { service, notes, conversations } = setup();
    conversations.list.mockResolvedValue([{ id: CONV } as never]);

    await service.listNotes(MEMBER, AGENT, { limit: 10, offset: 0 });

    expect(notes.list).toHaveBeenCalledWith({
      agentId: AGENT,
      visibility: { visibleToHumanId: MEMBER },
      limit: 10,
      offset: 0
    });
  });

  it('shows admins every note', async () => {
    const { service, notes } = setup({ ...member, role: 'admin' });

    await service.listNotes(MEMBER, AGENT, { limit: 10, offset: 0 });

    expect(notes.list).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'all' }));
  });

  it('lets a member of the source conversation correct a note', async () => {
    const { service, notes, conversations, logger } = setup();
    conversations.getMember.mockResolvedValue({} as never);

    const updated = await service.updateNote(MEMBER, AGENT, 'n1', {
      body: 'The gateway was NOT ruled out'
    });

    expect(updated.body).toBe('The gateway was NOT ruled out');
    expect(notes.update).toHaveBeenCalledWith(
      'n1',
      { body: 'The gateway was NOT ruled out' },
      MEMBER
    );
    expect(logger.onNoteUpdated).toHaveBeenCalled();
  });

  it("hides notes from conversations the member isn't in", async () => {
    const { service, notes } = setup();

    await expect(service.deleteNote(MEMBER, AGENT, 'n1')).rejects.toMatchObject({
      name: 'noteNotFound'
    });
    expect(notes.softDelete).not.toHaveBeenCalled();
  });

  it('only lets admins change scope', async () => {
    const { service, conversations } = setup();
    conversations.getMember.mockResolvedValue({} as never);

    await expect(service.updateNote(MEMBER, AGENT, 'n1', { scope: 'agent' })).rejects.toMatchObject(
      {
        name: 'forbidden'
      }
    );
  });

  it('lets an admin make a note agent-wide', async () => {
    const { service, notes } = setup({ ...member, role: 'admin' });

    await service.updateNote(MEMBER, AGENT, 'n1', { scope: 'agent' });

    expect(notes.update).toHaveBeenCalledWith('n1', { scope: 'agent' }, MEMBER);
  });
});
