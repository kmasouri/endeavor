# ArtifactCard

How an agent hands over a draft or a finished result: a card in the conversation, not a wall of text.

- `bg-200` ground, `border-200` border, `radius-xl` corners, at most 640px wide.
- A `label` line ("Result" or "Draft"), the title in `title`, a three-line preview in `body` `text-200`, and a `meta` line saying how many sources and who reviewed it.
- An action strip under a `border-100` rule: one primary ("Read it") and secondary actions ("Accept", "Ask for changes").
- Under the card, a `meta` `text-300` line with time taken and cost.
- In lists (Details › Artifacts), a compact row instead: icon, title, then "Draft · 9:31 PM" or "Final · 9:32 PM".
