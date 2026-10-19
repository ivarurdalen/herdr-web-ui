### Added
- Agent grid: saved views of agents from any PC as chat tiles, in a grid of up to 6 columns and 4
  rows, opened from the header and shown first. A new view starts empty at 3 by 2; one click on a
  repo's chip opens the view of all its agents, sized to fit. Repo, PC and herdr session filters
  beside the grid size fill the empty tiles with every agent that matches, as agents come and go;
  each tile can also pick its own agent, and a removed one stays out. Views are kept with the
  shared preferences, so every browser sees the same ones. Each tile names its PC, repo, tab and
  branch, shows the agent's chat and its waiting prompt, and takes a message. Tiles never attach a
  terminal, so no pane is resized; Open takes an agent to the full view.
- Sidebar repo filter: a funnel beside the agent grid button narrows the sidebar to the chosen
  repos' workspaces and agents, on this device.
- Agent sessions: the hub keeps a SQLite record of every agent session it sees (where it ran, its
  agent session id, repo, branch, folder, and when it was first seen, last seen and ended), a
  short description an agent writes of each, with when it was written, and links many to many to
  GitHub pull requests and Linear issues. An Agent sessions page lists them in one sortable,
  filterable table: the title opens the chat, the description and the linked pull requests and
  issues show as links, and a column picker shows the rest. A row opens to the resume command,
  suggested links and links made or removed by hand. The chat view and the grid's tiles show the
  agent session's links, and the chat view its description. The agent-sessions skill lets an agent
  describe and link them through /api/agent-sessions. Transcripts are not stored.
