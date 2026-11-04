import { ParticipantRef, Project, ProjectMember } from '../../shared/types';

export interface ProjectRepository {
  create(input: {
    name: string;
    about?: string | null;
    createdByHumanId: string;
  }): Promise<Project>;
  getById(projectId: string): Promise<Project | null>;
  // The project new endeavors go into when none is named.
  getDefault(): Promise<Project | null>;
  // Newest first. visibleToHumanId keeps only projects the person is a member of, or has an
  // endeavor in; null returns every project.
  list(input: {
    visibleToHumanId: string | null;
    archived: boolean;
    limit: number;
    offset: number;
  }): Promise<Project[]>;
  count(input: { visibleToHumanId: string | null; archived: boolean }): Promise<number>;
  // archived: true archives the project, false restores it, undefined leaves it.
  update(
    projectId: string,
    changes: { name?: string; about?: string | null; archived?: boolean }
  ): Promise<Project | null>;

  listMembers(projectId: string): Promise<ProjectMember[]>;
  // Makes the members exactly these participants. Others are marked removed; kept members keep
  // when they were added.
  setMembers(input: {
    projectId: string;
    participants: ParticipantRef[];
    addedByHumanId: string;
  }): Promise<void>;
  // True when the person is a member of the project or of an endeavor in it.
  hasHuman(projectId: string, humanId: string): Promise<boolean>;
}
