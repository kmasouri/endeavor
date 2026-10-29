import { Connection, Skill } from '../../shared/types';
import type { SkillRepository, ConnectionRepository, GrantRepository } from '..';

// Thrown when a create or rename would give two skills, or two connections, the same name.
export class CatalogNameConflictError extends Error {
  constructor(name: string) {
    super(`The name ${name} is already used`);
    this.name = 'CatalogNameConflictError';
  }
}

// Cross-catalog access used by agent configuration and task execution.
// Management services receive only their feature's repository interface.
export interface CatalogRepository extends SkillRepository, ConnectionRepository, GrantRepository {
  // Enabled skills and connections a person marked discoverable, by name.
  listDiscoverable(limit: number): Promise<{ skills: Skill[]; connections: Connection[] }>;
}
