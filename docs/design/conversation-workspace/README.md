# Conversation workspace and creation dialog

Kayvan approved this design on October 24, 2026. It keeps the conversation list, selection, and
creation action together in the sidebar. The main area shows the selected chat. New conversation
opens a centered dialog over the workspace.

This is an approved follow-up reference made in Codex, not an export from the claude.ai board.
The existing board exports remain unchanged. This reference refines navigation and creation only;
the chat-view and agent-history references still define the full chat header, member controls,
messages, composer, Details, and history. The simplified examples here do not replace them.

## Files

- `conversation-workspace.fragment.html`: editable source, using sample data and local interactions.
- `conversation-workspace.html`: generated standalone browser preview. Open it directly; use
  **Chat workspace** and **New conversation dialog** above the app to inspect both states.
- `conversation-workspace.png` and `new-conversation.png`: dark desktop references.
- `conversation-workspace-light.png` and `new-conversation-light.png`: light desktop references.
- `new-conversation-mobile.png`: narrow dialog reference.

The controls above the preview are for reviewing the design, not part of the product.
Create a sample conversation, switch chats, search, select members, send sample messages, or
cancel the dialog. These interactions never call the API, persist data, or start agents.
The preview follows the browser's appearance setting.

## Agreed behavior

- One searchable conversation list lives in the sidebar, with a labeled **New conversation** action.
  Remove the duplicate directory and permanent creation form from the main area.
- Opening Conversations restores the last accessible chat. With no conversations, show a simple
  first-conversation prompt. Handle an unavailable saved chat without breaking direct links.
- New conversation opens a centered modal with a required name and optional searchable people
  and agent selection. People and agents can be added later. Agents respond when mentioned.
- Creation selects the new conversation, adds it to the sidebar, and focuses its composer.
  Creating a conversation or adding an agent does not itself start agent work.
- Cancel, Close, and Escape return to the previous chat without creating anything. Keep keyboard
  focus inside the dialog and restore it on dismissal.
- Preserve form input on API failures, show validation and request errors, and prevent duplicate
  submissions while creating. Close the dialog only after success.
- Match the shared style guide in both themes and at phone widths. Keep agent badges and existing
  member controls when implementing this alongside the full chat design.

## Implementation boundary

[CA-52: Unify the conversation workspace and create chats in a modal](https://app.notion.com/p/4031a83d088f81ec915ad0fe54ac2bc8)
tracks implementation after completed CA-35. Saving these files completes only the design archive
criterion. The Svelte app, API, routes, persistence, and Docker service are unchanged.

Sample conversations and member choices are illustrative. Researcher is checked to show a selected
row; that does not prescribe a default agent. Name validation follows the application's real rules,
not the sample's duplicate-name check. Last-chat restoration, empty-workspace entry, and API failure
states are specified above but are not simulated by this preview.

CA-40 still owns history and removal of Work navigation. CA-47 still owns unread counts. This
reference does not change membership permissions, agent response rules, or those tickets' scope.

## Regenerate and validate

Edit the fragment, then regenerate the standalone preview with the Codex visualize skill's renderer:

```sh
python3 "$VISUALIZE_SKILL_DIR/scripts/render.py" \
  docs/design/conversation-workspace/conversation-workspace.fragment.html \
  docs/design/conversation-workspace/conversation-workspace.html \
  --title 'Conversation workspace — approved CA-52 design' --force
```

Set `VISUALIZE_SKILL_DIR` to the installed visualize skill directory. Do not edit generated HTML.
The renderer supplies the preview runtime and loads its icons from a pinned CDN, so icon rendering
needs internet access. The fragment itself makes no network requests. Capture screenshots from a fresh preview so sample-created chats do not leak into them.

Check creation, chat selection, search, member selection, Cancel/Close/Escape, focus restoration,
both themes, and a narrow viewport in a real browser. Run `npm run check` from the repository root.
