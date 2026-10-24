import { z } from 'zod';

const participantRefSchema = z.strictObject({
  type: z.enum(['human', 'agent']),
  id: z.uuid()
});

export const conversationParamsSchema = z.object({
  conversationId: z.uuid()
});

export const createConversationBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  agentIds: z.array(z.uuid()).max(20).optional(),
  humanIds: z.array(z.uuid()).max(20).optional()
});

export const updateConversationBodySchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    // US dollars for all agent work in this conversation. null removes the cap.
    budgetUsd: z.number().positive().max(100_000).nullable().optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export const addMemberBodySchema = z.strictObject({
  type: z.enum(['human', 'agent']),
  id: z.uuid(),
  // 'from_now' hides messages from before they joined.
  history: z.enum(['all', 'from_now']).default('all')
});

export const postMessageBodySchema = z.strictObject({
  body: z.string().trim().min(1).max(20_000),
  // Agents mentioned here are asked to respond. Messages that mention no one start no work.
  mentions: z.array(participantRefSchema).max(20).optional(),
  inReplyToMessageId: z.uuid().optional(),
  clientKey: z.string().trim().min(1).max(200).optional()
});

export const listConversationsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const listMessagesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

export const addDocumentBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(100_000)
});

export const documentParamsSchema = z.object({
  conversationId: z.uuid(),
  documentId: z.uuid()
});

export type AddDocumentBody = z.infer<typeof addDocumentBodySchema>;
export type DocumentParams = z.infer<typeof documentParamsSchema>;
export type ConversationParams = z.infer<typeof conversationParamsSchema>;
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;
export type PostMessageBody = z.infer<typeof postMessageBodySchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
