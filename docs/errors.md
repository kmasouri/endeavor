# Error codes

Every error response has a `code` and a `name` from this list. Clients should check `code` (or `name`), not the message; messages can change.

```json
{
  "error": {
    "code": 20002,
    "name": "itemNotFound",
    "message": "Item 1f0c... was not found",
    "requestId": "8f3c..."
  }
}
```

Codes are grouped by feature: `10xxx` for general errors, `20xxx` for items. A code never changes or gets reused once it ships.

The list lives in `src/shared/errors.ts`. When you add an error there, add it here too. A test fails if this page is missing one.

## General (10xxx)

| Code  | Name                   | HTTP | What it means                                                          | How to fix it                                                      |
| ----- | ---------------------- | ---- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 10000 | `internalError`        | 500  | Something broke on our side.                                           | Try again later. If it keeps happening, report the `x-request-id`. |
| 10001 | `validationError`      | 400  | Some input was wrong. `details` lists each bad field.                  | Fix the fields listed in `details`.                                |
| 10002 | `routeNotFound`        | 404  | No endpoint matches this method and URL.                               | Check the method and URL against `/docs`.                          |
| 10003 | `invalidRequest`       | 4xx  | The request could not be read, for example the body is not valid JSON. | Send a well-formed request.                                        |
| 10004 | `payloadTooLarge`      | 413  | The request body is too large.                                         | Send a smaller body.                                               |
| 10005 | `unsupportedMediaType` | 415  | The `Content-Type` is not supported.                                   | Send `Content-Type: application/json`.                             |

## Items (20xxx)

| Code  | Name            | HTTP | What it means                                                        | How to fix it                                 |
| ----- | --------------- | ---- | -------------------------------------------------------------------- | --------------------------------------------- |
| 20001 | `itemNameTaken` | 409  | An item with this name already exists. Names are not case sensitive. | Pick a different name.                        |
| 20002 | `itemNotFound`  | 404  | No item has this ID.                                                 | Check the ID. The item may have been removed. |
