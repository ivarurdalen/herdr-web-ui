/** The Repos board's numbers: one entry per repo, from the grid's tiles and the agent session records. */

import type { AgentSessionRecord } from "../../shared/agent-sessions.ts";
import type { GridTile } from "./agentGrid.ts";
import { openAgentSessionsByPane } from "./agentSessions.ts";
import { paneStatus, type KnownStatus } from "./status.ts";

/** The statuses in the order a card lists them: what needs a person first. */
export const REPO_STATUSES: readonly KnownStatus[] = ["blocked", "working", "waiting", "done", "idle", "unknown"];

export interface RepoStats {
  repo: string;
  total: number;
  counts: Record<KnownStatus, number>;
  /** distinct PCs */
  hosts: number;
  /** distinct workspaces: the same workspace id on two PCs is two */
  workspaces: number;
  pullRequests: number;
  issues: number;
}

/** Each repo's agents by status, PCs, workspaces and links, the ones that need attention first. */
export function repoStats(tiles: readonly GridTile[], records: readonly AgentSessionRecord[]): RepoStats[] {
  const recordByPane = openAgentSessionsByPane(records);
  const groups = new Map<string, { stats: RepoStats; hosts: Set<string>; workspaces: Set<string>; pullRequests: Set<string>; issues: Set<string> }>();
  for (const tile of tiles) {
    let group = groups.get(tile.repo);
    if (!group) {
      const counts = Object.fromEntries(REPO_STATUSES.map((status) => [status, 0])) as Record<KnownStatus, number>;
      group = { stats: { repo: tile.repo, total: 0, counts, hosts: 0, workspaces: 0, pullRequests: 0, issues: 0 }, hosts: new Set(), workspaces: new Set(), pullRequests: new Set(), issues: new Set() };
      groups.set(tile.repo, group);
    }
    const { pane, agent } = tile.entry;
    group.stats.total += 1;
    group.stats.counts[paneStatus({ agent_status: agent?.agent_status ?? pane.agent_status, background_wait: pane.background_wait })] += 1;
    group.hosts.add(tile.host);
    group.workspaces.add(`${tile.machine.id}:${tile.entry.workspace.workspace_id}`);
    const record = recordByPane.get(tile.key);
    for (const link of record?.pull_requests ?? []) if (link.status === "linked") group.pullRequests.add(link.url);
    for (const link of record?.linear_issues ?? []) if (link.status === "linked") group.issues.add(link.identifier);
  }
  return [...groups.values()]
    .map(({ stats, hosts, workspaces, pullRequests, issues }) => ({ ...stats, hosts: hosts.size, workspaces: workspaces.size, pullRequests: pullRequests.size, issues: issues.size }))
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
