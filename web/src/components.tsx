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

// A row of checkboxes for choosing several things, like skills or HTTP methods.
export function CheckGroup<T extends string>(props: {
  options: { value: T; label: ReactNode }[];
  selected: T[];
  onChange: (selected: T[]) => void;
}) {
  if (props.options.length === 0) {
    return <span className="muted">None yet.</span>;
  }
  return (
    <div className="stack tight">
      {props.options.map((option) => (
        <label key={option.value} className="check">
          <input
            type="checkbox"
            checked={props.selected.includes(option.value)}
            onChange={(event) =>
              props.onChange(
                event.target.checked
                  ? [...props.selected, option.value]
                  : props.selected.filter((value) => value !== option.value)
              )
            }
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

// An optional whole number from a text box: empty means "not set".
export function toLimit(value: string): number | undefined {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
