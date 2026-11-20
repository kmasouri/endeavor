# Design

The design guides for the web app (`apps/web`). Build the interface to follow them, using only the tokens in `style-guide/tokens.css`.

This folder used to hold exported screen mockups. They fell behind the app and were removed in CA-124, so the app itself is now the reference for how each screen looks. Screen redesigns are agreed in Notion (see the "Web app design review" page under the Project Hub) and then built.

Endeavor is the current product name. See [rebrand compatibility](../rebranding.md) for retained identifiers and design provenance.

## What's here

| Path | What |
| --- | --- |
| `style-guide/README.md` | The style guide: principles, color roles, type, spacing, words, icons, layout, and rules that apply on every screen |
| `style-guide/tokens.json` | Every token, with a note on when to use it |
| `style-guide/tokens.css` | The same tokens as CSS custom properties. Generated from `tokens.json`; `apps/web/src/design-tokens.css` is a copy that a test keeps in sync |
| `style-guide/components/<Name>/` | Each building block: `README.md` (how to use it) and `preview.html` (a live example) |

## How to look at it

- Read the `.md` files.
- Open any component `preview.html` in a browser. Set `data-theme="light"` on its `<html>` element to see the light theme.

## Changing the design

- Change a token in `tokens.json`, regenerate `tokens.css`, and copy it to `apps/web/src/design-tokens.css`.
- Need a color that isn't a token? Add a token rather than a new hex value.
- Record a new rule that applies across screens in `style-guide/README.md`.
