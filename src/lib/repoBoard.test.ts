import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { AgentSessionRecord } from "../../shared/agent-sessions.ts";
import type { Machine } from "../../shared/machines.ts";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";
import { gridTiles } from "./agentGrid.ts";
import {
  choices, EMPTY_REPO_FILTER, filterTiles, groupRepos, loadRepoBoardState, matchesScope, REPO_COLORS, repoColor, repoStats, sanitizeRepoScopes,
  sessionKey, sessionLabel, statusClass, statusCounts, storeRepoBoardState, type RepoFilter,
} from "./repoBoard.ts";

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

/** A machine `name` on `host`, in the herdr session `session` (the hub's own when null), with one workspace per `[repo, status]`. */
function sessionBox(host: string, session: string | null, agents: Array<[string, string]>): Machine {
  const box = machine(`${host}-${session ?? "hub"}`, agents.map(([repo], index) => [`w${index}`, repo, [pane(`p${index}`, `w${index}`, { agent_status: agents[index]![1] as never })]]));
  return { ...box, name: session === null ? host : `${host}/${session}`, ...(session === null ? {} : { target: { destination: host, session } }) } as Machine;
}

describe("the board's scope", () => {
  const tiles = gridTiles([
    sessionBox("laptop", "private", [["ovis", "working"], ["dots", "idle"]]),
    sessionBox("laptop", null, [["ovis", "blocked"]]),
    sessionBox("server", "exabel", [["platform", "working"], ["ovis", "done"]]),
  ]);

  it("names an agent's session, the machine's own default session by its host", () => {
    expect(tiles.map(sessionKey)).toEqual(["private", "private", "@laptop", "exabel", "exabel"]);
    expect(["private", "@laptop"].map(sessionLabel)).toEqual(["private", "laptop"]);
  });

  it("classes a status as needs input, active or inactive", () => {
    expect(["blocked", "working", "waiting", "done", "idle", "unknown"].map((status) => statusClass(status as never))).toEqual(["blocked", "active", "active", "inactive", "inactive", "inactive"]);
    expect(statusCounts(tiles)).toEqual({ blocked: 1, active: 2, inactive: 2 });
  });

  it("lists the repo's sessions, sorted", () => {
    expect(repoStats(tiles, []).find((stats) => stats.repo === "ovis")!.sessions).toEqual(["@laptop", "exabel", "private"]);
  });

  describe("filterTiles", () => {
    const keep = (filter: Partial<RepoFilter>) => filterTiles(tiles, { ...EMPTY_REPO_FILTER, ...filter }).map((tile) => `${tile.repo}@${sessionKey(tile)}`);

    it("keeps everything for an empty filter", () => expect(keep({})).toHaveLength(5));
    it("keeps the chosen sessions, hub session by its key", () => expect(keep({ sessions: ["exabel", "@laptop"] })).toEqual(["ovis@@laptop", "platform@exabel", "ovis@exabel"]));
    it("keeps the chosen machines", () => expect(keep({ machines: ["server"] })).toEqual(["platform@exabel", "ovis@exabel"]));
    it("keeps one status class", () => {
      expect(keep({ status: "blocked" })).toEqual(["ovis@@laptop"]);
      expect(keep({ status: "active" })).toEqual(["ovis@private", "platform@exabel"]);
      expect(keep({ status: "inactive" })).toHaveLength(2);
    });
    it("matches the agent's display label", () => {
      const labelled = tiles.map((tile, index) => (index === 0 ? { ...tile, entry: { ...tile.entry, agentLabel: "Reviewer" } } : tile));
      expect(filterTiles(labelled, { ...EMPTY_REPO_FILTER, query: "review" })).toEqual([labelled[0]!]);
    });

    it("matches the query without case in the repo, the session label or the machine", () => {
      expect(keep({ query: " PLATFORM " })).toEqual(["platform@exabel"]);
      expect(keep({ query: "EXAB" })).toHaveLength(2);
      expect(keep({ query: "server" })).toHaveLength(2);
      expect(keep({ query: "nothing here" })).toEqual([]);
    });
    it("combines the parts", () => expect(keep({ sessions: ["private"], status: "active" })).toEqual(["ovis@private"]));
    it("leaves a part out for the counts beside its own chips", () => {
      expect(filterTiles(tiles, { ...EMPTY_REPO_FILTER, status: "blocked", sessions: ["exabel"] }, "status")).toHaveLength(2);
    });
  });

  describe("groupRepos", () => {
    it("makes one group of everything for none", () => {
      const [group, ...rest] = groupRepos(tiles, [], "none");
      expect(rest).toEqual([]);
      expect(group!.totals).toEqual({ agents: 5, active: 3, blocked: 1 });
      expect(group!.repos.map((stats) => stats.repo)).toEqual(["ovis", "platform", "dots"]);
    });

    it("counts only a session's own agents in its group, and shows a repo in every session it runs in", () => {
      const groups = groupRepos(tiles, [], "session");
      expect(groups.map((group) => group.label)).toEqual(["laptop", "exabel", "private"]);
      const inGroup = (label: string) => Object.fromEntries(groups.find((group) => group.label === label)!.repos.map((stats) => [stats.repo, stats.total]));
      expect(inGroup("exabel")).toEqual({ ovis: 1, platform: 1 });
      expect(inGroup("private")).toEqual({ ovis: 1, dots: 1 });
      expect(inGroup("laptop")).toEqual({ ovis: 1 });
      expect(groups.find((group) => group.label === "exabel")!.totals).toEqual({ agents: 2, active: 1, blocked: 0 });
    });

    it("groups by machine", () => {
      const groups = groupRepos(tiles, [], "machine");
      expect(groups.map((group) => [group.key, group.totals.agents])).toEqual([["laptop", 3], ["server", 2]]);
    });

    it("puts a repo in the first attention group that applies, and drops an empty one", () => {
      const groups = groupRepos(tiles, [], "attention");
      expect(groups.map((group) => [group.label, group.repos.map((stats) => stats.repo)])).toEqual([
        ["Needs input", ["ovis"]], ["Active", ["platform"]], ["Inactive", ["dots"]],
      ]);
      expect(groupRepos(filterTiles(tiles, { ...EMPTY_REPO_FILTER, status: "inactive" }), [], "attention").map((group) => group.key)).toEqual(["inactive"]);
    });

    it("sorts groups by blocked, active, agents, then label", () => {
      const groups = groupRepos(gridTiles([
        sessionBox("a", "zeta", [["r", "idle"]]), sessionBox("a", "alpha", [["r", "idle"]]), sessionBox("a", "busy", [["r", "working"]]), sessionBox("a", "stuck", [["r", "blocked"]]),
      ]), [], "session");
      expect(groups.map((group) => group.label)).toEqual(["stuck", "busy", "alpha", "zeta"]);
    });

    it("returns no group without tiles", () => expect(groupRepos([], [], "none")).toEqual([]));
  });

  it("lists the sessions and machines with their agent and active counts", () => {
    expect(choices(tiles)).toEqual({
      sessions: [{ key: "exabel", label: "exabel", agents: 2, active: 1 }, { key: "@laptop", label: "laptop", agents: 1, active: 1 }, { key: "private", label: "private", agents: 2, active: 1 }],
      machines: [{ key: "laptop", label: "laptop", agents: 3, active: 2 }, { key: "server", label: "server", agents: 2, active: 1 }],
    });
  });
});

describe("sanitizeRepoScopes", () => {
  const scope = { id: "a", name: "Personal", sessions: ["private"], machines: [] as string[], status: "active" as const };

  it("keeps a well-formed scope and drops anything else", () => {
    expect(sanitizeRepoScopes([scope, null, "x", { name: "no id" }, { ...scope, id: "" }])).toEqual([scope]);
    expect(sanitizeRepoScopes("nope")).toEqual([]);
  });

  it("keeps an id once, cuts the count, the name and the lists, and turns an unknown status into all", () => {
    expect(sanitizeRepoScopes([scope, { ...scope, name: "again" }])).toHaveLength(1);
    expect(sanitizeRepoScopes(Array.from({ length: 20 }, (_, index) => ({ ...scope, id: `s${index}` })))).toHaveLength(12);
    const [cut] = sanitizeRepoScopes([{ ...scope, name: "n".repeat(90), sessions: Array.from({ length: 40 }, (_, index) => `s${index}`), machines: ["ok", "x".repeat(301), 4], status: "bogus" }]);
    expect(cut!.name).toHaveLength(40);
    expect(cut!.sessions).toHaveLength(16);
    expect(cut!.machines).toEqual(["ok"]);
    expect(cut!.status).toBe("all");
  });

  it("compares a filter with a scope by content, order aside", () => {
    expect(matchesScope({ ...EMPTY_REPO_FILTER, query: "x", sessions: ["b", "a"], status: "active" }, { ...scope, sessions: ["a", "b"] })).toBe(true);
    expect(matchesScope({ ...EMPTY_REPO_FILTER, sessions: ["a"], status: "active" }, { ...scope, sessions: ["a", "b"] })).toBe(false);
    expect(matchesScope(EMPTY_REPO_FILTER, { ...scope, sessions: [], status: "all" })).toBe(true);
  });
});

describe("the kept board state", () => {
  const stored = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  beforeAll(() => Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) } }));
  afterAll(() => { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); });
  afterEach(() => stored.clear());

  it("reads back what it stored", () => {
    const state = { filter: { query: "q", status: "blocked" as const, sessions: ["a"], machines: ["m"] }, groupBy: "session" as const, scopeId: "s1" };
    storeRepoBoardState(state);
    expect(loadRepoBoardState()).toEqual(state);
  });

  it("keeps every session and machine this browser chose, past the scope limit", () => {
    const many = Array.from({ length: 30 }, (_, index) => `session-${index}`);
    storeRepoBoardState({ filter: { ...EMPTY_REPO_FILTER, sessions: many, machines: many }, groupBy: "none", scopeId: null });
    expect(loadRepoBoardState().filter.sessions).toEqual(many);
  });

  it("falls back to the defaults for nothing, garbage or a bad field", () => {
    const defaults = { filter: EMPTY_REPO_FILTER, groupBy: "none" as const, scopeId: null };
    expect(loadRepoBoardState()).toEqual(defaults);
    stored.set("herdr-web-ui:repo-board", "{oops");
    expect(loadRepoBoardState()).toEqual(defaults);
    stored.set("herdr-web-ui:repo-board", JSON.stringify({ filter: { status: "x", sessions: "no" }, groupBy: "x", scopeId: 3 }));
    expect(loadRepoBoardState()).toEqual(defaults);
  });
});
