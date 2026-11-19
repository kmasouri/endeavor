// How much of the goal the default done criteria quote.
export const DONE_CRITERIA_GOAL_CHARS = 300;

// Done criteria filled in from an endeavor's goal, so people never have to write them. People
// can edit them later. db/schema/021_projects.sql builds the same text for older conversations.
export function defaultDoneCriteria(goal: string): string {
  const request = goal.replace(/\s+/g, ' ').trim().slice(0, DONE_CRITERIA_GOAL_CHARS);
  return `Done when the result meets this request and a person confirms it: ${request}`;
}
