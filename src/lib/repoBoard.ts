/** The Repos board's numbers: one entry per repo, from the grid's tiles and the agent session records. */

import type { AgentSessionRecord } from "../../shared/agent-sessions.ts";
import type { GridTile } from "./agentGrid.ts";
import { openAgentSessionsByPane } from "./agentSessions.ts";
import { paneStatus, type KnownStatus } from "./status.ts";

/** The statuses in the order a card lists them: what needs a person first. */
export const REPO_STATUSES: readonly KnownStatus[] = ["blocked", "working", "waiting", "done", "idle", "unknown"];

/** The statuses of an agent that is in a turn: asking for input, at work, or waiting on its turn's background work. */
const ACTIVE: ReadonlySet<KnownStatus> = new Set(["blocked", "working", "waiting"]);

/** The agent's status in the sidebar's terms; background work keeps a finished turn waiting. */
export function tileStatus(tile: GridTile): KnownStatus {
  const { pane, agent } = tile.entry;
  return paneStatus({ agent_status: agent?.agent_status ?? pane.agent_status, background_wait: pane.background_wait });
}

/** blocked needs input; active is working or waiting; inactive is done, idle or unknown. */
export type StatusClass = "blocked" | "active" | "inactive";

export const statusClass = (status: KnownStatus): StatusClass => (status === "blocked" ? "blocked" : ACTIVE.has(status) ? "active" : "inactive");

/** The herdr session an agent runs in: its name, else `@host` for the machine's own default session. */
export const sessionKey = (tile: GridTile): string => tile.herdrSession ?? `@${tile.host}`;

export const sessionLabel = (key: string): string => (key.startsWith("@") ? key.slice(1) : key);

export interface RepoAgent {
  tile: GridTile;
  status: KnownStatus;
}

export interface RepoStats {
  repo: string;
  total: number;
  counts: Record<KnownStatus, number>;
  /** agents in a turn (blocked, working, waiting); the rest are inactive */
  active: number;
  inactive: number;
  /** the repo's agents in the card's status order, sidebar order within a status */
  agents: RepoAgent[];
  /** distinct machines */
  hosts: number;
  /** the herdr session keys the agents run in (see sessionKey), sorted */
  sessions: string[];
  /** distinct workspaces: the same workspace id on two PCs is two */
  workspaces: number;
  pullRequests: number;
  issues: number;
}

/** Each repo's agents by status, machines, workspaces and links, the ones that need attention first. */
export function repoStats(tiles: readonly GridTile[], records: readonly AgentSessionRecord[]): RepoStats[] {
  const recordByPane = openAgentSessionsByPane(records);
  const groups = new Map<string, { stats: RepoStats; hosts: Set<string>; sessions: Set<string>; workspaces: Set<string>; pullRequests: Set<string>; issues: Set<string> }>();
  for (const tile of tiles) {
    let group = groups.get(tile.repo);
    if (!group) {
      const counts = Object.fromEntries(REPO_STATUSES.map((status) => [status, 0])) as Record<KnownStatus, number>;
      group = { stats: { repo: tile.repo, total: 0, counts, active: 0, inactive: 0, agents: [], hosts: 0, sessions: [], workspaces: 0, pullRequests: 0, issues: 0 }, hosts: new Set(), sessions: new Set(), workspaces: new Set(), pullRequests: new Set(), issues: new Set() };
      groups.set(tile.repo, group);
    }
    const status = tileStatus(tile);
    group.stats.total += 1;
    group.stats.counts[status] += 1;
    group.stats[ACTIVE.has(status) ? "active" : "inactive"] += 1;
    group.stats.agents.push({ tile, status });
    group.hosts.add(tile.host);
    group.sessions.add(sessionKey(tile));
    group.workspaces.add(`${tile.machine.id}:${tile.entry.workspace.workspace_id}`);
    const record = recordByPane.get(tile.key);
    for (const link of record?.pull_requests ?? []) if (link.status === "linked") group.pullRequests.add(link.url);
    for (const link of record?.linear_issues ?? []) if (link.status === "linked") group.issues.add(link.identifier);
  }
  return [...groups.values()]
    .map(({ stats, hosts, sessions, workspaces, pullRequests, issues }) => ({
      ...stats,
      agents: stats.agents.sort((a, b) => REPO_STATUSES.indexOf(a.status) - REPO_STATUSES.indexOf(b.status)),
      hosts: hosts.size, sessions: [...sessions].sort((a, b) => a.localeCompare(b)), workspaces: workspaces.size, pullRequests: pullRequests.size, issues: issues.size,
    }))
    .sort((a, b) => b.counts.blocked - a.counts.blocked || b.counts.working - a.counts.working || a.repo.localeCompare(b.repo));
}

/** Theme tokens every palette defines with a readable contrast, so a repo color works in dark and light. */
export const REPO_COLORS = ["--syntax-function", "--syntax-string", "--syntax-number", "--syntax-type", "--syntax-keyword", "--syntax-variable", "--syntax-meta"] as const;

/** A repo's color as a CSS value: the same name always gives the same token (two names may share one). */
export function repoColor(repo: string): string {
  let hash = 2166136261;
  for (let i = 0; i < repo.length; i++) hash = Math.imul(hash ^ repo.charCodeAt(i), 16777619);
  return `var(${REPO_COLORS[(hash >>> 0) % REPO_COLORS.length]})`;
}

export interface RepoFilter {
  query: string;
  status: "all" | StatusClass;
  /** session keys; empty is all */
  sessions: string[];
  /** hosts; empty is all */
  machines: string[];
}

export const EMPTY_REPO_FILTER: RepoFilter = { query: "", status: "all", sessions: [], machines: [] };

/** Whether any of the filter's narrowing parts is set. */
export const isFiltered = (filter: RepoFilter): boolean => filter.query.trim() !== "" || filter.status !== "all" || filter.sessions.length > 0 || filter.machines.length > 0;

/** The tiles a filter keeps; `skip` leaves one part out, for the counts a chip row shows beside its own choice. */
export function filterTiles(tiles: readonly GridTile[], filter: RepoFilter, skip?: "status" | "sessions" | "machines"): GridTile[] {
  const query = filter.query.trim().toLowerCase();
  return tiles.filter((tile) => {
    if (skip !== "status" && filter.status !== "all" && statusClass(tileStatus(tile)) !== filter.status) return false;
    if (skip !== "sessions" && filter.sessions.length > 0 && !filter.sessions.includes(sessionKey(tile))) return false;
    if (skip !== "machines" && filter.machines.length > 0 && !filter.machines.includes(tile.host)) return false;
    if (!query) return true;
    const { pane, agent, workspace, agentLabel } = tile.entry;
    return [tile.repo, workspace.label, pane.title, pane.label, agent?.title, agent?.name, agentLabel, sessionLabel(sessionKey(tile)), tile.host]
      .some((text) => text?.toLowerCase().includes(query));
  });
}

/** How many tiles are in each status class. */
export function statusCounts(tiles: readonly GridTile[]): Record<StatusClass, number> {
  const counts: Record<StatusClass, number> = { blocked: 0, active: 0, inactive: 0 };
  for (const tile of tiles) counts[statusClass(tileStatus(tile))] += 1;
  return counts;
}

export type GroupBy = "none" | "session" | "machine" | "attention";

export interface RepoGroup {
  key: string;
  label: string;
  repos: RepoStats[];
  totals: { agents: number; active: number; blocked: number };
}

const ATTENTION_LABELS: Record<StatusClass, string> = { blocked: "Needs input", active: "Active", inactive: "Inactive" };

function toGroup(key: string, label: string, repos: RepoStats[]): RepoGroup {
  const sum = (pick: (stats: RepoStats) => number): number => repos.reduce((total, stats) => total + pick(stats), 0);
  return { key, label, repos, totals: { agents: sum((stats) => stats.total), active: sum((stats) => stats.active), blocked: sum((stats) => stats.counts.blocked) } };
}

/** The repos in groups, a group's numbers counting only its own agents; the groups that need people first. */
export function groupRepos(tiles: readonly GridTile[], records: readonly AgentSessionRecord[], groupBy: GroupBy): RepoGroup[] {
  const byKey = (key: (tile: GridTile) => string, label: (key: string) => string): RepoGroup[] => {
    const buckets = new Map<string, GridTile[]>();
    for (const tile of tiles) {
      const name = key(tile);
      buckets.set(name, [...(buckets.get(name) ?? []), tile]);
    }
    return [...buckets].map(([name, members]) => toGroup(name, label(name), repoStats(members, records)));
  };
  let groups: RepoGroup[];
  if (groupBy === "none") groups = tiles.length === 0 ? [] : [toGroup("all", "", repoStats(tiles, records))];
  else if (groupBy === "session") groups = byKey(sessionKey, sessionLabel);
  else if (groupBy === "machine") groups = byKey((tile) => tile.host, (host) => host);
  else {
    const classes: Record<StatusClass, RepoStats[]> = { blocked: [], active: [], inactive: [] };
    for (const stats of repoStats(tiles, records)) classes[stats.counts.blocked > 0 ? "blocked" : stats.active > 0 ? "active" : "inactive"].push(stats);
    groups = (Object.keys(classes) as StatusClass[]).filter((key) => classes[key].length > 0).map((key) => toGroup(key, ATTENTION_LABELS[key], classes[key]));
  }
  return groups.sort((a, b) => b.totals.blocked - a.totals.blocked || b.totals.active - a.totals.active || b.totals.agents - a.totals.agents || a.label.localeCompare(b.label));
}

export interface Choice { key: string; label: string; agents: number; active: number }

/** The sessions and machines the tiles cover, with their agent counts, for the filter chips. */
export function choices(tiles: readonly GridTile[]): { sessions: Choice[]; machines: Choice[] } {
  const tally = (key: (tile: GridTile) => string, label: (key: string) => string): Choice[] => {
    const found = new Map<string, Choice>();
    for (const tile of tiles) {
      const name = key(tile);
      const choice = found.get(name) ?? { key: name, label: label(name), agents: 0, active: 0 };
      choice.agents += 1;
      if (statusClass(tileStatus(tile)) !== "inactive") choice.active += 1;
      found.set(name, choice);
    }
    return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  return { sessions: tally(sessionKey, sessionLabel), machines: tally((tile) => tile.host, (host) => host) };
}

/** A saved filter: sessions, machines and status, under a name. It travels in the shared preferences. */
export interface RepoScope {
  id: string;
  name: string;
  sessions: string[];
  machines: string[];
  status: RepoFilter["status"];
}

export const MAX_REPO_SCOPES = 12;
const MAX_SCOPE_NAME = 40;
// the scopes travel in the shared preferences, which the server caps as a whole, so every limit stays small
const MAX_SCOPE_ENTRIES = 16;
const MAX_TEXT = 64;
// what this browser keeps for itself has no such cap: every choice the board offers comes back
const MAX_KEPT_ENTRIES = 500;
const STATUSES: ReadonlySet<unknown> = new Set(["all", "blocked", "active", "inactive"]);

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT ? value : null);
const list = (value: unknown, max = MAX_SCOPE_ENTRIES, length = MAX_TEXT): string[] => (Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= length).slice(0, max)
  : []);

/** The saved scopes as stored or sent by another browser, cut to the shape and the limits. */
export function sanitizeRepoScopes(raw: unknown): RepoScope[] {
  if (!Array.isArray(raw)) return [];
  const scopes: RepoScope[] = [];
  for (const value of raw) {
    if (scopes.length >= MAX_REPO_SCOPES) break;
    if (typeof value !== "object" || value === null) continue;
    const scope = value as Record<string, unknown>;
    const id = text(scope["id"]);
    if (id === null || scopes.some((other) => other.id === id)) continue;
    scopes.push({
      id,
      name: (typeof scope["name"] === "string" ? scope["name"] : "").slice(0, MAX_SCOPE_NAME),
      sessions: list(scope["sessions"]),
      machines: list(scope["machines"]),
      status: STATUSES.has(scope["status"]) ? (scope["status"] as RepoFilter["status"]) : "all",
    });
  }
  return scopes;
}

/** Whether the filter's sessions, machines and status are exactly the scope's (order aside). */
export function matchesScope(filter: RepoFilter, scope: RepoScope): boolean {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((entry) => b.includes(entry));
  return filter.status === scope.status && same(filter.sessions, scope.sessions) && same(filter.machines, scope.machines);
}

const BOARD_KEY = "herdr-web-ui:repo-board";

export interface RepoBoardState { filter: RepoFilter; groupBy: GroupBy; scopeId: string | null }

const GROUPS: ReadonlySet<unknown> = new Set(["none", "session", "machine", "attention"]);

/** This browser's last filter, grouping and scope; the defaults when none is kept or storage fails. */
export function loadRepoBoardState(): RepoBoardState {
  const state: RepoBoardState = { filter: EMPTY_REPO_FILTER, groupBy: "none", scopeId: null };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(BOARD_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return state;
    const record = raw as Record<string, unknown>;
    const filter = (typeof record["filter"] === "object" && record["filter"] !== null ? record["filter"] : {}) as Record<string, unknown>;
    return {
      filter: {
        query: typeof filter["query"] === "string" ? filter["query"] : "",
        status: STATUSES.has(filter["status"]) ? (filter["status"] as RepoFilter["status"]) : "all",
        sessions: list(filter["sessions"], MAX_KEPT_ENTRIES, 300),
        machines: list(filter["machines"], MAX_KEPT_ENTRIES, 300),
      },
      groupBy: GROUPS.has(record["groupBy"]) ? (record["groupBy"] as GroupBy) : "none",
      scopeId: typeof record["scopeId"] === "string" ? record["scopeId"] : null,
    };
  } catch {
    return state;
  }
}

export function storeRepoBoardState(state: RepoBoardState): void {
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(state)); } catch { /* per-browser convenience only */ }
}
