// Response shapes. docs/responses.md describes them for API clients.

export interface ApiSuccess<T> {
  data: T;
}

export interface PageInfo {
  limit: number;
  offset: number;
  total: number;
}

export interface ApiPage<T> {
  data: T[];
  page: PageInfo;
}

// One problem with the request input, such as a missing body field.
export interface ErrorDetail {
  field?: string;
  in: string;
  message: string;
}

export interface ApiFailure {
  error: {
    code: number;
    name: string;
    message: string;
    requestId: string;
    details?: ErrorDetail[];
  };
}

export function success<T>(data: T): ApiSuccess<T> {
  return { data };
}

export function paged<T>(data: T[], page: PageInfo): ApiPage<T> {
  return { data, page };
}

export function failure(error: ApiFailure['error']): ApiFailure {
  return { error };
}
