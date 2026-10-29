import { mockCatalogRepository, mockHumanRepository } from '../../data/repositories.test-helper';
import { SkillLogger } from '../../observability';
import { Human, Skill, SkillVersion } from '../../shared/types';
import { SkillService } from './skill.service';

const ADMIN = '00000000-0000-4000-8000-000000000001';

const admin: Human = {
  id: ADMIN,
  name: 'Kim',
  role: 'admin',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const skill: Skill = {
  id: 's1',
  name: 'Citations',
  description: 'Cite sources',
  currentVersionId: 'sv1',
  discoverable: false,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};
const skillVersion: SkillVersion = {
  id: 'sv1',
  skillId: 's1',
  version: 1,
  instructions: 'Cite every claim.',
  createdByHumanId: ADMIN,
  createdAt: new Date()
};

function setup() {
  const catalogs = mockCatalogRepository();
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(admin);
  catalogs.getSkill.mockResolvedValue(skill);
  catalogs.getSkillVersions.mockResolvedValue([skillVersion]);
  catalogs.createSkill.mockResolvedValue({ skill, version: skillVersion });
  catalogs.addSkillVersion.mockImplementation(async (_id, input) => ({
    ...skillVersion,
    ...input,
    id: 'sv2',
    version: 2
  }));
  const logger = {
    onSkillSaved: jest.fn(),
    onSkillDiscoveryChanged: jest.fn()
  } as unknown as jest.Mocked<SkillLogger>;
  const service = new SkillService(catalogs, humans, logger);
  return { service, catalogs, humans, logger };
}

describe('SkillService', () => {
  it('lets any person change catalogs, since v1 has one role', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({ ...admin, role: 'member' });

    const outcome = await service
      .createSkill(ADMIN, { name: 'x', description: 'y', instructions: 'z' })
      .catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({ name: 'forbidden' });
  });

  it('creates a skill with version 1', async () => {
    const { service, catalogs } = setup();

    const created = await service.createSkill(ADMIN, {
      name: 'Citations',
      description: 'Cite sources',
      instructions: 'Cite every claim.'
    });

    expect(created.currentVersion?.version).toBe(1);
    expect(catalogs.createSkill).toHaveBeenCalledWith(
      { name: 'Citations', description: 'Cite sources' },
      { instructions: 'Cite every claim.', createdByHumanId: ADMIN }
    );
  });

  it('saves a new skill version from the current one', async () => {
    const { service, catalogs } = setup();

    const updated = await service.addSkillVersion(ADMIN, 's1', {
      instructions: 'Cite each source.'
    });

    expect(catalogs.addSkillVersion).toHaveBeenCalledWith('s1', {
      instructions: 'Cite each source.',
      createdByHumanId: ADMIN
    });
    expect(updated.currentVersion?.version).toBe(2);
  });

  it('never checks connections or grants access when creating or versioning instructions', async () => {
    const { service, catalogs } = setup();
    await service.createSkill(ADMIN, {
      name: 'Billing',
      description: 'Billing',
      instructions: 'Use Billing API.'
    });
    await service.addSkillVersion(ADMIN, 's1', { instructions: 'Use another API.' });
    expect(catalogs.getConnections).not.toHaveBeenCalled();
    expect(catalogs.grant).not.toHaveBeenCalled();
  });

  it('marks a skill discoverable without granting any agent access', async () => {
    const { service, catalogs } = setup();
    await service.updateSkill(ADMIN, skill.id, { discoverable: true });
    expect(catalogs.setSkillDiscoverable).toHaveBeenCalledWith(skill.id, true);
    expect(catalogs.grant).not.toHaveBeenCalled();
  });
});
