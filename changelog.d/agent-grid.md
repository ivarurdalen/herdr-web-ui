### Added
- Agent grid: saved views of agents from any PC as chat tiles, in a grid of up to 6 columns and
  4 rows, opened from the header and shown first. A new view starts empty at 3 by 2; one click on
  a repo's chip opens the view of all its agents, sized to fit. Repo, PC and herdr session filters beside the grid size fill the empty tiles with every agent that
  matches, as agents come and go; each tile can also pick its own agent, and a removed one stays
  out. Views are kept with the shared preferences, so every browser sees the same ones. Each tile
  names its PC, repo, tab and branch, shows the agent's chat and its waiting prompt, and takes a
  message. Tiles never attach a terminal, so no pane is resized; Open takes an agent to the full
  view.
- Sidebar repo filter: a funnel beside the agent grid button narrows the sidebar to the chosen
  repos' workspaces and agents, on this device.
