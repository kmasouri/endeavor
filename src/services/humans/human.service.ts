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
    if ((await this.humanRepository.count()) === 0) {
      const first = await this.humanRepository.createFirst({ name: input.name, role: 'admin' });
      if (first) {
        this.humanLogger.onHumanCreated(first.id, first.role);
        return first;
      }
      // Someone else became the first person a moment ago. Continue as a normal add.
    }

    requireHuman(actorId ? await this.humanRepository.getById(actorId) : null, ADMIN_ONLY);
    const human = await this.humanRepository.create(input);
    this.humanLogger.onHumanCreated(human.id, human.role);
    return human;
  }

  async listHumans(actorId: string): Promise<Human[]> {
    requireHuman(await this.humanRepository.getById(actorId));
    return this.humanRepository.list();
  }
}
