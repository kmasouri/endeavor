# AgentRow

One line per agent in the Details panel, built to stay short with many agents.

- 40px row: 24px avatar with badge, name, then what it's doing in `caption`, and a chevron.
- Order: working, then waiting, then free. The header counts them: "1 working · 1 waiting · 3 free".
- Working agents show their live status in `agent-label` (playful words allowed); waiting ones in `text-200` ("Waiting for Reviewer").
- Only the row you click opens: a `bg-200` box with a sky-tinted `agent-2-bg` border holding the current step in `body-sm`, and Pause, Stop and History.
- Free agents fold into one row: "3 more agents · Free", which unfolds into normal rows.
