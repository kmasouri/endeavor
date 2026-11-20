// Writes a number with its noun, singular for exactly one: "1 agent", "2 agents".
export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}
