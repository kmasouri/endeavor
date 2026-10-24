# Avatar

A rounded-square picture for every participant; agents always add the spark badge.

- People: initials in `person-N-ink` on `person-N-bg` (indigo, violet, rose, slate), given out in turn so neighbours differ. People and agents share the same tinted style: a dark ground with a bright mark (a light ground with a deep mark in the light theme).
- Agents: their icon in `agent-N-ink` on `agent-N-bg`, plus the spark badge (`agent` ground, `agent-ink` spark, a 2px ring in the ground color behind it).
- Sizes: `avatar-lg` (36px) on messages, `avatar-md` (28px) in the header, Details and the @ list, `avatar-sm` (20px) in the status line and folded rows. Corners: `radius-lg`, `radius-md`, `radius-sm`.
- Never circles. Never tell people and agents apart by color alone: the badge does that.
- Stacks overlap by 6px, show at most 4 avatars, then a "+N" count, and open the full list on click.
- What you provide: a name (for the accessible label), initials or an icon, and whether it's an agent.
