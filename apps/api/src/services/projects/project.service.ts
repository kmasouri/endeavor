import {
  AgentRepository,
  DocumentRepository,
  HumanRepository,
  NoteRepository,
  ProjectRepository
} from '../../data';
import { ProjectLogger } from '../../observability';
import { hasFullAccess, requireHuman } from '../access/access.rules';
import { AppError } from '../../shared/errors';
import {
  AgentAppearance,
  AgentNote,
  Human,
  ParticipantRef,
  Project,
  ProjectDocument,
  ProjectMember
} from '../../shared/types';

export interface ProjectMemberDetails extends ProjectMember, AgentAppearance {
  deleted?: boolean;
  name: string;
  // An agent's purpose. null for people.
  purpose: string | null;
}

export interface ProjectDetails extends Project {
  // People and agents added to every new endeavor in the project.
  members: ProjectMemberDetails[];
}

// Projects: long-lived groups of endeavors. A project holds what outlasts one goal: knowledge
// sources, agents' saved notes, and default people and agents. It has no chat feed.
//
// Everyone sees every project while roles are off. With roles on, people see projects they are a
// member of or have an endeavor in.
export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly noteRepository: NoteRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly projectLogger: ProjectLogger
  ) {}

  // The creator becomes a default member, like the creator of an endeavor.
  async createProject(
    actorId: string,
    input: { name: string; about?: string | null; agentIds?: string[]; humanIds?: string[] }
  ): Promise<ProjectDetails> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const participants = await this.requireParticipants([
      { type: 'human', id: human.id },
      ...(input.humanIds ?? []).map((id): ParticipantRef => ({ type: 'human', id })),
      ...(input.agentIds ?? []).map((id): ParticipantRef => ({ type: 'agent', id }))
    ]);
    const project = await this.projectRepository.create({
      name: input.name,
      about: input.about?.trim() || null,
      createdByHumanId: human.id
    });
    await this.projectRepository.setMembers({
      projectId: project.id,
      participants,
      addedByHumanId: human.id
    });
    this.projectLogger.onProjectCreated(project.id, human.id);
    return this.loadDetails(project);
  }

  async listProjects(
    actorId: string,
    input: { archived: boolean; limit: number; offset: number }
  ): Promise<{ projects: Project[]; total: number }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const visibleToHumanId = hasFullAccess(human) ? null : human.id;
    const [projects, total] = await Promise.all([
      this.projectRepository.list({ visibleToHumanId, ...input }),
      this.projectRepository.count({ visibleToHumanId, archived: input.archived })
    ]);
    return { projects, total };
  }

  async getProject(actorId: string, projectId: string): Promise<ProjectDetails> {
    const { project } = await this.requireAccess(actorId, projectId);
    return this.loadDetails(project);
  }

  // agentIds or humanIds replace that kind of member; the other kind is kept. Changes apply to
  // endeavors started afterwards. archived archives or restores the project.
  async updateProject(
    actorId: string,
    projectId: string,
    changes: {
      name?: string;
      about?: string | null;
      agentIds?: string[];
      humanIds?: string[];
      archived?: boolean;
    }
  ): Promise<ProjectDetails> {
    const { project, human } = await this.requireAccess(actorId, projectId);
    if (changes.archived && project.isDefault) {
      throw new AppError('defaultProjectArchive');
    }

    if (changes.agentIds !== undefined || changes.humanIds !== undefined) {
      const current = await this.projectRepository.listMembers(project.id);
      const keep = (type: ParticipantRef['type'], ids: string[] | undefined): ParticipantRef[] =>
        ids === undefined
          ? current
              .map((member) => member.participant)
              .filter((participant) => participant.type === type)
          : ids.map((id) => ({ type, id }));
      const participants = await this.requireParticipants(
        [...keep('human', changes.humanIds), ...keep('agent', changes.agentIds)],
        current.map((member) => member.participant)
      );
      await this.projectRepository.setMembers({
        projectId: project.id,
        participants,
        addedByHumanId: human.id
      });
    }

    const updated =
      changes.name !== undefined || changes.about !== undefined || changes.archived !== undefined
        ? await this.projectRepository.update(project.id, {
            name: changes.name,
            about: changes.about === undefined ? undefined : changes.about?.trim() || null,
            archived: changes.archived
          })
        : project;
    if (changes.archived !== undefined && changes.archived !== (project.archivedAt !== null)) {
      if (changes.archived) {
        this.projectLogger.onProjectArchived(project.id, human.id);
      } else {
        this.projectLogger.onProjectRestored(project.id, human.id);
      }
    }
    this.projectLogger.onProjectUpdated(project.id, human.id);
    return this.loadDetails(updated ?? project);
  }

  // Knowledge sources shared by every endeavor in the project. Agents read them but can't change
  // them, and they are never mixed up with saved notes.

  async addDocument(
    actorId: string,
    projectId: string,
    input: { title: string; content: string }
  ): Promise<ProjectDocument> {
    const { project, human } = await this.requireAccess(actorId, projectId);
    const document = await this.documentRepository.add({
      projectId: project.id,
      conversationId: null,
      title: input.title,
      content: input.content,
      addedByHumanId: human.id
    });
    this.projectLogger.onDocumentAdded(document.id, project.id);
    return document;
  }

  async listDocuments(actorId: string, projectId: string): Promise<ProjectDocument[]> {
    const { project } = await this.requireAccess(actorId, projectId);
    return this.documentRepository.list({ projectId: project.id });
  }

  async deleteDocument(actorId: string, projectId: string, documentId: string): Promise<void> {
    const { project } = await this.requireAccess(actorId, projectId);
    const document = await this.documentRepository.get(documentId);
    if (!document || document.projectId !== project.id) {
      throw new AppError('documentNotFound', `Document ${documentId} was not found`);
    }
    await this.documentRepository.delete(document.id);
  }

  // Notes agents saved for the whole project. People fix or delete them through the agent's
  // notes (PATCH and DELETE /agents/:agentId/notes/:noteId).
  async listNotes(
    actorId: string,
    projectId: string,
    input: { limit: number; offset: number }
  ): Promise<{ notes: AgentNote[]; total: number }> {
    const { project } = await this.requireAccess(actorId, projectId);
    const [notes, total] = await Promise.all([
      this.noteRepository.listForProject({ projectId: project.id, ...input }),
      this.noteRepository.countForProject(project.id)
    ]);
    return { notes, total };
  }

  // A project the person can't see reads as not found, so its existence isn't revealed.
  private async requireAccess(
    actorId: string,
    projectId: string
  ): Promise<{ project: Project; human: Human }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const project = await this.projectRepository.getById(projectId);
    if (
      !project ||
      (!hasFullAccess(human) && !(await this.projectRepository.hasHuman(project.id, human.id)))
    ) {
      throw new AppError('projectNotFound', `Project ${projectId} was not found`);
    }
    return { project, human };
  }

  // New members must exist, and agents must be able to join endeavors. Members the project
  // already has are kept as they are, even if an agent was disabled since. Duplicates are dropped.
  private async requireParticipants(
    participants: ParticipantRef[],
    existing: ParticipantRef[] = []
  ): Promise<ParticipantRef[]> {
    const unique = new Map(participants.map((p) => [`${p.type}:${p.id}`, p]));
    const known = new Set(existing.map((p) => `${p.type}:${p.id}`));
    for (const [key, participant] of unique) {
      if (known.has(key)) {
        continue;
      }
      if (participant.type === 'human') {
        if (!(await this.humanRepository.getById(participant.id))) {
          throw new AppError('participantNotFound', `Person ${participant.id} was not found`);
        }
        continue;
      }
      const agent = await this.agentRepository.getById(participant.id);
      if (!agent || agent.deletedAt) {
        throw new AppError('participantNotFound', `Agent ${participant.id} was not found`);
      }
      if (agent.disabledAt || !agent.currentVersionId) {
        throw new AppError('agentUnavailable', `Agent ${agent.name} can't join endeavors now`);
      }
    }
    return [...unique.values()];
  }

  private async loadDetails(project: Project): Promise<ProjectDetails> {
    const members = await this.projectRepository.listMembers(project.id);
    const details = await Promise.all(
      members.map(async (member): Promise<ProjectMemberDetails> => {
        if (member.participant.type === 'agent') {
          const agent = await this.agentRepository.getById(member.participant.id);
          return {
            ...member,
            name: agent?.name ?? 'Unknown agent',
            deleted: Boolean(agent?.deletedAt),
            purpose: agent?.purpose ?? null,
            avatarColor: agent?.avatarColor ?? null,
            avatarIcon: agent?.avatarIcon ?? null
          };
        }
        const human = await this.humanRepository.getById(member.participant.id);
        return { ...member, name: human?.name ?? 'Unknown person', purpose: null };
      })
    );
    return { ...project, members: details };
  }
}
