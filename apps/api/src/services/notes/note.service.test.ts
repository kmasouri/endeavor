import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockNoteRepository,
  mockProjectRepository
} from '../../data/repositories.test-helper';
import { NoteLogger } from '../../observability';
import { AgentNote, Human } from '../../shared/types';
import { NoteService } from './note.service';

const MEMBER = '00000000-0000-4000-8000-000000000002';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const CONV = '00000000-0000-4000-8000-0000000000f1';
const PROJECT = '00000000-0000-4000-8000-0000000000e1';

const member: Human = {
  id: MEMBER,
  name: 'Lee',
  role: 'member',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const note: AgentNote = {
  id: 'n1',
  agentId: AGENT,
  body: 'The gateway was ruled out',
  sourceTaskId: 't1',
  sourceConversationId: CONV,
  projectId: PROJECT,
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
  const projects = mockProjectRepository();
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(human);
  agents.getById.mockResolvedValue({ id: AGENT } as never);
  notes.getById.mockResolvedValue(note);
  notes.update.mockImplementation(async (_id, changes) => ({ ...note, ...changes }));
  const logger = {
    onNoteUpdated: jest.fn(),
    onNoteDeleted: jest.fn()
  } as unknown as jest.Mocked<NoteLogger>;
  const service = new NoteService(notes, agents, conversations, projects, humans, logger);
  return { service, notes, conversations, projects, logger };
}

describe('NoteService', () => {
  it('shows every person all notes, since v1 has one role', async () => {
    const { service, notes, conversations } = setup();
    conversations.list.mockResolvedValue([{ id: CONV } as never]);

    await service.listNotes(MEMBER, AGENT, { limit: 10, offset: 0 });

    expect(notes.list).toHaveBeenCalledWith({
      agentId: AGENT,
      visibility: 'all',
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

  it("lets any person delete notes, even from conversations they aren't in", async () => {
    const { service, notes } = setup();

    await expect(service.deleteNote(MEMBER, AGENT, 'n1')).resolves.toBeUndefined();
    expect(notes.softDelete).toHaveBeenCalled();
  });

  it('lets any person change scope, since v1 has one role', async () => {
    const { service, conversations } = setup();
    conversations.getMember.mockResolvedValue({} as never);

    const outcome = await service
      .updateNote(MEMBER, AGENT, 'n1', { scope: 'agent' })
      .catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({ name: 'forbidden' });
  });

  it('lets an admin make a note agent-wide', async () => {
    const { service, notes } = setup({ ...member, role: 'admin' });

    await service.updateNote(MEMBER, AGENT, 'n1', { scope: 'agent' });

    expect(notes.update).toHaveBeenCalledWith('n1', { scope: 'agent' }, MEMBER);
  });

  it("widens a conversation note to its project's endeavors", async () => {
    const { service, notes } = setup();

    await service.updateNote(MEMBER, AGENT, 'n1', { scope: 'project' });

    expect(notes.update).toHaveBeenCalledWith('n1', { scope: 'project' }, MEMBER);
  });

  it('keeps a note from no project agent-wide', async () => {
    const { service, notes } = setup();
    notes.getById.mockResolvedValue({
      ...note,
      sourceConversationId: null,
      projectId: null,
      scope: 'agent'
    });

    await expect(
      service.updateNote(MEMBER, AGENT, 'n1', { scope: 'project' })
    ).rejects.toMatchObject({ name: 'validationError' });
    expect(notes.update).not.toHaveBeenCalled();
  });
});
