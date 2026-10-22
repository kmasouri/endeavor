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

The helpers are in `src/shared/response.ts`:

- `success(data)` for one thing.
- `paged(items, { limit, offset, total })` for lists.
- Error responses are built for you by the error handler in `src/app.ts`. Handlers never build them.
