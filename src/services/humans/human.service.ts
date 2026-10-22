import { HumanRepository } from '../../data';
import { HumanLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman } from '../../shared/access';
import { Human, HumanRole } from '../../shared/types';

export class HumanService {
  constructor(
    private readonly humanRepository: HumanRepository,
    private readonly humanLogger: HumanLogger
  ) {}

  // The first person added becomes an admin, with no acting person needed, so a new install
  // can be set up. After that, only admins add people.
  async createHuman(
    actorId: string | undefined,
    input: { name: string; role: HumanRole }
  ): Promise<Human> {
    const isFirst = (await this.humanRepository.count()) === 0;
    if (!isFirst) {
      requireHuman(actorId ? await this.humanRepository.getById(actorId) : null, ADMIN_ONLY);
    }

    const human = await this.humanRepository.create({
      name: input.name,
      role: isFirst ? 'admin' : input.role
    });
    this.humanLogger.onHumanCreated(human.id, human.role);
    return human;
  }

  async listHumans(): Promise<Human[]> {
    return this.humanRepository.list();
  }
}
