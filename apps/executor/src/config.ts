import { envSchema } from './schemas.ts';

export const config = envSchema.parse(process.env);
