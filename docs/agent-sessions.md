# Agent sessions

The grid hub keeps a record of every agent session it sees: where it ran, how to resume it, and
which GitHub pull requests and Linear issues it belongs to. It stores metadata only. Transcripts
stay where the agent wrote them, on the PC that ran it.

## Terms

Two different things are called a session. The code, the API, the CLI and the UI keep them apart:

- **Agent session:** one conversation of a coding agent, such as a Claude Code or Codex session.
  The agent gives it an id (the **agent session id**), and that id resumes it later:
  `claude --resume <id>`, `codex resume <id>`. One pane runs one agent session at a time; `/clear`
  in Claude Code starts a new one in the same pane.
- **herdr session:** one herdr server on a PC, named like `private` or `estrada`. It holds
  workspaces, tabs and panes. A PC can run several herdr sessions; the hub reaches each one as its
  own entry in the PC list, named `host/herdr-session` (for example `stivi/private`).
- **PC:** a computer the hub reaches over SSH, or the hub's own computer.
- **Workspace, tab, pane:** herdr's layout inside a herdr session. A pane runs a shell or an agent.
- **Repo:** the project a workspace works on: its `paddock_repo` token, else its git worktree's
  repo, else the repo name its label starts with (`devkit-grok-install` is `devkit`).

## What is recorded

One row per agent session, keyed by the PC entry, the agent and the agent session id:

- **Where:** PC, herdr session, repo, workspace, branch, folder, pane.
- **What:** agent kind (`claude`, `codex`, ...), agent session id, title.
- **About:** a description of at most three bullets an agent writes from the transcript, and when
  it was last written.
- **When:** first seen, last seen, and ended (when its pane or its agent session id went away
  while the PC was connected). An agent session seen again after it ended is open again.

Links tie agent sessions to pull requests and Linear issues, many to many in both cases. Each link
says who made it (`agent`, `manual` or `rule`) and why. Removing a link keeps it as `rejected`, so
an automatic run does not add it back.

## Agents

The `agent-sessions` skill (`skills/agent-sessions/SKILL.md`) tells an agent how to describe and
link agent sessions through `/api/agent-sessions`: it reads each transcript where it lives, writes
the description, and links the pull requests and Linear issues it finds evidence for.
