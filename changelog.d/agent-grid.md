### Added
- Agent grid: chosen agents from any PC as chat tiles, in a grid of up to 6 columns and 4 rows
  (3 by 2 at first), opened from the header. Every tile starts empty: each one picks its agent
  from a list narrowed by repo, PC, herdr session and text, and Fill tiles places every agent of
  one repo, PC or session at once. Each tile names its PC, repo, tab and branch, shows the
  agent's chat and its waiting prompt, and takes a message. Tiles never attach a terminal, so no
  pane is resized; Open takes an agent to the full view.
