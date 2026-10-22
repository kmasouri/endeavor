import { HumanRepository } from '../../data';
import { HumanLogger } from '../../observability';
import { Human } from '../../shared/types';
import { HumanService } from './human.service';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

function setup() {
  const humans: jest.Mocked<HumanRepository> = {
    create: jest.fn(async (input) => ({ id: 'new', createdAt: new Date(), ...input })),
    getById: jest.fn(),
    list: jest.fn(),
    count: jest.fn()
  };
  const logger = { onHumanCreated: jest.fn() } as unknown as jest.Mocked<HumanLogger>;
  return { service: new HumanService(humans, logger), humans, logger };
}

const person = (role: Human['role']): Human => ({
  id: ADMIN_ID,
  name: 'Kim',
  role,
  createdAt: new Date()
});

describe('HumanService', () => {
  it('makes the first person an admin, with no acting person', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(0);

    const human = await service.createHuman(undefined, { name: 'Kim', role: 'member' });

    expect(human.role).toBe('admin');
  });

  it('lets an admin add people after that', async () => {
    const { service, humans, logger } = setup();
    humans.count.mockResolvedValue(1);
    humans.getById.mockResolvedValue(person('admin'));

    const human = await service.createHuman(ADMIN_ID, { name: 'Lee', role: 'member' });

    expect(human.role).toBe('member');
    expect(logger.onHumanCreated).toHaveBeenCalledWith('new', 'member');
  });

  it('does not let a member add people', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(1);
    humans.getById.mockResolvedValue(person('member'));

    await expect(
      service.createHuman(ADMIN_ID, { name: 'Lee', role: 'admin' })
    ).rejects.toMatchObject({ name: 'forbidden' });
  });

  it('needs an acting person once someone exists', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(1);

    await expect(
      service.createHuman(undefined, { name: 'Lee', role: 'member' })
    ).rejects.toMatchObject({ name: 'actorNotFound' });
  });
});
