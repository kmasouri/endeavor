import { AppError } from '../../shared/errors';
import { Human, HumanRole } from '../../shared/types';

// Role checks shared by every service. Services load the acting person with their own
// repository and pass the result here, so the rules stay in one place.
//
// v1 has one role: every person can do everything (Kayvan's answer to "Who can do what?").
// The admin and member checks stay in the code. Set ROLES_ENABLED to true to bring them back.
// The API still names the acting person in the x-actor-id header, so history shows who did what.
export const ROLES_ENABLED = false;

const ALL_ROLES: readonly HumanRole[] = ['admin', 'member'];
export const ADMIN_ONLY: readonly HumanRole[] = ['admin'];

export function requireHuman(
  human: Human | null,
  allowed: readonly HumanRole[] = ALL_ROLES,
  rolesEnabled: boolean = ROLES_ENABLED
): Human {
  if (!human) {
    throw new AppError('actorNotFound');
  }
  if (rolesEnabled && !allowed.includes(human.role)) {
    throw new AppError('forbidden', `Only ${allowed.join(' or ')} users can do this`);
  }
  return human;
}

// True when this person can see and change everything, not just their own conversations.
export function hasFullAccess(human: Human, rolesEnabled: boolean = ROLES_ENABLED): boolean {
  return !rolesEnabled || human.role === 'admin';
}
