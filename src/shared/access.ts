import { AppError } from './errors';
import { Human, HumanRole } from './types';

// Role checks shared by every service. Services load the acting person with their own
// repository and pass the result here, so the rules stay in one place.
//
// Provisional: roles are admin and member, and the API names the acting person in the
// x-actor-id header. See "Who can do what?" in Questions for Kayvan.
export function requireHuman(
  human: Human | null,
  allowed: readonly HumanRole[] = ALL_ROLES
): Human {
  if (!human) {
    throw new AppError('actorNotFound');
  }
  if (!allowed.includes(human.role)) {
    throw new AppError('forbidden', `Only ${allowed.join(' or ')} users can do this`);
  }
  return human;
}

export const ALL_ROLES: readonly HumanRole[] = ['admin', 'member'];
export const ADMIN_ONLY: readonly HumanRole[] = ['admin'];
