interface ErrorDefinition {
  code: number;
  statusCode: number;
  message: string;
}

// The error catalog: every error the API can return, each with its own code.
// The key is the error's name in responses. docs/errors.md documents each one.
//
// Codes are grouped by feature: 10xxx for general errors, 20xxx for items.
// Never change or reuse a code once it has shipped; clients may depend on it.
export const ERRORS = {
  // 10xxx: general
  internalError: { code: 10000, statusCode: 500, message: 'Unexpected server error' },
  validationError: { code: 10001, statusCode: 400, message: 'Request validation failed' },
  routeNotFound: { code: 10002, statusCode: 404, message: 'Route not found' },
  invalidRequest: { code: 10003, statusCode: 400, message: 'The request could not be read' },
  payloadTooLarge: { code: 10004, statusCode: 413, message: 'The request body is too large' },
  unsupportedMediaType: {
    code: 10005,
    statusCode: 415,
    message: 'The request content type is not supported'
  },

  // 20xxx: items
  itemNameTaken: { code: 20001, statusCode: 409, message: 'An item with this name already exists' },
  itemNotFound: { code: 20002, statusCode: 404, message: 'Item not found' }
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorName = keyof typeof ERRORS;

// Services throw this with a name from the catalog:
//   throw new AppError('itemNotFound', `Item ${itemId} was not found`);
// The message is optional; it defaults to the one in the catalog.
export class AppError extends Error {
  constructor(name: ErrorName, message: string = ERRORS[name].message) {
    super(message);
    this.name = name;
    this.code = ERRORS[name].code;
    this.statusCode = ERRORS[name].statusCode;
  }

  public override readonly name: ErrorName;
  public readonly code: number;
  public readonly statusCode: number;
}
