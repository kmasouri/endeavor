# StateCard

A card in the conversation when an agent needs a person: to approve something, to resume it, or to unstick it.

- **Needs your OK**: `waiting-bg`, `waiting-border`. What it wants to do in plain words, the exact request in `code`, then "Allow once" (primary) and "Don't allow".
- **Paused**: a slim `bg-200` row: "Researcher is paused · Sam paused it at 9:35 PM", one line saying it does nothing and spends nothing until resumed, and "Resume".
- **Stuck**: `danger-bg`, `danger-border`, the reason in plain words with a `danger` icon, then the fix as the primary button ("Raise budget to $2 and continue") and "Stop here".
- Words here are never playful.
