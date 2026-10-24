import { ADMIN_ONLY, hasFullAccess, requireHuman, ROLES_ENABLED } from './access';
import { Human } from './types';

const person = (role: Human['role']): Human => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Sam',
  role,
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
});

describe('access', () => {
  it('gives everyone full access in v1, which has one role', () => {
    expect(ROLES_ENABLED).toBe(false);
    expect(requireHuman(person('member'), ADMIN_ONLY)).toMatchObject({ role: 'member' });
    expect(hasFullAccess(person('member'))).toBe(true);
  });

  it('still needs a known person', () => {
    expect(() => requireHuman(null)).toThrow(expect.objectContaining({ name: 'actorNotFound' }));
  });

  describe('with roles turned back on', () => {
    it('only lets the allowed roles through', () => {
      expect(() => requireHuman(person('member'), ADMIN_ONLY, true)).toThrow(
        expect.objectContaining({ name: 'forbidden' })
      );
      expect(requireHuman(person('admin'), ADMIN_ONLY, true)).toMatchObject({ role: 'admin' });
    });

    it('gives full access only to admins', () => {
      expect(hasFullAccess(person('member'), true)).toBe(false);
      expect(hasFullAccess(person('admin'), true)).toBe(true);
    });
  });
});
