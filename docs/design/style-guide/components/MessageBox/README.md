# MessageBox

Where you write: one line with attach, the text and send, and a status line above it.

- One row: Attach (icon button), the text field, Send (primary, icon only). It grows taller only as you type more lines. No @ button: typing @ opens the picker.
- `bg-200` ground, `border-200` border, `radius-xl` corners, 6px inner padding; a `focus` state turns the border `accent`.
- Under it, a `caption` hint: "Type @ to ask an agent or a person · Enter sends · Shift+Enter for a new line".
- **Status line**, just above the box, `meta` `text-200`: who is busy, with small avatars: "Reviewer is fact-checking… · Researcher is waiting for it", or "Sam is typing…". It's the only live activity on the main view; Details has the rest.
- Replying shows a "Replying to Reviewer: …" bar on top of the box, with a close button.
