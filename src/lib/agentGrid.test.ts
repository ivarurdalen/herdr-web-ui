import { describe, expect, it } from "bun:test";
import type { Machine } from "../../shared/machines.ts";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";
import { DEFAULT_GRID_LAYOUT, EMPTY_GRID_FILTER, gridChoices, gridTiles, lastSegment, matchesGridFilter, parseGridLayout, placeInSlot } from "./agentGrid.ts";

function pane(id: string, overrides: Partial<HerdrPane> = {}): HerdrPane {
  return { pane_id: id, workspace_id: "w1", tab_id: "w1:t1", terminal_id: `${id}:term`, revision: 1, focused: false, agent_status: "idle", agent: "claude", ...overrides };
}

type WorkspaceExtra = Partial<SessionSnapshot["workspaces"][number]>;

function machine(id: string, panes: HerdrPane[], state: Machine["state"] = "connected", workspaces: WorkspaceExtra[] = [{}]): Machine {
  const snapshot: SessionSnapshot = {
    protocol: 22, version: "test", layouts: [], panes, agents: [],
    workspaces: workspaces.map((extra, index) => ({ workspace_id: `w${index + 1}`, active_tab_id: "w1:t1", label: "repo", number: index + 1, tab_count: 1, pane_count: panes.length, focused: false, agent_status: "idle", ...extra })),
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main", number: 1, pane_count: panes.length, focused: false, agent_status: "idle" }],
  };
  return { id, name: id, kind: id === "local" ? "local" : "ssh", enabled: true, state, error: null, snapshot };
}

describe("gridTiles", () => {
  const local = machine("local", [pane("a"), pane("b", { agent_status: "working" })]);
  const remote = { ...machine("box", [pane("c", { agent_status: "blocked" }), pane("shell", { agent: null })]), name: "box/work", target: { destination: "me@box", session: "work" } } as Machine;

  it("lists every connected PC's agents in sidebar order, shells and offline PCs left out", () => {
    expect(gridTiles([local, remote, machine("away", [pane("d")], "disconnected")]).map((tile) => tile.key)).toEqual(["local:a", "local:b", "box:c"]);
  });

  it("names the PC without its herdr session, and the session apart", () => {
    expect(gridTiles([local, remote]).map((tile) => [tile.host, tile.session])).toEqual([["local", null], ["local", null], ["box", "work"]]);
  });

  it("takes the repo from the repo token, the worktree, then the label's known prefix", () => {
    const panes = ["w1", "w2", "w3", "w4"].map((workspace, index) => pane(`p${index}`, { workspace_id: workspace }));
    const box = machine("box", panes, "connected", [
      { label: "devkit-grok", tokens: { paddock_repo: "devkit" } },
      { label: "anything", worktree: { repo_name: "estrada", checkout_path: "/x", is_linked_worktree: true, repo_key: "k", repo_root: "/x" } },
      { label: "estrada-auth" },
      { label: "scratch" },
    ]);
    expect(gridTiles([box]).map((tile) => tile.repo)).toEqual(["devkit", "estrada", "estrada", "scratch"]);
  });
});

describe("gridChoices and matchesGridFilter", () => {
  const remote = { ...machine("box", [pane("c")], "connected", [{ label: "devkit-grok" }]), name: "box/work", target: { destination: "me@box", session: "work" } } as Machine;
  const tiles = gridTiles([machine("local", [pane("a")]), remote]);

  it("lists each repo, PC and session once", () => {
    expect(gridChoices(tiles)).toEqual({ repos: ["devkit-grok", "repo"], hosts: ["box", "local"], sessions: ["work"] });
  });

  it("narrows by repo, PC, session and text", () => {
    const keys = (filter: Partial<typeof EMPTY_GRID_FILTER>) => tiles.filter((tile) => matchesGridFilter(tile, { ...EMPTY_GRID_FILTER, ...filter })).map((tile) => tile.key);
    expect(keys({})).toEqual(["local:a", "box:c"]);
    expect(keys({ host: "box" })).toEqual(["box:c"]);
    expect(keys({ session: "work" })).toEqual(["box:c"]);
    expect(keys({ repo: "repo" })).toEqual(["local:a"]);
    expect(keys({ query: "GROK" })).toEqual(["box:c"]);
  });
});

describe("placeInSlot", () => {
  it("places, moves an agent shown elsewhere, and trims empty tiles at the end", () => {
    expect(placeInSlot([], 2, "a")).toEqual([null, null, "a"]);
    expect(placeInSlot(["a", "b"], 2, "a")).toEqual([null, "b", "a"]);
    expect(placeInSlot(["a", null, "b"], 2, null)).toEqual(["a"]);
  });
});

describe("parseGridLayout", () => {
  it("starts empty at three by two, clamps sizes and drops unreadable tiles", () => {
    expect(DEFAULT_GRID_LAYOUT).toEqual({ columns: 3, rows: 2, slots: [] });
    expect(parseGridLayout(JSON.stringify({ columns: 9, rows: 0, slots: ["local:a", 3, null, ""] }))).toEqual({ columns: 6, rows: 1, slots: ["local:a", null, null, null] });
    expect(parseGridLayout("{not json")).toEqual(DEFAULT_GRID_LAYOUT);
    expect(parseGridLayout(null)).toEqual(DEFAULT_GRID_LAYOUT);
    expect(parseGridLayout(JSON.stringify({ columns: 2.5 }))).toEqual(DEFAULT_GRID_LAYOUT);
  });
});

describe("lastSegment", () => {
  it("names the last folder of a path", () => {
    expect(lastSegment("/home/me/repos/app/")).toBe("app");
    expect(lastSegment("C:\\work\\tool")).toBe("tool");
    expect(lastSegment("  ")).toBeNull();
    expect(lastSegment(null)).toBeNull();
  });
});
