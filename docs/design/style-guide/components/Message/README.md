# Message

One message row: avatar, name, time, then the text, the same for people and agents.

- Name in `title`, time in `caption` `text-300`, short ("9:31 PM"); the full date on hover.
- Agents add the word "agent" in `agent-label` after the name, and the spark badge on the avatar.
- Back-to-back messages from the same sender drop the avatar and name, and indent to the text.
- Text in `body`, with formatting rendered (bold, lists, code).
- An agent's steps fold into one secondary button: "Read 6 Wikipedia pages · 24 s", which opens the list.
- On hover the row takes `bg-300` and shows Reply, Copy and See what this agent did in a small floating bar (`shadow-pop`).
