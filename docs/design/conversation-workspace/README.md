# Endeavors

Kayvan approved the unified work view and creation dialog on October 24, 2026, then refined the
terminology to **Endeavors**. An endeavor brings a goal, people, agents, discussion, and outputs
together. Work can evolve as participants collaborate.

This is an approved Codex follow-up, not an export from the claude.ai board. Existing board exports
remain unchanged. The chat-view and agent-history references still define the full header,
member controls, messages, composer, Details, and history. The simplified examples here do not
replace those features.

## Files

- `conversation-workspace.fragment.html`: editable source with sample data and local interactions.
- `conversation-workspace.html`: generated standalone browser preview; open it directly.
- `conversation-workspace.png` and `new-conversation.png`: dark desktop reference and creation dialog.
- `conversation-workspace-light.png` and `new-conversation-light.png`: light desktop references.
- `new-conversation-mobile.png`: narrow creation dialog.
- `search-endeavors.png`: search opened from the app header.

The existing folder and filenames stay stable so earlier links keep working. Their content now
shows Endeavors. The preview follows the browser's appearance setting. Its interactions never
call the API, persist data, or start agents.

## Agreed wording and layout

- Main navigation: **Endeavors**. Reserve **Workspace** for a future team or organization boundary.
- Sidebar heading: **Recent**. A compact **+ New** action sits beside it, with the accessible name
  **New endeavor**. Avoid a large primary creation button and a second Conversations label.
- List entries have readable, outcome-based titles such as **Heat pump brief**, without channel
  hashes or forced dash-separated display names.
- Search lives in the app header as **Search endeavors**, opening a search dialog. Support the
  header action and Cmd/Ctrl K. Do not leave a search field in the Recent section.
- Creation opens a centered dialog headed **What do you want to accomplish?**, with **Give it a
  name**, optional people and agents, **Cancel**, and **Start**.

## Agreed behavior

- Show the selected endeavor in the main area. Remove the duplicate directory and permanent
  creation form. Returning to Endeavors restores the last accessible item; no items means a
  first-endeavor prompt. Preserve direct links and handle unavailable saved selections.
- Starting an endeavor adds it to Recent, selects it, and focuses its composer. Creating it or
  adding an agent does not start agent work. Agents respond when mentioned.
- People and agents can be added later. Preserve existing membership permissions.
- Cancel, Close, and Escape return to the previous endeavor without creating anything. Keep
  keyboard focus inside the dialog and restore it on dismissal.
- Preserve input on API failure, show validation and request errors, prevent duplicate submissions
  while saving, and close only after success.
- Keep the shared style guide in both themes and at phone widths, including agent badges and
  existing member controls from the full chat reference.

**Endeavor is the product-facing name for this shared work context.** This design does not create
an organization container or rename database tables, conversation APIs, task records, or internal
IDs. Individual agent tasks and runs remain distinct from the endeavor containing their discussion.

## Implementation boundary

[CA-52: Introduce Endeavors with a unified work view and modal creation](https://app.notion.com/p/4031a83d088f81ec915ad0fe54ac2bc8)
tracks implementation after completed CA-35. Saving these files completes only the design archive
criterion. The Svelte app, API, routes, persistence, and Docker service are unchanged.

Sample endeavors and member choices are illustrative. Agents are not selected by default.
Name validation follows the application's real rules; the sample only requires a nonempty title.
Last-endeavor restoration, empty-list entry, and API failure states are specified above but are
not simulated by this preview.

CA-40 still owns history and removal of Work navigation. CA-47 still owns unread counts. This
reference does not change membership permissions, agent response rules, or those tickets' scope.

## Regenerate and validate

Edit the fragment, then regenerate the standalone preview with the Codex visualize skill's renderer:

```sh
python3 "$VISUALIZE_SKILL_DIR/scripts/render.py" \
  docs/design/conversation-workspace/conversation-workspace.fragment.html \
  docs/design/conversation-workspace/conversation-workspace.html \
  --title 'Endeavors — approved CA-52 design' --force
```

Set `VISUALIZE_SKILL_DIR` to the installed visualize skill directory. Do not edit generated HTML.
The renderer supplies the preview runtime and loads its icons from a pinned CDN, so icon rendering
needs internet access. The fragment itself makes no network requests. Capture screenshots from a fresh preview so sample-created chats do not leak into them.

Check creation, chat selection, search, member selection, Cancel/Close/Escape, focus restoration,
both themes, and a narrow viewport in a real browser. Run `npm run check` from the repository root.
