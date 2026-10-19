/**
 * The agent session record (docs/agent-sessions.md): one SQLite file in the state dir with every
 * agent session the hub saw, when, where and how to resume it, and its links to pull requests and
 * Linear issues. Metadata only: no transcript is stored.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  parsePullRequestUrl, resumeCommand,
  type AgentSessionRecord, type LinearIssueLink, type LinkRequest, type LinkSource, type LinkTarget, type PullRequestLink,
} from "../shared/agent-sessions.ts";

/** What one snapshot says of an agent session that runs now. */
export interface AgentSessionSighting {
  machine_id: string;
  machine_name: string;
  host: string;
  herdr_session: string | null;
  agent: string;
  agent_session_id: string;
  agent_session_kind: AgentSessionRecord["agent_session_kind"];
  pane_id: string;
  workspace_id: string;
  workspace_label: string;
  repo: string;
  /** null keeps the branch recorded before: it is looked up apart from the snapshot */
  branch: string | null;
  cwd: string | null;
  title: string | null;
}

/** Pull request facts learned when linking, kept on the pull request's row. */
export interface PullRequestFacts { title?: string | null; state?: string | null }
export interface LinearIssueFacts { url?: string | null; title?: string | null; state?: string | null }

const SCHEMA = [
  `CREATE TABLE agent_sessions (
    id INTEGER PRIMARY KEY,
    machine_id TEXT NOT NULL,
    machine_name TEXT NOT NULL,
    host TEXT NOT NULL,
    herdr_session TEXT,
    agent TEXT NOT NULL,
    agent_session_id TEXT NOT NULL,
    agent_session_kind TEXT NOT NULL CHECK (agent_session_kind IN ('id', 'path', 'pane')),
    pane_id TEXT,
    workspace_id TEXT,
    workspace_label TEXT,
    repo TEXT,
    branch TEXT,
    cwd TEXT,
    title TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ended_at TEXT,
    UNIQUE (machine_id, agent, agent_session_id)
  )`,
  `CREATE TABLE pull_requests (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT,
    state TEXT
  )`,
  `CREATE TABLE linear_issues (
    id INTEGER PRIMARY KEY,
    identifier TEXT NOT NULL UNIQUE,
    url TEXT,
    title TEXT,
    state TEXT
  )`,
  `CREATE TABLE agent_session_pull_requests (
    agent_session INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    pull_request INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('linked', 'rejected')),
    source TEXT NOT NULL CHECK (source IN ('agent', 'manual', 'rule')),
    reason TEXT,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (agent_session, pull_request)
  )`,
  `CREATE TABLE agent_session_linear_issues (
    agent_session INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    linear_issue INTEGER NOT NULL REFERENCES linear_issues(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('linked', 'rejected')),
    source TEXT NOT NULL CHECK (source IN ('agent', 'manual', 'rule')),
    reason TEXT,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (agent_session, linear_issue)
  )`,
  "CREATE INDEX agent_sessions_open ON agent_sessions (machine_id) WHERE ended_at IS NULL",
];

type Row = Omit<AgentSessionRecord, "resume_command" | "pull_requests" | "linear_issues">;

export class AgentSessionStore {
  private db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version === 0) {
      this.db.transaction(() => {
        for (const statement of SCHEMA) this.db.exec(statement);
        this.db.exec("PRAGMA user_version = 1");
      })();
    }
  }

  close(): void { this.db.close(); }

  /**
   * Records what one connected PC entry runs now: each sighting is seen at `now` (and open again
   * if it had ended), and every other open agent session of that PC entry ends at `now`.
   */
  observe(machineId: string, sightings: readonly AgentSessionSighting[], now: Date = new Date()): void {
    const at = now.toISOString();
    const upsert = this.db.query(`INSERT INTO agent_sessions (machine_id, machine_name, host, herdr_session, agent, agent_session_id, agent_session_kind,
        pane_id, workspace_id, workspace_label, repo, branch, cwd, title, first_seen_at, last_seen_at, ended_at)
      VALUES ($machine_id, $machine_name, $host, $herdr_session, $agent, $agent_session_id, $agent_session_kind,
        $pane_id, $workspace_id, $workspace_label, $repo, $branch, $cwd, $title, $at, $at, NULL)
      ON CONFLICT (machine_id, agent, agent_session_id) DO UPDATE SET
        machine_name = excluded.machine_name, host = excluded.host, herdr_session = excluded.herdr_session, pane_id = excluded.pane_id,
        workspace_id = excluded.workspace_id, workspace_label = excluded.workspace_label, repo = excluded.repo,
        branch = COALESCE(excluded.branch, branch), cwd = COALESCE(excluded.cwd, cwd), title = COALESCE(excluded.title, title),
        last_seen_at = excluded.last_seen_at, ended_at = NULL
      RETURNING id`);
    this.db.transaction(() => {
      const seen: number[] = [];
      for (const sighting of sightings) {
        if (sighting.machine_id !== machineId) continue;
        const row = upsert.get({ ...sighting, at }) as { id: number };
        seen.push(row.id);
      }
      this.db.query(`UPDATE agent_sessions SET ended_at = $at WHERE machine_id = $machine_id AND ended_at IS NULL
        AND id NOT IN (SELECT value FROM json_each($seen))`).run({ at, machine_id: machineId, seen: JSON.stringify(seen) });
    })();
  }

  list(): AgentSessionRecord[] {
    const rows = this.db.query("SELECT * FROM agent_sessions ORDER BY COALESCE(ended_at, '9999') DESC, last_seen_at DESC").all() as Row[];
    const prs = this.pullRequestLinks(null);
    const issues = this.linearIssueLinks(null);
    return rows.map((row) => this.record(row, prs.get(row.id) ?? [], issues.get(row.id) ?? []));
  }

  get(id: number): AgentSessionRecord | null {
    const row = this.db.query("SELECT * FROM agent_sessions WHERE id = $id").get({ id }) as Row | null;
    if (row === null) return null;
    return this.record(row, this.pullRequestLinks(id).get(id) ?? [], this.linearIssueLinks(id).get(id) ?? []);
  }

  /** Links an agent session; a link made again takes the new source and reason and counts as linked. */
  link(id: number, request: LinkRequest, facts: PullRequestFacts & LinearIssueFacts = {}, now: Date = new Date()): AgentSessionRecord | null {
    return this.setLink(id, request, "linked", request.source ?? "manual", request.reason ?? null, facts, now);
  }

  /** Marks a link rejected, so an automatic run does not make it again; an unknown one is recorded rejected. */
  unlink(id: number, target: LinkTarget, now: Date = new Date()): AgentSessionRecord | null {
    return this.setLink(id, target, "rejected", "manual", null, {}, now);
  }

  private setLink(id: number, target: LinkTarget, status: "linked" | "rejected", source: LinkSource, reason: string | null,
    facts: PullRequestFacts & LinearIssueFacts, now: Date): AgentSessionRecord | null {
    if (this.db.query("SELECT 1 FROM agent_sessions WHERE id = $id").get({ id }) === null) return null;
    const at = now.toISOString();
    this.db.transaction(() => {
      if (target.kind === "pull_request") {
        const pr = parsePullRequestUrl(target.url);
        if (pr === null) throw new Error("not a GitHub pull request URL");
        const { id: prId } = this.db.query(`INSERT INTO pull_requests (url, repo, number, title, state) VALUES ($url, $repo, $number, $title, $state)
          ON CONFLICT (url) DO UPDATE SET title = COALESCE(excluded.title, title), state = COALESCE(excluded.state, state) RETURNING id`)
          .get({ ...pr, title: facts.title ?? null, state: facts.state ?? null }) as { id: number };
        this.db.query(`INSERT INTO agent_session_pull_requests (agent_session, pull_request, status, source, reason, linked_at)
          VALUES ($id, $pr, $status, $source, $reason, $at)
          ON CONFLICT (agent_session, pull_request) DO UPDATE SET status = excluded.status, source = excluded.source, reason = excluded.reason, linked_at = excluded.linked_at`)
          .run({ id, pr: prId, status, source, reason, at });
      } else {
        const { id: issueId } = this.db.query(`INSERT INTO linear_issues (identifier, url, title, state) VALUES ($identifier, $url, $title, $state)
          ON CONFLICT (identifier) DO UPDATE SET url = COALESCE(excluded.url, url), title = COALESCE(excluded.title, title), state = COALESCE(excluded.state, state) RETURNING id`)
          .get({ identifier: target.identifier, url: facts.url ?? null, title: facts.title ?? null, state: facts.state ?? null }) as { id: number };
        this.db.query(`INSERT INTO agent_session_linear_issues (agent_session, linear_issue, status, source, reason, linked_at)
          VALUES ($id, $issue, $status, $source, $reason, $at)
          ON CONFLICT (agent_session, linear_issue) DO UPDATE SET status = excluded.status, source = excluded.source, reason = excluded.reason, linked_at = excluded.linked_at`)
          .run({ id, issue: issueId, status, source, reason, at });
      }
    })();
    return this.get(id);
  }

  private record(row: Row, pull_requests: PullRequestLink[], linear_issues: LinearIssueLink[]): AgentSessionRecord {
    return { ...row, resume_command: resumeCommand(row.agent, row.agent_session_id, row.agent_session_kind, row.cwd), pull_requests, linear_issues };
  }

  private pullRequestLinks(only: number | null): Map<number, PullRequestLink[]> {
    const rows = this.db.query(`SELECT l.agent_session, p.url, p.repo, p.number, p.title, p.state, l.status, l.source, l.reason, l.linked_at
      FROM agent_session_pull_requests l JOIN pull_requests p ON p.id = l.pull_request
      WHERE $only IS NULL OR l.agent_session = $only ORDER BY l.linked_at`).all({ only }) as Array<PullRequestLink & { agent_session: number }>;
    return group(rows);
  }

  private linearIssueLinks(only: number | null): Map<number, LinearIssueLink[]> {
    const rows = this.db.query(`SELECT l.agent_session, i.identifier, i.url, i.title, i.state, l.status, l.source, l.reason, l.linked_at
      FROM agent_session_linear_issues l JOIN linear_issues i ON i.id = l.linear_issue
      WHERE $only IS NULL OR l.agent_session = $only ORDER BY l.linked_at`).all({ only }) as Array<LinearIssueLink & { agent_session: number }>;
    return group(rows);
  }
}

function group<T extends { agent_session: number }>(rows: T[]): Map<number, Array<Omit<T, "agent_session">>> {
  const byId = new Map<number, Array<Omit<T, "agent_session">>>();
  for (const { agent_session, ...link } of rows) byId.set(agent_session, [...(byId.get(agent_session) ?? []), link]);
  return byId;
}
