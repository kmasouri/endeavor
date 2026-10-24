import { HumanRepository } from '../../data';
import { HumanLogger } from '../../observability';
import { Human } from '../../shared/types';
import { HumanService } from './human.service';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

function setup() {
  const humans: jest.Mocked<HumanRepository> = {
    update: jest.fn(),
    create: jest.fn(async (input) => ({
      id: 'new',
      preferences: { theme: 'system' as const, timeFormat: '12h' as const },
      createdAt: new Date(),
      ...input
    })),
    createFirst: jest.fn(async (input) => ({
      id: 'first',
      preferences: { theme: 'system' as const, timeFormat: '12h' as const },
      createdAt: new Date(),
      ...input
    })),
    getById: jest.fn(),
    list: jest.fn(),
    count: jest.fn()
  };
  const logger = {
    onHumanUpdated: jest.fn(),
    onHumanCreated: jest.fn()
  } as unknown as jest.Mocked<HumanLogger>;
  return { service: new HumanService(humans, logger), humans, logger };
}

const person = (role: Human['role']): Human => ({
  id: ADMIN_ID,
  name: 'Kim',
  role,
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
});

describe('HumanService', () => {
  it('makes the first person an admin, with no acting person', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(0);

    const human = await service.createHuman(undefined, { name: 'Kim', role: 'member' });

    expect(human.role).toBe('admin');
    expect(humans.createFirst).toHaveBeenCalledWith({ name: 'Kim', role: 'admin' });
  });

  it('falls back to a normal add when another setup became first at the same time', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(0);
    humans.createFirst.mockResolvedValue(null);

    await expect(
      service.createHuman(undefined, { name: 'Eve', role: 'admin' })
    ).rejects.toMatchObject({ name: 'actorNotFound' });
    expect(humans.create).not.toHaveBeenCalled();
  });

  it('lists people with no actor, so the web interface can ask who you are', async () => {
    const { service, humans } = setup();
    const kim = person('admin');
    humans.list.mockResolvedValue([kim]);

    await expect(service.listHumans(undefined)).resolves.toEqual([kim]);
  });

  it('still refuses an actor who is not a known person', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue(null);

    await expect(service.listHumans(ADMIN_ID)).rejects.toMatchObject({ name: 'actorNotFound' });
  });

  it('lets an admin add people after that', async () => {
    const { service, humans, logger } = setup();
    humans.count.mockResolvedValue(1);
    humans.getById.mockResolvedValue(person('admin'));

    const human = await service.createHuman(ADMIN_ID, { name: 'Lee', role: 'member' });

    expect(human.role).toBe('member');
    expect(logger.onHumanCreated).toHaveBeenCalledWith('new', 'member');
  });

  it('lets any person add people, since v1 has one role', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(1);
    humans.getById.mockResolvedValue(person('member'));

    const outcome = await service
      .createHuman(ADMIN_ID, { name: 'Lee', role: 'admin' })
      .catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({ name: 'forbidden' });
  });

  it('needs an acting person once someone exists', async () => {
    const { service, humans } = setup();
    humans.count.mockResolvedValue(1);

    await expect(
      service.createHuman(undefined, { name: 'Lee', role: 'member' })
    ).rejects.toMatchObject({ name: 'actorNotFound' });
  });
});

describe('personal profile updates', () => {
  it('updates only the acting person and logs the change', async () => {
    const { service, humans, logger } = setup();
    const human = person('member');
    humans.getById.mockResolvedValue(human);
    humans.update.mockResolvedValue({ ...human, name: 'New name' });
    const updated = await service.updateProfile(ADMIN_ID, { name: 'New name' });
    expect(humans.update).toHaveBeenCalledWith(ADMIN_ID, { name: 'New name' });
    expect(updated).toMatchObject({ id: human.id, name: 'New name', role: human.role });
    expect(logger.onHumanUpdated).toHaveBeenCalledWith(human.id);
  });

  it('passes preference-only updates without replacing name or identity', async () => {
    const { service, humans } = setup();
    const human = person('member');
    humans.getById.mockResolvedValue(human);
    humans.update.mockResolvedValue({
      ...human,
      preferences: { theme: 'light', timeFormat: '24h' }
    });
    expect(
      await service.updateProfile(ADMIN_ID, { preferences: { theme: 'light', timeFormat: '24h' } })
    ).toMatchObject({
      id: human.id,
      name: human.name,
      preferences: { theme: 'light', timeFormat: '24h' }
    });
    expect(humans.update).toHaveBeenCalledWith(ADMIN_ID, {
      preferences: { theme: 'light', timeFormat: '24h' }
    });
  });

  it('refuses an unknown actor before writing anything', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue(null);
    await expect(service.updateProfile(ADMIN_ID, { name: 'Name' })).rejects.toMatchObject({
      name: 'actorNotFound'
    });
    expect(humans.update).not.toHaveBeenCalled();
  });

  it('reports storage failures without pretending the update succeeded', async () => {
    const { service, humans, logger } = setup();
    humans.getById.mockResolvedValue(person('member'));
    humans.update.mockRejectedValue(new Error('Storage unavailable'));
    await expect(service.updateProfile(ADMIN_ID, { name: 'Name' })).rejects.toThrow(
      'Storage unavailable'
    );
    expect(logger.onHumanUpdated).not.toHaveBeenCalled();
  });
});
