# Response format

Every response body is JSON. Use the HTTP status to tell success from failure:

- **2xx**: it worked. The body has `data`.
- **4xx or 5xx**: it failed. The body has `error`.

Every response, success or error, also has an `x-request-id` header.

## Success

One thing:

```json
{
  "data": { "id": "1f0c...", "name": "Widget" }
}
```

Creating something returns `201`. Everything else that works returns `200`.

## Lists

Lists also have `page`:

```json
{
  "data": [{ "id": "1f0c...", "name": "Widget" }],
  "page": { "limit": 50, "offset": 0, "total": 132 }
}
```

| Field    | Meaning                                       |
| -------- | --------------------------------------------- |
| `limit`  | How many items this page could hold.          |
| `offset` | How many items were skipped before this page. |
| `total`  | How many items there are in all.              |

There are more pages when `offset + limit < total`. To get the next page, add `limit` to `offset`: `GET /items?limit=50&offset=50`.

## Errors

```json
{
  "error": {
    "code": 20002,
    "name": "itemNotFound",
    "message": "Item 1f0c... was not found",
    "requestId": "8f3c2a1e-..."
  }
}
```

| Field       | Meaning                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `code`      | A number that is unique to this error. Every code is listed in `docs/errors.md`.                         |
| `name`      | The same error in words, such as `itemNotFound`.                                                         |
| `message`   | A description for people. It can change, so don't write code that depends on it. Check `code` or `name`. |
| `requestId` | The ID of this request, the same as the `x-request-id` header. Include it when you report a problem.     |
| `details`   | Only on `validationError`. One entry per bad field.                                                      |

Bad input lists each bad field in `details`:

```json
{
  "error": {
    "code": 10001,
    "name": "validationError",
    "message": "Request validation failed",
    "requestId": "8f3c2a1e-...",
    "details": [
      {
        "field": "name",
        "in": "body",
        "message": "Invalid input: expected string, received undefined"
      }
    ]
  }
}
```

`field` is the field's name, with dots for nested fields, like `metadata.color`. `in` says where it was: `body`, `querystring`, or `params`.

## In the code

The helpers are in `apps/api/src/shared/response.ts`:

- `success(data)` for one thing.
- `paged(items, { limit, offset, total })` for lists.
- Error responses are built for you by the error handler in `apps/api/src/app.ts`. Handlers never build them.

## Skills and agent connection selections

Skill versions return `id`, `skillId`, `version`, `instructions`, `createdByHumanId`, and `createdAt`. The retired skill `connectionIds` field is omitted from both current and historical responses. Skill creation accepts name, description, and instructions; a new version accepts instructions only. Structured connection fields are rejected as unknown input.

Agent versions return `skillIds` for display and editing of pinned skills, including older skill versions, alongside `skillVersionIds` and explicit `connectionIds`. They also return `legacyConnectionIds`, a read-only list of inherited-only selections from old pinned skill versions that need human review. It grants no access and is rejected in configuration requests. Existing pins and grants are unchanged; see [the rollout steps](catalogs.md#moving-from-inherited-connections-ca-37).

## Person profiles

`GET /humans` and `POST /humans` return each person's `id`, `name`, `role`, `createdAt`, and
`preferences`: `{ "theme": "system", "timeFormat": "12h" }`. The theme is `system`, `dark`, or
`light`; the time format is `12h` or `24h`. Existing and new people default to `system` and `12h`.

`PATCH /humans/me` requires `x-actor-id` and updates only that person. Send a nonempty subset:

```json
{
  "name": "Kayvan",
  "preferences": { "theme": "light", "timeFormat": "24h" }
}
```

The response is `200` with `success(person)`, including the saved preferences. The name is trimmed
and must be 1–100 characters. Preference fields may be updated individually. Omitted fields keep
their saved values. Empty updates, empty preference objects, unknown fields, and invalid choices
return `validationError`. An unknown acting person returns `actorNotFound`. IDs, roles, message
ownership, and history do not change. There is still no sign-in; the header identifies the person
selected in the local app.

Profile and settings opens from the sidebar name. Switch person opens a modal with a dimmed
background and large avatar tiles; choose a person or dismiss with Close, Escape, or the backdrop.
Each tab has its own Save and Discard actions;
changing tabs keeps drafts. Failed saves keep edits for retry. Leaving with edits prompts before
discarding, and navigation waits for an active save to finish. The browser remembers only the
selected person and a theme copy for startup. The server remains the source for preferences on
reload or person switch. System theme follows the computer's appearance. Times use the device's
IANA timezone and the person's saved hour format, without changing stored instants or schedules.

## Recurring schedules

Responsibility responses include `intervalMinutes` and `recurrence`. Existing interval schedules
return their original interval and `recurrence: null`. Calendar schedules return
`intervalMinutes: null` and `recurrence: { frequency, time, timeZone, days? }`. Only weekly rules
include `days` (ISO weekdays, Monday = 1). UTC timestamps stay ISO strings; clients format actual
instants in their viewer's timezone and keep the source rule separate. See
[scheduling.md](scheduling.md#calendar-recurrence) for request validation, DST rules, and migration details.

## Conversation names

Conversation `title` fields contain the stored channel name, such as `heat-pumps-brief`, without
`#`. Create and rename requests normalize uppercase, spaces, and punctuation before saving;
responses return the canonical value. Names use only `a–z`, `0–9`, and single hyphens, with no
leading/trailing hyphen. Inputs with no letters or numbers return `validationError`. Migration 034
normalizes existing names while preserving their IDs and links. See [conversations](conversations.md#channel-names).
