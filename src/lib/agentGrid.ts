/**
 * The agent grid: saved views, each a grid of fixed columns and rows whose tiles show agents from
 * any PC. Only the chat lens is drawn, so no tile attaches a terminal or resizes a pane herdr
 * shows. A tile holds an agent the user chose, by sidebar pin key (`machine:pane`); a view with a
 * repo, PC or herdr session filter also fills its empty tiles with every agent that matches, live.
 */

import type { Machine } from "../../shared/machines.ts";
import { workspaceRepo, workspaceRepoHint } from "../../shared/repos.ts";
import { sidebarAgents, type SidebarAgent } from "./sidebarAgents.ts";
import { sidebarPinKey } from "./sidebarPins.ts";

export interface GridView {
  id: string;
  name: string;
  columns: number;
  rows: number;
  repo: string | null;
  host: string | null;
  /** a herdr session name (a herdr server on a PC, like `private`), not an agent session */
  herdrSession: string | null;
  /** the agent the user put in each tile, by position; null or past the end leaves the tile to the filter */
  slots: Array<string | null>;
  /** agents the user took out, so the filter does not bring them back */
  excluded: string[];
}

export interface GridTile {
  machine: Machine;
  entry: SidebarAgent;
  key: string;
  repo: string;
  /** the PC, without the herdr session a remote PC's name carries (`host/herdr-session`) */
  host: string;
  /** the herdr session the agent runs in (the herdr server on that PC); null for the hub's own */
  herdrSession: string | null;
}

/** What the agent picker narrows to; null is any. */
export interface GridFilter {
  query: string;
  repo: string | null;
  host: string | null;
  herdrSession: string | null;
}

export const GRID_MAX_COLUMNS = 6;
export const GRID_MAX_ROWS = 4;
const MAX_SLOTS = GRID_MAX_COLUMNS * GRID_MAX_ROWS;
// the views travel in the shared preferences, which the server caps in size
export const MAX_VIEWS = 12;
const MAX_EXCLUDED = 48;
const MAX_TEXT = 300;
export const EMPTY_GRID_FILTER: GridFilter = { query: "", repo: null, host: null, herdrSession: null };

const VIEW_KEY = "herdr-web-ui:agent-grid-view";
const OPEN_KEY = "herdr-web-ui:agent-grid-open";

/** An id for a view made in this browser. */
export const newViewId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newGridView(id: string, name: string): GridView {
  return { id, name, columns: 3, rows: 2, repo: null, host: null, herdrSession: null, slots: [], excluded: [] };
}

function clamp(value: unknown, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
}

const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT ? value : null;

/** The saved views as stored or sent by another browser, cut to the shape and the limits. */
export function sanitizeGridViews(raw: unknown): GridView[] {
  if (!Array.isArray(raw)) return [];
  const views: GridView[] = [];
  for (const value of raw.slice(0, MAX_VIEWS)) {
    if (typeof value !== "object" || value === null) continue;
    const view = value as Record<string, unknown>;
    const id = text(view["id"]);
    if (id === null || views.some((other) => other.id === id)) continue;
    views.push({
      id,
      name: (typeof view["name"] === "string" ? view["name"] : "").slice(0, 80),
      columns: clamp(view["columns"], GRID_MAX_COLUMNS, 3),
      rows: clamp(view["rows"], GRID_MAX_ROWS, 2),
      repo: text(view["repo"]),
      host: text(view["host"]),
      // `session` until the agent/herdr session names were told apart
      herdrSession: text(view["herdrSession"] ?? view["session"]),
      slots: Array.isArray(view["slots"]) ? view["slots"].slice(0, MAX_SLOTS).map(text) : [],
      excluded: Array.isArray(view["excluded"]) ? view["excluded"].map(text).filter((key): key is string => key !== null).slice(-MAX_EXCLUDED) : [],
    });
  }
  return views;
}

// this page's pick wins over storage, which can throw or keep an older id (a private window, blocked site data)
let pickedViewId: string | null = null;

export function loadGridViewId(): string | null {
  if (pickedViewId !== null) return pickedViewId;
  try { return localStorage.getItem(VIEW_KEY); } catch { return null; }
}

export function storeGridViewId(id: string): void {
  pickedViewId = id;
  try { localStorage.setItem(VIEW_KEY, id); } catch { /* per-browser convenience only */ }
}

/** What takes the pane area's place: the grid, the agent sessions page, the Repos board, or nothing (the pane itself). */
export type Board = "grid" | "sessions" | "repos" | null;

const LINKED_BOARDS: Readonly<Record<string, Board>> = { grid: "grid", sessions: "sessions", repos: "repos", none: null };

/**
 * A link's `?board=` (grid, sessions, repos or none) first, kept as this browser's choice; else the
 * grid unless this browser chose otherwise: the grid is what this build is for.
 */
export function loadBoard(search: string = typeof location === "undefined" ? "" : location.search): Board {
  const linked = new URLSearchParams(search).get("board");
  if (linked !== null && Object.hasOwn(LINKED_BOARDS, linked)) {
    const board = LINKED_BOARDS[linked]!;
    storeBoard(board);
    dropBoardParam();
    return board;
  }
  try {
    const value = localStorage.getItem(OPEN_KEY);
    return value === "0" ? null : value === "sessions" || value === "repos" ? value : "grid";
  } catch {
    return "grid";
  }
}

// the address bar keeps parameters it does not own, so a linked board would reopen on every reload
function dropBoardParam(): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const url = new URL(location.href);
  if (!url.searchParams.has("board")) return;
  url.searchParams.delete("board");
  history.replaceState(history.state, "", url);
}

export function storeBoard(board: Board): void {
  try { localStorage.setItem(OPEN_KEY, board === null ? "0" : board === "grid" ? "1" : board); } catch { /* per-browser convenience only */ }
}

/** The repo of every workspace of every PC, keyed `machine:workspace`; a label prefix counts only for a repo some workspace names outright. */
export function workspaceRepos(machines: readonly Machine[]): Map<string, string> {
  const workspaces = machines.flatMap((machine) => (machine.snapshot?.workspaces ?? []).map((workspace) => ({ machine, workspace })));
  const known = new Set(workspaces.map(({ workspace }) => workspaceRepoHint(workspace)).filter((repo): repo is string => repo !== null));
  return new Map(workspaces.map(({ machine, workspace }) => [`${machine.id}:${workspace.workspace_id}`, workspaceRepo(workspace, known)]));
}

/** Every connected PC's agents, in the sidebar's order: PC, workspace, tab, pane. */
export function gridTiles(machines: readonly Machine[]): GridTile[] {
  const connected = machines.filter((machine) => machine.state === "connected");
  const repos = workspaceRepos(connected);
  return connected.flatMap((machine) => sidebarAgents(machine.snapshot).map((entry) => ({
    machine,
    entry,
    key: sidebarPinKey(machine.id, entry.pane.pane_id),
    repo: repos.get(`${machine.id}:${entry.workspace.workspace_id}`) ?? entry.workspace.label,
    host: machine.name.split("/")[0] || machine.name,
    herdrSession: machine.target?.session ?? null,
  })));
}

/** Each repo with how many agents work on it, busiest first. */
export function repoCounts(tiles: readonly GridTile[]): Array<{ repo: string; count: number }> {
  const counts = new Map<string, number>();
  for (const tile of tiles) counts.set(tile.repo, (counts.get(tile.repo) ?? 0) + 1);
  return [...counts].map(([repo, count]) => ({ repo, count })).sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));
}

/** The smallest grid, a little wider than tall, that holds `count` tiles. */
export function fitGrid(count: number): { columns: number; rows: number } {
  for (let rows = 1; rows <= GRID_MAX_ROWS; rows++) {
    const columns = Math.ceil(count / rows);
    if (columns <= rows + 1 && columns <= GRID_MAX_COLUMNS) return { columns: Math.max(1, columns), rows };
  }
  return { columns: GRID_MAX_COLUMNS, rows: GRID_MAX_ROWS };
}

/** A view filtered to one repo alone with no hand-placed tile: the grid's own repo view, safe to reuse or replace. */
const isRepoView = (view: GridView): boolean => view.repo !== null && view.host === null && view.herdrSession === null && view.slots.every((slot) => slot === null);

/**
 * Where a click on `repo` takes the grid. `views` is what the grid shows now. It returns the views
 * to save and the one to select: the repo's clean view, else a new one sized to fit (replacing the
 * last clean view of another repo once the saved views are full). Null when nothing fits, so the
 * grid stays on its current view.
 */
export function openRepoView(views: readonly GridView[], repo: string, count: number, id: string): { views: GridView[]; id: string } | null {
  const existing = views.find((view) => view.repo === repo && isRepoView(view));
  if (existing) return { views: [...views], id: existing.id };
  const next: GridView = { ...newGridView(id, repo), ...fitGrid(count), repo };
  if (views.length < MAX_VIEWS) return { views: [...views, next], id };
  const index = views.map(isRepoView).lastIndexOf(true);
  return index < 0 ? null : { views: views.map((view, at) => (at === index ? next : view)), id };
}

/** The PCs with only the workspaces of the chosen repos (none chosen is all); a PC left with none drops out. */
export function filterMachinesByRepo(machines: readonly Machine[], chosen: ReadonlySet<string>): Machine[] {
  if (chosen.size === 0) return [...machines];
  const repos = workspaceRepos(machines);
  return machines.flatMap((machine) => {
    const snapshot = machine.snapshot;
    if (!snapshot) return [];
    const keep = new Set(snapshot.workspaces.filter((workspace) => chosen.has(repos.get(`${machine.id}:${workspace.workspace_id}`) ?? "")).map((workspace) => workspace.workspace_id));
    if (keep.size === 0) return [];
    const panes = snapshot.panes.filter((pane) => keep.has(pane.workspace_id));
    const paneIds = new Set(panes.map((pane) => pane.pane_id));
    return [{
      ...machine,
      snapshot: {
        ...snapshot,
        workspaces: snapshot.workspaces.filter((workspace) => keep.has(workspace.workspace_id)),
        tabs: snapshot.tabs.filter((tab) => keep.has(tab.workspace_id)),
        panes,
        agents: snapshot.agents.filter((agent) => paneIds.has(agent.pane_id)),
      },
    }];
  });
}

/** The repos, PCs and herdr sessions the tiles cover, each once and sorted, for the picker's filters. */
export function gridChoices(tiles: readonly GridTile[]): { repos: string[]; hosts: string[]; herdrSessions: string[] } {
  const sorted = (values: Array<string | null>): string[] => [...new Set(values.filter((value): value is string => value !== null))].sort((a, b) => a.localeCompare(b));
  return { repos: sorted(tiles.map((tile) => tile.repo)), hosts: sorted(tiles.map((tile) => tile.host)), herdrSessions: sorted(tiles.map((tile) => tile.herdrSession)) };
}

export function matchesGridFilter(tile: GridTile, filter: GridFilter): boolean {
  if ((filter.repo !== null && tile.repo !== filter.repo) || (filter.host !== null && tile.host !== filter.host) || (filter.herdrSession !== null && tile.herdrSession !== filter.herdrSession)) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  const { pane, agent, workspace, agentLabel } = tile.entry;
  return [workspace.label, pane.label, pane.title, agent?.title, agent?.name, agentLabel, tile.repo, tile.host, tile.herdrSession]
    .some((text) => text?.toLowerCase().includes(query));
}

export function viewFilter(view: GridView): GridFilter {
  return { query: "", repo: view.repo, host: view.host, herdrSession: view.herdrSession };
}

const filtered = (view: GridView): boolean => view.repo !== null || view.host !== null || view.herdrSession !== null;

/**
 * The agent in each of the view's `count` tiles: the user's choices where made, the filter's
 * matches in the empty ones; `hidden` counts the agents of the view that do not fit.
 */
export function arrangeView(view: GridView, tiles: readonly GridTile[], count: number): { keys: Array<string | null>; hidden: number } {
  const placed = new Set(view.slots.filter((slot): slot is string => slot !== null));
  const matches = filtered(view)
    ? tiles.filter((tile) => !placed.has(tile.key) && !view.excluded.includes(tile.key) && matchesGridFilter(tile, viewFilter(view))).map((tile) => tile.key)
    : [];
  let next = 0;
  const keys = Array.from({ length: count }, (_, index) => view.slots[index] ?? (next < matches.length ? matches[next++]! : null));
  const hidden = view.slots.slice(count).filter((slot) => slot !== null).length + matches.length - next;
  return { keys, hidden };
}

/** The view with `key` chosen for tile `index`. */
export function chooseInView(view: GridView, index: number, key: string): GridView {
  return { ...view, slots: placeInSlot(view.slots, index, key), excluded: view.excluded.filter((other) => other !== key) };
}

/** The view without the agent in tile `index`; the filter does not bring it back. */
export function removeFromView(view: GridView, index: number, key: string): GridView {
  const excluded = filtered(view) ? [...view.excluded.filter((other) => other !== key), key].slice(-MAX_EXCLUDED) : view.excluded;
  return { ...view, slots: placeInSlot(view.slots, index, null), excluded };
}

/** A new filter starts the view over from what it matches. */
export function filterView(view: GridView, filter: Pick<GridView, "repo" | "host" | "herdrSession">): GridView {
  return { ...view, ...filter, slots: [], excluded: [] };
}

/** The slots with `key` in tile `index` (null empties it); an agent shown elsewhere moves here. */
export function placeInSlot(slots: readonly (string | null)[], index: number, key: string | null): Array<string | null> {
  const next = slots.map((slot) => (key !== null && slot === key ? null : slot));
  while (next.length <= index) next.push(null);
  next[index] = key;
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next;
}

/** The last path segment, for a folder or a session file named in a tile's narrow header. */
export function lastSegment(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return null;
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

const SIDEBAR_REPOS_KEY = "herdr-web-ui:sidebar-repos";

/** The repos the sidebar is narrowed to on this device; empty is every repo. */
export function loadSidebarRepos(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SIDEBAR_REPOS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((repo): repo is string => typeof repo === "string") : [];
  } catch {
    return [];
  }
}

export function storeSidebarRepos(repos: readonly string[]): void {
  try { localStorage.setItem(SIDEBAR_REPOS_KEY, JSON.stringify(repos)); } catch { /* per-browser convenience only */ }
}
