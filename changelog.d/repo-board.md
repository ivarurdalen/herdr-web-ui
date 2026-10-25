### Added
- Repos board: a header button opens one colored card per repo, with its agents by status (needs
  input, working, waiting, done, idle, unknown), PCs, workspaces and linked pull requests and Linear
  issues, live. Repos that need a person come first. A click on a card opens the agent grid on that
  repo's view.
- Repos board cards say how many agents are active (needs input, working, waiting) and inactive, flag
  the ones that need input, and name up to five agents with their status, the ones in a turn first.
- A link can open a board: `?board=repos`, `grid`, `sessions` or `none`. The browser keeps that board as its
  choice, as if picked from the header.
- Repos board toolbar: search, filter by status, herdr session and machine, group by session, machine or
  attention, and save a mix as a named scope (shared by every device). A card shows the sessions it
  runs in, and a click opens the grid on that session or machine. The board says "machines" now, not "PCs".
