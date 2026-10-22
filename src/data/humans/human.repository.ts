import { Human, HumanRole } from '../../shared/types';

export interface CreateHumanInput {
  name: string;
  role: HumanRole;
}

export interface HumanRepository {
  create(input: CreateHumanInput): Promise<Human>;
  // Creates the very first person. Returns null if someone already took that spot, so two
  // setups at the same time can't both succeed.
  createFirst(input: CreateHumanInput): Promise<Human | null>;
  getById(humanId: string): Promise<Human | null>;
  list(): Promise<Human[]>;
  count(): Promise<number>;
}
