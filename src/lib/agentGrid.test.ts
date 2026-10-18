import { describe, expect, it } from "bun:test";
import type { Machine } from "../../shared/machines.ts";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";
import { DEFAULT_GRID_LAYOUT, gridPage, gridTiles, lastSegment, parseGridLayout } from "./agentGrid.ts";

function pane(id: string, overrides: Partial<HerdrPane> = {}): HerdrPane {
  return { pane_id: id, workspace_id: "w1", tab_id: "w1:t1", terminal_id: `${id}:term`, revision: 1, focused: false, agent_status: "idle", agent: "claude", ...overrides };
}

function machine(id: string, panes: HerdrPane[], state: Machine["state"] = "connected"): Machine {
  const snapshot: SessionSnapshot = {
    protocol: 22, version: "test", layouts: [], panes, agents: [],
    workspaces: [{ workspace_id: "w1", active_tab_id: "w1:t1", label: "repo", number: 1, tab_count: 1, pane_count: panes.length, focused: false, agent_status: "idle" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main", number: 1, pane_count: panes.length, focused: false, agent_status: "idle" }],
  };
  return { id, name: id, kind: id === "local" ? "local" : "ssh", enabled: true, state, error: null, snapshot };
}

describe("gridTiles", () => {
  const local = machine("local", [pane("a"), pane("b", { agent_status: "working" })]);
  const remote = machine("box", [pane("c", { agent_status: "blocked" }), pane("shell", { agent: null })]);

  it("lists every connected PC's agents in sidebar order, shells left out", () => {
    expect(gridTiles([local, remote], [], "all").map((tile) => tile.key)).toEqual(["local:a", "local:b", "box:c"]);
  });

  it("puts pinned agents first, in pin order", () => {
    expect(gridTiles([local, remote], ["box:c", "local:b"], "all").map((tile) => tile.key)).toEqual(["box:c", "local:b", "local:a"]);
  });

  it("keeps only working or blocked agents for the active filter", () => {
    expect(gridTiles([local, remote], [], "active").map((tile) => tile.key)).toEqual(["local:b", "box:c"]);
  });

  it("leaves out a PC that is not connected", () => {
    expect(gridTiles([local, machine("away", [pane("d")], "disconnected")], [], "all").map((tile) => tile.key)).toEqual(["local:a", "local:b"]);
  });
});

describe("gridPage", () => {
  it("slices a page and clamps one past the end", () => {
    expect(gridPage([1, 2, 3, 4, 5], 2, 1)).toEqual({ tiles: [3, 4], page: 1, pages: 3 });
    expect(gridPage([1, 2, 3], 2, 9)).toEqual({ tiles: [3], page: 1, pages: 2 });
    expect(gridPage([], 8, 0)).toEqual({ tiles: [], page: 0, pages: 1 });
  });
});

describe("parseGridLayout", () => {
  it("clamps sizes and falls back on anything unreadable", () => {
    expect(parseGridLayout(JSON.stringify({ columns: 9, rows: 0, filter: "active" }))).toEqual({ columns: 6, rows: 1, filter: "active" });
    expect(parseGridLayout("{not json")).toEqual(DEFAULT_GRID_LAYOUT);
    expect(parseGridLayout(null)).toEqual(DEFAULT_GRID_LAYOUT);
    expect(parseGridLayout(JSON.stringify({ columns: 2.5, filter: "odd" }))).toEqual({ ...DEFAULT_GRID_LAYOUT, columns: 4 });
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
