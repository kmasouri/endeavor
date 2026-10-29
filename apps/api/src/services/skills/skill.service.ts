import { CatalogNameConflictError, HumanRepository, SkillRepository } from '../../data';
import { SkillLogger } from '../../observability';
import { Skill, SkillVersion } from '../../shared/types';
import { ADMIN_ONLY, requireHuman } from '../access/access.rules';
import { AppError } from '../../shared/errors';

export interface SkillDetails extends Skill {
  currentVersion: SkillVersion | null;
}

// Skills supply reusable instructions. They never select connections or grant access.
export class SkillService {
  constructor(
    private readonly skillRepository: SkillRepository,
    private readonly humanRepository: HumanRepository,
    private readonly skillLogger: SkillLogger
  ) {}

  async createSkill(
    actorId: string,
    input: { name: string; description: string; instructions: string; discoverable?: boolean }
  ): Promise<SkillDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const { skill, version } = await this.skillRepository
      .createSkill(
        { name: input.name, description: input.description, discoverable: input.discoverable },
        {
          instructions: input.instructions,
          createdByHumanId: admin.id
        }
      )
      .catch(toNameTaken);
    this.skillLogger.onSkillSaved(skill.id, version.version);
    return { ...skill, currentVersion: version };
  }

  async listSkills(input: {
    limit: number;
    offset: number;
  }): Promise<{ skills: SkillDetails[]; total: number }> {
    const [skills, total] = await Promise.all([
      this.skillRepository.listSkills(input),
      this.skillRepository.countSkills()
    ]);
    const versions = new Map(
      (
        await this.skillRepository.getSkillVersions(
          skills.flatMap((skill) => skill.currentVersionId ?? [])
        )
      ).map((version) => [version.id, version])
    );
    return {
      skills: skills.map((skill) => ({
        ...skill,
        currentVersion: versions.get(skill.currentVersionId ?? '') ?? null
      })),
      total
    };
  }

  async getSkill(skillId: string): Promise<SkillDetails> {
    const skill = await this.requireSkill(skillId);
    const [currentVersion] = await this.skillRepository.getSkillVersions(
      skill.currentVersionId ? [skill.currentVersionId] : []
    );
    return { ...skill, currentVersion: currentVersion ?? null };
  }

  async listSkillVersions(skillId: string): Promise<SkillVersion[]> {
    await this.requireSkill(skillId);
    return this.skillRepository.listSkillVersions(skillId);
  }

  // A new version is used by agent configurations saved after it. Configurations already saved
  // keep the version they pinned.
  async addSkillVersion(
    actorId: string,
    skillId: string,
    changes: { instructions?: string }
  ): Promise<SkillDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const skill = await this.getSkill(skillId);
    const instructions = changes.instructions ?? skill.currentVersion?.instructions;
    if (instructions === undefined) {
      throw new AppError(
        'validationError',
        'This skill has no version yet, so instructions are needed'
      );
    }

    const version = await this.skillRepository.addSkillVersion(skill.id, {
      instructions,
      createdByHumanId: admin.id
    });
    this.skillLogger.onSkillSaved(skill.id, version.version);
    return { ...skill, currentVersionId: version.id, currentVersion: version };
  }

  async setSkillDisabled(
    actorId: string,
    skillId: string,
    disabled: boolean
  ): Promise<SkillDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireSkill(skillId);
    await this.skillRepository.setSkillDisabled(skillId, disabled);
    return this.getSkill(skillId);
  }

  // Discovery lets agents find the skill and ask for access. It grants nothing.
  async updateSkill(
    actorId: string,
    skillId: string,
    changes: { discoverable: boolean }
  ): Promise<SkillDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireSkill(skillId);
    await this.skillRepository.setSkillDiscoverable(skillId, changes.discoverable);
    this.skillLogger.onSkillDiscoveryChanged(skillId, changes.discoverable);
    return this.getSkill(skillId);
  }

  private async requireSkill(skillId: string): Promise<Skill> {
    const skill = await this.skillRepository.getSkill(skillId);
    if (!skill) {
      throw new AppError('skillNotFound', `Skill ${skillId} was not found`);
    }
    return skill;
  }
}

function toNameTaken(error: unknown): never {
  if (error instanceof CatalogNameConflictError) {
    throw new AppError('catalogNameTaken', error.message);
  }
  throw error;
}
