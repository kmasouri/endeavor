import { Skill, SkillVersion } from '../../shared/types';

export interface CreateSkillVersionInput {
  instructions: string;
  createdByHumanId: string | null;
}

export interface SkillRepository {
  // Saves the skill and its version 1 in one statement.
  createSkill(
    input: { name: string; description: string; discoverable?: boolean },
    firstVersion: CreateSkillVersionInput
  ): Promise<{ skill: Skill; version: SkillVersion }>;
  getSkill(skillId: string): Promise<Skill | null>;
  getSkills(skillIds: string[]): Promise<Skill[]>;
  listSkills(input: { limit: number; offset: number }): Promise<Skill[]>;
  countSkills(): Promise<number>;
  // Saves the next version and makes it current.
  addSkillVersion(skillId: string, input: CreateSkillVersionInput): Promise<SkillVersion>;
  getSkillVersions(versionIds: string[]): Promise<SkillVersion[]>;
  listSkillVersions(skillId: string): Promise<SkillVersion[]>;
  setSkillDisabled(skillId: string, disabled: boolean): Promise<Skill | null>;
  setSkillDiscoverable(skillId: string, discoverable: boolean): Promise<Skill | null>;
}
