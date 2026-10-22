import { z } from 'zod';

// Names the person making the request. Provisional until real sign-in: see "Who can do what?"
// in Questions for Kayvan. Header schemas use z.object, because requests carry other headers.
export const actorHeadersSchema = z.object({
  'x-actor-id': z.uuid()
});

export const optionalActorHeadersSchema = z.object({
  'x-actor-id': z.uuid().optional()
});

export type ActorHeaders = z.infer<typeof actorHeadersSchema>;
export type OptionalActorHeaders = z.infer<typeof optionalActorHeadersSchema>;
