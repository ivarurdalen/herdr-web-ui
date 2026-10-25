### Added
- Repos board: a header button opens one colored card per repo, with its agents by status (needs
  input, working, waiting, done, idle, unknown), PCs, workspaces and linked pull requests and Linear
  issues, live. Repos that need a person come first. A click on a card opens the agent grid on that
  repo's view.
- Repos board cards say how many agents are active (needs input, working, waiting) and inactive, flag
  the ones that need input, and name up to five agents with their status, the ones in a turn first.
- A link can open a board: `?board=repos`, `grid`, `sessions` or `none`. The browser keeps that board as its
  choice, as if picked from the header.
