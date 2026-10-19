---
name: agent-sessions
description: Describe and link the agent sessions the herdr web UI hub records - a three-line summary of what each is about, and links to the GitHub pull requests and Linear issues it worked on. Use when asked to describe, summarize, link, connect or tidy agent sessions, to say which agent sessions worked on a PR or Linear issue, or on a scheduled run.
---

# Describe and link agent sessions

The herdr web UI hub records every **agent session** it sees: one Claude Code or Codex
conversation, with its agent session id, PC, **herdr session** (the herdr server on that PC, like
`private`), repo, branch, folder, and when it was first seen, last seen and ended. You have two
jobs, done in the same read of each transcript:

- **Describe:** write a short description of what the agent session is about.
- **Link:** link it to the pull requests and Linear issues it worked on. Links are many to many:
  several agent sessions can share a PR, and one agent session can have several PRs and issues.

The hub stores metadata only. Read a transcript to decide, never copy it into a link or a
description.

## The API

`HUB` is the hub's URL: `$HERDR_WEB_HUB_URL`, else `http://127.0.0.1:7320` on the hub's own
PC. From another PC on the tailnet, use the hub's tailnet URL. Only the owner's tailnet identity
gets in; nothing needs a token.

```bash
HUB="${HERDR_WEB_HUB_URL:-http://127.0.0.1:7320}"
curl -s "$HUB/api/agent-sessions" | jq '.agent_sessions[] | {id, agent, host, herdr_session, repo, branch, title, ended_at, prs: [.pull_requests[] | select(.status == "linked") | .url], issues: [.linear_issues[] | select(.status == "linked") | .identifier]}'
curl -s "$HUB/api/agent-sessions/<id>"              # one agent session with its links
curl -s "$HUB/api/agent-sessions/<id>/suggestions"  # candidates with their evidence
curl -s -X POST "$HUB/api/agent-sessions/<id>/links" -H 'content-type: application/json' \
  -d '{"kind":"pull_request","url":"https://github.com/<owner>/<repo>/pull/<n>","source":"agent","reason":"<one line: why>"}'
curl -s -X POST "$HUB/api/agent-sessions/<id>/links" -H 'content-type: application/json' \
  -d '{"kind":"linear_issue","identifier":"ENG-123","source":"agent","reason":"<one line: why>"}'
curl -s -X PUT "$HUB/api/agent-sessions/<id>/description" -H 'content-type: application/json' \
  -d "$(jq -n --arg d $'- **Goal:** ...\n- **Done:** ...\n- **Open:** ...' '{description: $d}')"
curl -s -X DELETE "$HUB/api/agent-sessions/<id>/links" -H 'content-type: application/json' \
  -d '{"kind":"pull_request","url":"https://github.com/<owner>/<repo>/pull/<n>"}'
```

A link has a `status`: `linked`, or `rejected` once someone removed it. Never link again what is
rejected: a person decided it was wrong.

## The description

At most three Markdown bullets, each led by a bold word or two, one line each, for a person
scanning many agent sessions at once. Say what the agent session is for and where it stands,
not how it got there:

```markdown
- **Goal:** move the hub's redirect to the tailnet-only grid
- **Done:** DNS record and Caddy redirect merged (svintruberget#29)
- **Open:** schedule for the linking run
```

Use plain words, no filler, no file dumps. The hub refuses more than three lines or 600
characters. Write it again when the agent session has moved on: `description_updated_at` says
when it was last written, and `last_seen_at` when the agent session last ran.

## The run

1. List the agent sessions. Work on those with no description, or whose description is older
   than their last activity, and those with no linked PR or issue, newest first; also any the
   user names.
2. For each, take the suggestions. They come from rules: a PR whose head is the agent session's
   branch, and a Linear id that a linked PR's title starts with.
3. Read the transcript to confirm the suggestions, find the rest, and see what it is about:
   - **Still running** (`ended_at` is null): `curl -s "$HUB/api/machines/<machine_id>/pane/conversation?pane_id=<pane_id>"`;
     on the hub's own PC (`machine_id` is `local`) use `$HUB/api/pane/conversation?pane_id=<pane_id>`.
     That is the newest page only: while the answer's `cursor` is not null, add `&before=<cursor>`
     for the page before it, until you have what you need.
   - **Ended:** the transcript is on its PC. For Claude Code it is
     `~/.claude/projects/<cwd, every character but letters and digits as ->/<agent_session_id>.jsonl`; reach the PC with
     `tailscale ssh <user>@<host>`.
   - Look for PR URLs the agent opened, pushed to or reviewed, `gh pr create` output, and Linear
     ids named in the conversation (`ENG-123`).
4. Write the description (see above).
5. Link what the evidence supports, with `"source":"agent"` and a one-line reason that names the
   evidence ("opened it with gh pr create", "branch head", "the user asked to fix ENG-123").
   A PR that was only mentioned in passing is not worked on: leave it.
6. Report what you described and linked, and what you left, with the reason for each.

When unsure, do not link. A missing link costs a click; a wrong one misleads.
