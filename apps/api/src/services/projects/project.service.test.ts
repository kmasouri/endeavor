import {
  mockAgentRepository,
  mockDocumentRepository,
  mockHumanRepository,
  mockNoteRepository,
  mockProjectRepository
} from '../../data/repositories.test-helper';
import { ProjectLogger } from '../../observability';
import { Agent, Human, Project, ProjectMember } from '../../shared/types';
import { ProjectService } from './project.service';

const KIM = '00000000-0000-4000-8000-000000000001';
const LEE = '00000000-0000-4000-8000-000000000002';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const DISABLED = '00000000-0000-4000-8000-0000000000a2';
const PROJECT = '00000000-0000-4000-8000-0000000000e1';

const kim: Human = {
  id: KIM,
  name: 'Kim',
  role: 'member',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const agent: Agent = {
  id: AGENT,
  name: 'Researcher',
  purpose: 'Research',
  currentVersionId: 'v1',
  disabledAt: null,
  monthlyBudgetUsd: null,
  createdAt: new Date(),
  updatedAt: new Date()
};
const project: Project = {
  id: PROJECT,
  name: 'Billing',
  about: null,
  isDefault: false,
  createdByHumanId: KIM,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null
};

function member(type: 'human' | 'agent', id: string): ProjectMember {
  return {
    projectId: PROJECT,
    participant: { type, id },
    addedByHumanId: KIM,
    addedAt: new Date()
  };
}

function setup() {
  const projects = mockProjectRepository();
  const documents = mockDocumentRepository();
  const notes = mockNoteRepository();
  const agents = mockAgentRepository();
  const humans = mockHumanRepository();
  humans.getById.mockImplementation(async (id) =>
    id === KIM ? kim : id === LEE ? { ...kim, id: LEE, name: 'Lee' } : null
  );
  agents.getById.mockImplementation(async (id) =>
    id === AGENT ? agent : id === DISABLED ? { ...agent, id, disabledAt: new Date() } : null
  );
  projects.create.mockResolvedValue(project);
  projects.getById.mockImplementation(async (id) => (id === PROJECT ? project : null));
  projects.update.mockImplementation(async (_id, changes) => ({
    ...project,
    ...(changes.name !== undefined && { name: changes.name }),
    ...(changes.about !== undefined && { about: changes.about }),
    archivedAt: changes.archived ? new Date() : null
  }));
  const logger = {
    onProjectCreated: jest.fn(),
    onProjectUpdated: jest.fn(),
    onProjectArchived: jest.fn(),
    onProjectRestored: jest.fn(),
    onDocumentAdded: jest.fn()
  } as unknown as jest.Mocked<ProjectLogger>;
  const service = new ProjectService(projects, documents, notes, agents, humans, logger);
  return { service, projects, documents, notes, agents, logger };
}

describe('ProjectService', () => {
  it('creates a project with the creator and chosen members as defaults', async () => {
    const { service, projects, logger } = setup();

    await service.createProject(KIM, {
      name: 'Billing',
      agentIds: [AGENT, AGENT],
      humanIds: [KIM]
    });

    expect(projects.create).toHaveBeenCalledWith({
      name: 'Billing',
      about: null,
      createdByHumanId: KIM
    });
    expect(projects.setMembers).toHaveBeenCalledWith({
      projectId: PROJECT,
      participants: [
        { type: 'human', id: KIM },
        { type: 'agent', id: AGENT }
      ],
      addedByHumanId: KIM
    });
    expect(logger.onProjectCreated).toHaveBeenCalledWith(PROJECT, KIM);
  });

  it('stores About separately from documents and notes on creation', async () => {
    const { service, projects, documents, notes } = setup();
    await service.createProject(KIM, { name: 'Billing', about: '  Team background  ' });
    expect(projects.create).toHaveBeenCalledWith({
      name: 'Billing',
      about: 'Team background',
      createdByHumanId: KIM
    });
    expect(documents.add).not.toHaveBeenCalled();
    expect(notes.create).not.toHaveBeenCalled();
  });

  it.each([
    ['  Updated background  ', 'Updated background'],
    ['', null],
    ['  ', null],
    [null, null]
  ])('updates or clears About: %p', async (about, expected) => {
    const { service, projects } = setup();
    const result = await service.updateProject(KIM, PROJECT, { about });
    expect(projects.update).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ about: expected })
    );
    expect(result.about).toBe(expected);
  });

  it('preserves About when only renaming a project', async () => {
    const { service, projects } = setup();
    await service.updateProject(KIM, PROJECT, { name: 'Renamed' });
    expect(projects.update).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ about: undefined })
    );
  });

  it("refuses an agent that can't join before creating anything", async () => {
    const { service, projects } = setup();

    await expect(
      service.createProject(KIM, { name: 'Billing', agentIds: [DISABLED] })
    ).rejects.toMatchObject({ name: 'agentUnavailable' });
    expect(projects.create).not.toHaveBeenCalled();
  });

  it('replaces only the kind of member that was sent', async () => {
    const { service, projects } = setup();
    projects.listMembers.mockResolvedValue([member('human', KIM), member('agent', DISABLED)]);

    await service.updateProject(KIM, PROJECT, { agentIds: [AGENT] });

    expect(projects.setMembers).toHaveBeenCalledWith({
      projectId: PROJECT,
      participants: [
        { type: 'human', id: KIM },
        { type: 'agent', id: AGENT }
      ],
      addedByHumanId: KIM
    });
  });

  it('keeps an existing member even if it was disabled since', async () => {
    const { service, projects } = setup();
    projects.listMembers.mockResolvedValue([member('agent', DISABLED)]);

    await service.updateProject(KIM, PROJECT, { humanIds: [LEE] });

    expect(projects.setMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: [
          { type: 'human', id: LEE },
          { type: 'agent', id: DISABLED }
        ]
      })
    );
  });

  it('archives and restores a project', async () => {
    const { service, projects, logger } = setup();

    const archived = await service.updateProject(KIM, PROJECT, { archived: true });
    expect(archived.archivedAt).not.toBeNull();
    expect(projects.update).toHaveBeenCalledWith(PROJECT, { name: undefined, archived: true });
    expect(logger.onProjectArchived).toHaveBeenCalledWith(PROJECT, KIM);

    projects.getById.mockResolvedValue({ ...project, archivedAt: new Date() });
    await service.updateProject(KIM, PROJECT, { archived: false });
    expect(logger.onProjectRestored).toHaveBeenCalledWith(PROJECT, KIM);
  });

  it("won't archive the default project", async () => {
    const { service, projects } = setup();
    projects.getById.mockResolvedValue({ ...project, isDefault: true });

    await expect(service.updateProject(KIM, PROJECT, { archived: true })).rejects.toMatchObject({
      name: 'defaultProjectArchive'
    });
    expect(projects.update).not.toHaveBeenCalled();
  });

  it('lists active projects for everyone while roles are off', async () => {
    const { service, projects } = setup();
    projects.list.mockResolvedValue([project]);
    projects.count.mockResolvedValue(1);

    const result = await service.listProjects(KIM, { archived: false, limit: 10, offset: 0 });

    expect(projects.list).toHaveBeenCalledWith({
      visibleToHumanId: null,
      archived: false,
      limit: 10,
      offset: 0
    });
    expect(result).toEqual({ projects: [project], total: 1 });
  });

  it('reads an unknown project as not found', async () => {
    const { service } = setup();

    await expect(service.getProject(KIM, AGENT)).rejects.toMatchObject({
      name: 'projectNotFound'
    });
  });

  it('returns members with their names and purposes', async () => {
    const { service, projects } = setup();
    projects.listMembers.mockResolvedValue([member('human', KIM), member('agent', AGENT)]);

    const details = await service.getProject(KIM, PROJECT);

    expect(details.members.map((m) => [m.name, m.purpose])).toEqual([
      ['Kim', null],
      ['Researcher', 'Research']
    ]);
  });

  it('shares documents with every endeavor in the project', async () => {
    const { service, documents, logger } = setup();
    documents.add.mockResolvedValue({ id: 'd1' } as never);

    await service.addDocument(KIM, PROJECT, { title: 'Policy', content: 'Text' });
    await service.listDocuments(KIM, PROJECT);

    expect(documents.add).toHaveBeenCalledWith({
      projectId: PROJECT,
      conversationId: null,
      title: 'Policy',
      content: 'Text',
      addedByHumanId: KIM
    });
    expect(documents.list).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(logger.onDocumentAdded).toHaveBeenCalledWith('d1', PROJECT);
  });

  it("won't delete another project's document", async () => {
    const { service, documents } = setup();
    documents.get.mockResolvedValue({ id: 'd1', projectId: 'elsewhere' } as never);

    await expect(service.deleteDocument(KIM, PROJECT, 'd1')).rejects.toMatchObject({
      name: 'documentNotFound'
    });
    expect(documents.delete).not.toHaveBeenCalled();
  });

  it('lists the notes agents saved for the project', async () => {
    const { service, notes } = setup();
    notes.countForProject.mockResolvedValue(0);

    const result = await service.listNotes(KIM, PROJECT, { limit: 10, offset: 0 });

    expect(notes.listForProject).toHaveBeenCalledWith({ projectId: PROJECT, limit: 10, offset: 0 });
    expect(result).toEqual({ notes: [], total: 0 });
  });
});
