/**
 * The agent session record (docs/agent-sessions.md): what the hub saw of each agent session and
 * the pull requests and Linear issues it is linked to. An agent session is one agent
 * conversation (Claude Code, Codex); a herdr session is the herdr server on a PC.
 *
 *  GET    /api/agent-sessions                         -> { agent_sessions: AgentSessionRecord[] }
 *  GET    /api/agent-sessions/:id                     -> { agent_session: AgentSessionRecord }
 *  POST   /api/agent-sessions/:id/links   LinkRequest -> { agent_session: AgentSessionRecord }
 *  DELETE /api/agent-sessions/:id/links   LinkTarget  -> { agent_session: AgentSessionRecord }
 */

export type LinkSource = "agent" | "manual" | "rule";
export type LinkStatus = "linked" | "rejected";

export interface PullRequestLink {
  url: string;
  /** owner/name */
  repo: string;
  number: number;
  title: string | null;
  state: string | null;
  status: LinkStatus;
  source: LinkSource;
  reason: string | null;
  linked_at: string;
}

export interface LinearIssueLink {
  identifier: string;
  url: string | null;
  title: string | null;
  state: string | null;
  status: LinkStatus;
  source: LinkSource;
  reason: string | null;
  linked_at: string;
}

export interface AgentSessionRecord {
  id: number;
  /** the hub's id for the PC entry (one per PC and herdr session) */
  machine_id: string;
  machine_name: string;
  host: string;
  /** the herdr session the agent ran in; null on the hub's own PC */
  herdr_session: string | null;
  /** the agent kind: claude, codex, ... */
  agent: string;
  /** the agent's own id for the conversation, which resumes it; `pane:<terminal>` when the agent reports none */
  agent_session_id: string;
  agent_session_kind: "id" | "path" | "pane";
  pane_id: string | null;
  workspace_id: string | null;
  workspace_label: string | null;
  repo: string | null;
  branch: string | null;
  cwd: string | null;
  title: string | null;
  first_seen_at: string;
  last_seen_at: string;
  /** when it left its pane while the PC was connected; null while it runs */
  ended_at: string | null;
  /** the shell command that resumes it on its PC, in its folder; null for an agent this app cannot resume */
  resume_command: string | null;
  pull_requests: PullRequestLink[];
  linear_issues: LinearIssueLink[];
}

/** A link to make: a pull request by URL, or a Linear issue by id. */
export type LinkTarget =
  | { kind: "pull_request"; url: string }
  | { kind: "linear_issue"; identifier: string };

export type LinkRequest = LinkTarget & { source?: LinkSource; reason?: string };

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** owner/name and number of a GitHub pull request URL, with the URL in its plain form; null for anything else. */
export function parsePullRequestUrl(url: string): { url: string; repo: string; number: number } | null {
  const match = PR_URL.exec(url.trim());
  if (!match) return null;
  const repo = `${match[1]}/${match[2]}`;
  const number = Number(match[3]);
  return { url: `https://github.com/${repo}/pull/${number}`, repo, number };
}

/** A Linear issue id, upper-cased; null when it is not one. */
export function parseLinearIdentifier(identifier: string): string | null {
  const value = identifier.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6}$/.test(value) ? value : null;
}

/** The body of a link request, checked; null when malformed. */
export function linkRequestBody(raw: unknown): LinkRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const given = body["source"];
  if (given !== undefined && given !== "agent" && given !== "manual" && given !== "rule") return null;
  const source: LinkSource | undefined = given;
  const reason = typeof body["reason"] === "string" ? body["reason"].slice(0, 500) : undefined;
  const extra = { ...(source === undefined ? {} : { source }), ...(reason === undefined ? {} : { reason }) };
  if (body["kind"] === "pull_request" && typeof body["url"] === "string") {
    const pr = parsePullRequestUrl(body["url"]);
    return pr === null ? null : { kind: "pull_request", url: pr.url, ...extra };
  }
  if (body["kind"] === "linear_issue" && typeof body["identifier"] === "string") {
    const identifier = parseLinearIdentifier(body["identifier"]);
    return identifier === null ? null : { kind: "linear_issue", identifier, ...extra };
  }
  return null;
}

/** The command that resumes an agent session in its folder, for the agents whose CLI can. */
export function resumeCommand(agent: string, agentSessionId: string, kind: AgentSessionRecord["agent_session_kind"], cwd: string | null): string | null {
  if (kind !== "id" || !/^[\w-]+$/.test(agentSessionId)) return null;
  const run = agent === "claude" ? `claude --resume ${agentSessionId}` : agent === "codex" ? `codex resume ${agentSessionId}` : null;
  if (run === null) return null;
  return cwd ? `cd ${shellQuote(cwd)} && ${run}` : run;
}

function shellQuote(value: string): string {
  return /^[\w./~-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** A link an automatic run may make, and what points to it. GET /api/agent-sessions/:id/suggestions -> { suggestions } */
export type LinkSuggestion = (
  | { kind: "pull_request"; url: string; title: string | null; state: string | null }
  | { kind: "linear_issue"; identifier: string; url: string | null; title: string | null; state: string | null }
) & { evidence: string };
