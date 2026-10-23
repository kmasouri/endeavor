import { ReactNode } from 'react';

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

// A short explanation shown next to a field or section, such as what "Saved notes" means.
export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}

export function when(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
