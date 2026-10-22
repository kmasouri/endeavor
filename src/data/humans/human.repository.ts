import { Human, HumanRole } from '../../shared/types';

export interface CreateHumanInput {
  name: string;
  role: HumanRole;
}

export interface HumanRepository {
  create(input: CreateHumanInput): Promise<Human>;
  getById(humanId: string): Promise<Human | null>;
  list(): Promise<Human[]>;
  count(): Promise<number>;
}
