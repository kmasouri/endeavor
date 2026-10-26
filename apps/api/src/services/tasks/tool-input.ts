import { AppError } from '../../shared/errors';

// Reads fields from a model's tool call input. The model can send anything, so each reader
// checks the type and gives the model a clear error to fix.

export type ToolInput = Record<string, unknown>;

export function readRequiredString(input: ToolInput, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('validationError', `The ${field} field is required and must be text.`);
  }
  return value;
}

export function readOptionalString(input: ToolInput, field: string): string | null {
  const value = input[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function readStringList(input: ToolInput, field: string): string[] {
  const value = input[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
