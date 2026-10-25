import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Machine } from "../../shared/machines.ts";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";
import { arrangeView, chooseInView, EMPTY_GRID_FILTER, filterMachinesByRepo, filterView, fitGrid, gridChoices, gridTiles, lastSegment, loadBoard, loadGridViewId, matchesGridFilter, MAX_VIEWS, newGridView, openRepoView, placeInSlot, removeFromView, repoCounts, sanitizeGridViews, storeBoard, storeGridViewId, type GridView } from "./agentGrid.ts";

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
    expect(gridTiles([local, remote]).map((tile) => [tile.host, tile.herdrSession])).toEqual([["local", null], ["local", null], ["box", "work"]]);
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
    expect(gridChoices(tiles)).toEqual({ repos: ["devkit-grok", "repo"], hosts: ["box", "local"], herdrSessions: ["work"] });
  });

  it("narrows by repo, PC, session and text", () => {
    const keys = (filter: Partial<typeof EMPTY_GRID_FILTER>) => tiles.filter((tile) => matchesGridFilter(tile, { ...EMPTY_GRID_FILTER, ...filter })).map((tile) => tile.key);
    expect(keys({})).toEqual(["local:a", "box:c"]);
    expect(keys({ host: "box" })).toEqual(["box:c"]);
    expect(keys({ herdrSession: "work" })).toEqual(["box:c"]);
    expect(keys({ repo: "repo" })).toEqual(["local:a"]);
    expect(keys({ query: "GROK" })).toEqual(["box:c"]);
  });
});

describe("repo views", () => {
  it("counts agents per repo, busiest first", () => {
    const box = machine("box", [pane("a", { workspace_id: "w1" }), pane("b", { workspace_id: "w2" }), pane("c", { workspace_id: "w2" })], "connected", [{ label: "one" }, { label: "two" }]);
    expect(repoCounts(gridTiles([box]))).toEqual([{ repo: "two", count: 2 }, { repo: "one", count: 1 }]);
  });

  it("sizes a grid to fit, a little wider than tall", () => {
    expect([0, 1, 2, 4, 6, 7, 10, 13, 20, 30].map((count) => Object.values(fitGrid(count)).join("x"))).toEqual(["1x1", "1x1", "2x1", "2x2", "3x2", "3x3", "4x3", "4x4", "5x4", "6x4"]);
  });

  describe("openRepoView", () => {
    const repoOnly = (id: string, repo: string): GridView => ({ ...newGridView(id, repo), repo });

    it("reuses the view filtered to the repo alone, with its size and exclusions", () => {
      const devkit = { ...repoOnly("d", "devkit"), columns: 5, excluded: ["box:x"] };
      expect(openRepoView([repoOnly("o", "other"), devkit], "devkit", 9, "new")).toEqual({ views: [repoOnly("o", "other"), devkit], id: "d" });
    });

    it("skips a view of the repo with a PC, a herdr session or a hand-placed tile, and adds one sized to fit", () => {
      const devkit = repoOnly("d", "devkit");
      for (const taken of [{ ...devkit, host: "box" }, { ...devkit, herdrSession: "work" }, { ...devkit, slots: [null, "box:a"] }]) {
        const result = openRepoView([taken], "devkit", 7, "new");
        expect(result!.id).toBe("new");
        expect(result!.views).toEqual([taken, { ...newGridView("new", "devkit"), repo: "devkit", columns: 3, rows: 3 }]);
      }
    });

    it("adds a view to an empty list", () => {
      expect(openRepoView([], "devkit", 1, "new")).toEqual({ views: [{ ...newGridView("new", "devkit"), repo: "devkit", columns: 1, rows: 1 }], id: "new" });
    });

    it("replaces the last clean view of another repo once the views are full", () => {
      const full = Array.from({ length: MAX_VIEWS }, (_, index) => repoOnly(`v${index}`, `repo${index}`));
      full[3] = { ...full[3]!, slots: ["box:a"] };
      full[MAX_VIEWS - 1] = { ...full[MAX_VIEWS - 1]!, host: "box" };
      const result = openRepoView(full, "devkit", 2, "new")!;
      expect(result.id).toBe("new");
      expect(result.views).toHaveLength(MAX_VIEWS);
      expect(result.views.map((view) => view.id)).toEqual(full.map((view, index) => (index === MAX_VIEWS - 2 ? "new" : view.id)));
    });

    it("leaves the grid on its current view when full and no view can be replaced", () => {
      const full = Array.from({ length: MAX_VIEWS }, (_, index) => ({ ...newGridView(`v${index}`, `View ${index}`) }));
      expect(openRepoView(full, "devkit", 2, "new")).toBeNull();
    });
  });

  describe("the open board", () => {
    const stored = new Map<string, string>();
    const local = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    beforeAll(() => Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) } }));
    afterAll(() => { if (local) Object.defineProperty(globalThis, "localStorage", local); else Reflect.deleteProperty(globalThis, "localStorage"); });
    afterEach(() => stored.clear());

    it("reads back every board it stored", () => {
      for (const board of ["grid", "sessions", "repos", null] as const) {
        storeBoard(board);
        expect(loadBoard()).toBe(board);
      }
    });

    it("keeps the meaning of values stored before: 0 is none, 1 and anything else the grid", () => {
      const keyOf = (value: string): void => void stored.set("herdr-web-ui:agent-grid-open", value);
      expect(["0", "1", "sessions", "repos", "bogus"].map((value) => (keyOf(value), loadBoard()))).toEqual([null, "grid", "sessions", "repos", "grid"]);
      stored.clear();
      expect(loadBoard()).toBe("grid");
    });

    it("reads back the picked view when storage refuses to write it", () => {
      stored.set("herdr-web-ui:agent-grid-view", "old");
      const setItem = localStorage.setItem;
      localStorage.setItem = () => { throw new Error("quota"); };
      try {
        storeGridViewId("picked");
        expect(loadGridViewId()).toBe("picked");
      } finally { localStorage.setItem = setItem; }
    });

    it("opens the board a link names and keeps it, and ignores a board it does not know", () => {
      stored.set("herdr-web-ui:agent-grid-open", "sessions");
      expect(loadBoard("?board=repos")).toBe("repos");
      expect(loadBoard("")).toBe("repos");
      expect(loadBoard("?board=none")).toBeNull();
      expect(loadBoard("?board=constructor")).toBeNull();
      expect(loadBoard("?machine=local&board=grid")).toBe("grid");
    });

    it("stores the repos board as repos", () => {
      storeBoard("repos");
      expect(stored.get("herdr-web-ui:agent-grid-open")).toBe("repos");
    });
  });

  it("keeps only the chosen repos' workspaces in the sidebar, and drops a PC left empty", () => {
    const box = machine("box", [pane("a", { workspace_id: "w1" }), pane("b", { workspace_id: "w2" })], "connected", [{ label: "one" }, { label: "two" }]);
    const other = machine("other", [pane("c")], "connected", [{ label: "three" }]);
    const [only, ...rest] = filterMachinesByRepo([box, other], new Set(["two"]));
    expect(rest).toEqual([]);
    expect(only!.snapshot!.workspaces.map((workspace) => workspace.label)).toEqual(["two"]);
    expect(only!.snapshot!.panes.map((item) => item.pane_id)).toEqual(["b"]);
    expect(filterMachinesByRepo([box, other], new Set())).toHaveLength(2);
  });
});

describe("placeInSlot", () => {
  it("places, moves an agent shown elsewhere, and trims empty tiles at the end", () => {
    expect(placeInSlot([], 2, "a")).toEqual([null, null, "a"]);
    expect(placeInSlot(["a", "b"], 2, "a")).toEqual([null, "b", "a"]);
    expect(placeInSlot(["a", null, "b"], 2, null)).toEqual(["a"]);
  });
});

describe("saved views", () => {
  const remote = { ...machine("box", [pane("c"), pane("d")], "connected", [{ label: "devkit-grok" }]), name: "box/work", target: { destination: "me@box", session: "work" } } as Machine;
  const tiles = gridTiles([machine("local", [pane("a")]), remote]);
  const clean = newGridView("v", "View 1");

  it("starts a new view empty at three by two", () => {
    expect(clean).toMatchObject({ columns: 3, rows: 2, repo: null, host: null, herdrSession: null, slots: [], excluded: [] });
    expect(arrangeView(clean, tiles, 6)).toEqual({ keys: [null, null, null, null, null, null], hidden: 0 });
  });

  it("fills the tiles the user left empty with the filter's agents, live", () => {
    const byHost = filterView(clean, { repo: null, host: "box", herdrSession: null });
    expect(arrangeView(byHost, tiles, 3).keys).toEqual(["box:c", "box:d", null]);
    expect(arrangeView(chooseInView(byHost, 0, "local:a"), tiles, 3).keys).toEqual(["local:a", "box:c", "box:d"]);
    expect(arrangeView(byHost, tiles, 1)).toEqual({ keys: ["box:c"], hidden: 1 });
  });

  it("keeps a removed agent out until it is chosen again", () => {
    const byHost = removeFromView(filterView(clean, { repo: null, host: "box", herdrSession: null }), 0, "box:c");
    expect(arrangeView(byHost, tiles, 3).keys).toEqual(["box:d", null, null]);
    expect(arrangeView(chooseInView(byHost, 2, "box:c"), tiles, 3).keys).toEqual(["box:d", null, "box:c"]);
  });

  it("reads stored views to their shape and limits", () => {
    const stored = sanitizeGridViews([{ id: "a", name: "Devkit", columns: 9, rows: 0, repo: "devkit", session: "work", slots: ["local:a", 3], excluded: ["box:c", 5] }, { id: "a" }, { name: "no id" }, "junk"]);
    expect(stored).toEqual([{ id: "a", name: "Devkit", columns: 6, rows: 1, repo: "devkit", host: null, herdrSession: "work", slots: ["local:a", null], excluded: ["box:c"] }]);
    expect(sanitizeGridViews("junk")).toEqual([]);
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
