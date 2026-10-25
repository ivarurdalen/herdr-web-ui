import { describe, expect, it } from "bun:test";
import type { AgentSessionRecord } from "../../shared/agent-sessions.ts";
import type { Machine } from "../../shared/machines.ts";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";
import { gridTiles } from "./agentGrid.ts";
import { REPO_COLORS, repoColor, repoStats } from "./repoBoard.ts";

function pane(id: string, workspace: string, overrides: Partial<HerdrPane> = {}): HerdrPane {
  return { pane_id: id, workspace_id: workspace, tab_id: `${workspace}:t1`, terminal_id: `${id}:term`, revision: 1, focused: false, agent_status: "idle", agent: "claude", ...overrides };
}

/** A PC with workspaces `[id, repo label, panes]`. */
function machine(id: string, workspaces: Array<[string, string, HerdrPane[]]>): Machine {
  const ids = workspaces.map(([workspace]) => workspace);
  const snapshot: SessionSnapshot = {
    protocol: 22, version: "test", layouts: [], agents: [],
    panes: workspaces.flatMap(([, , panes]) => panes),
    workspaces: ids.map((workspace, index) => ({ workspace_id: workspace, active_tab_id: `${workspace}:t1`, label: workspaces[index]![1], number: index + 1, tab_count: 1, pane_count: 1, focused: false, agent_status: "idle" })),
    tabs: ids.map((workspace, index) => ({ tab_id: `${workspace}:t1`, workspace_id: workspace, label: "main", number: index + 1, pane_count: 1, focused: false, agent_status: "idle" })),
  };
  return { id, name: id, kind: "ssh", enabled: true, state: "connected", error: null, snapshot };
}

function record(machineId: string, paneId: string, links: { prs?: string[]; issues?: string[]; rejected?: string[] } = {}): AgentSessionRecord {
  const link = { title: null, state: null, source: "agent" as const, reason: null, linked_at: "2026-01-01T00:00:00Z" };
  return {
    id: 1, machine_id: machineId, machine_name: machineId, host: machineId, herdr_session: null, agent: "claude", agent_session_id: "s", agent_session_kind: "id",
    pane_id: paneId, workspace_id: null, workspace_label: null, repo: null, branch: null, cwd: null, title: null, description: null, description_updated_at: null,
    first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z", ended_at: null, resume_command: null,
    pull_requests: [
      ...(links.prs ?? []).map((url) => ({ ...link, url, repo: "o/r", number: 1, status: "linked" as const })),
      ...(links.rejected ?? []).map((url) => ({ ...link, url, repo: "o/r", number: 2, status: "rejected" as const })),
    ],
    linear_issues: (links.issues ?? []).map((identifier) => ({ ...link, identifier, url: null, status: "linked" as const })),
  };
}

describe("repoStats", () => {
  it("splits agents into active and inactive, and lists them with the ones in a turn first", () => {
    const box = machine("box", [["w1", "r", [
      pane("idle", "w1"), pane("done", "w1", { agent_status: "done" }), pane("bg", "w1", { agent_status: "done", background_wait: true }),
      pane("ask", "w1", { agent_status: "blocked" }), pane("run", "w1", { agent_status: "working" }),
    ]]]);
    const [stats] = repoStats(gridTiles([box]), []);
    expect([stats!.active, stats!.inactive]).toEqual([3, 2]);
    expect(stats!.agents.map(({ tile, status }) => `${tile.entry.pane.pane_id}:${status}`)).toEqual(["ask:blocked", "run:working", "bg:waiting", "done:done", "idle:idle"]);
  });

  it("counts a status per agent, summing to the total, and counts distinct workspaces across PCs", () => {
    // the same workspace id on two PCs is two workspaces
    const a = machine("a", [["w1", "r", [pane("p1", "w1", { agent_status: "working" }), pane("p2", "w1", { agent_status: "blocked" })]]]);
    const b = machine("b", [["w1", "r", [pane("p3", "w1", { agent_status: "done" })]], ["w2", "r", [pane("p4", "w2", { agent_status: "bogus" as never })]]]);
    const [stats] = repoStats(gridTiles([a, b]), []);
    expect(stats).toMatchObject({ total: 4, hosts: 2, workspaces: 3, counts: { blocked: 1, working: 1, waiting: 0, done: 1, idle: 0, unknown: 1 } });
    expect(Object.values(stats!.counts).reduce((sum, n) => sum + n, 0)).toBe(stats!.total);
  });

  it("sorts a repo with a blocked agent before one with only working agents, then by working, then name", () => {
    const box = machine("box", [
      ["w1", "calm", [pane("a", "w1", { agent_status: "working" }), pane("b", "w1", { agent_status: "working" })]],
      ["w2", "stuck", [pane("c", "w2", { agent_status: "blocked" })]],
      ["w3", "alpha", [pane("d", "w3", { agent_status: "idle" })]],
      ["w4", "beta", [pane("e", "w4", { agent_status: "idle" })]],
    ]);
    expect(repoStats(gridTiles([box]), []).map((stats) => stats.repo)).toEqual(["stuck", "calm", "alpha", "beta"]);
  });

  it("counts an agent waiting on background work as waiting, not done or idle", () => {
    const box = machine("box", [["w1", "r", [pane("a", "w1", { agent_status: "done", background_wait: true }), pane("b", "w1", { agent_status: "working", background_wait: true })]]]);
    expect(repoStats(gridTiles([box]), [])[0]!.counts).toMatchObject({ waiting: 1, working: 1, done: 0, idle: 0 });
  });

  it("counts each linked pull request and issue once, from running sessions of the repo only", () => {
    const box = machine("box", [["w1", "r", [pane("a", "w1"), pane("b", "w1")]], ["w2", "other", [pane("c", "w2")]]]);
    const records = [
      record("box", "a", { prs: ["https://github.com/o/r/pull/1"], issues: ["EXA-1"], rejected: ["https://github.com/o/r/pull/2"] }),
      record("box", "b", { prs: ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/3"], issues: ["EXA-1", "EXA-2"] }),
      record("box", "c", { prs: ["https://github.com/o/r/pull/9"] }),
      { ...record("box", "a", { prs: ["https://github.com/o/r/pull/4"] }), ended_at: "2026-01-02T00:00:00Z" },
    ];
    const byRepo = Object.fromEntries(repoStats(gridTiles([box]), records).map((stats) => [stats.repo, stats]));
    expect(byRepo["r"]).toMatchObject({ pullRequests: 2, issues: 2 });
    expect(byRepo["other"]).toMatchObject({ pullRequests: 1, issues: 0 });
  });
});

describe("repoColor", () => {
  it("gives a name the same listed token every time", () => {
    for (const name of ["devkit", "estrada", "ovis", "x", ""]) {
      expect(repoColor(name)).toBe(repoColor(name));
      expect(REPO_COLORS.map((token) => `var(${token})`)).toContain(repoColor(name));
    }
  });

  it("spreads names over more than one token", () => {
    expect(new Set(["devkit", "estrada", "ovis", "whisper", "herdr", "exabel"].map(repoColor)).size).toBeGreaterThan(2);
  });
});
