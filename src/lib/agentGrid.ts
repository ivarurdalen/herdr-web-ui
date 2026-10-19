/**
 * The agent grid: saved views, each a grid of fixed columns and rows whose tiles show agents from
 * any PC. Only the chat lens is drawn, so no tile attaches a terminal or resizes a pane herdr
 * shows. A tile holds an agent the user chose, by sidebar pin key (`machine:pane`); a view with a
 * repo, PC or session filter also fills its empty tiles with every agent that matches, live.
 */

import type { Machine } from "../../shared/machines.ts";
import type { WorkspaceInfo } from "../../shared/protocol.ts";
import { sidebarAgents, type SidebarAgent } from "./sidebarAgents.ts";
import { sidebarPinKey } from "./sidebarPins.ts";

export interface GridView {
  id: string;
  name: string;
  columns: number;
  rows: number;
  repo: string | null;
  host: string | null;
  session: string | null;
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
  /** the PC, without the herdr session a remote PC's name carries (`host/session`) */
  host: string;
  session: string | null;
}

/** What the agent picker narrows to; null is any. */
export interface GridFilter {
  query: string;
  repo: string | null;
  host: string | null;
  session: string | null;
}

export const GRID_MAX_COLUMNS = 6;
export const GRID_MAX_ROWS = 4;
const MAX_SLOTS = GRID_MAX_COLUMNS * GRID_MAX_ROWS;
// the views travel in the shared preferences, which the server caps in size
const MAX_VIEWS = 12;
const MAX_EXCLUDED = 48;
const MAX_TEXT = 300;
export const EMPTY_GRID_FILTER: GridFilter = { query: "", repo: null, host: null, session: null };

const VIEW_KEY = "herdr-web-ui:agent-grid-view";
const OPEN_KEY = "herdr-web-ui:agent-grid-open";

export function newGridView(id: string, name: string): GridView {
  return { id, name, columns: 3, rows: 2, repo: null, host: null, session: null, slots: [], excluded: [] };
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
      session: text(view["session"]),
      slots: Array.isArray(view["slots"]) ? view["slots"].slice(0, MAX_SLOTS).map(text) : [],
      excluded: Array.isArray(view["excluded"]) ? view["excluded"].map(text).filter((key): key is string => key !== null).slice(-MAX_EXCLUDED) : [],
    });
  }
  return views;
}

// storage can throw (a private window, blocked site data): the grid then opens on the first view
export function loadGridViewId(): string | null {
  try { return localStorage.getItem(VIEW_KEY); } catch { return null; }
}

export function storeGridViewId(id: string): void {
  try { localStorage.setItem(VIEW_KEY, id); } catch { /* per-browser convenience only */ }
}

/** Open unless this browser closed it: the grid is what this build is for. */
export function loadGridOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; }
}

export function storeGridOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* per-browser convenience only */ }
}

function workspaceRepoHint(workspace: WorkspaceInfo): string | null {
  const token = workspace.tokens?.["paddock_repo"];
  if (typeof token === "string" && token.trim()) return token.trim();
  return workspace.worktree?.repo_name || null;
}

/** The repo a workspace works on: its repo token or git worktree, else the known repo its label is prefixed with (`repo-topic`). */
export function workspaceRepo(workspace: WorkspaceInfo, known: ReadonlySet<string>): string {
  const hint = workspaceRepoHint(workspace);
  if (hint !== null) return hint;
  let best: string | null = null;
  for (const repo of known) {
    if ((workspace.label === repo || workspace.label.startsWith(`${repo}-`)) && repo.length > (best?.length ?? 0)) best = repo;
  }
  return best ?? workspace.label;
}

/** Every connected PC's agents, in the sidebar's order: PC, workspace, tab, pane. */
export function gridTiles(machines: readonly Machine[]): GridTile[] {
  const connected = machines.filter((machine) => machine.state === "connected");
  const entries = connected.flatMap((machine) => sidebarAgents(machine.snapshot).map((entry) => ({ machine, entry })));
  const known = new Set(entries.map(({ entry }) => workspaceRepoHint(entry.workspace)).filter((repo): repo is string => repo !== null));
  return entries.map(({ machine, entry }) => ({
    machine,
    entry,
    key: sidebarPinKey(machine.id, entry.pane.pane_id),
    repo: workspaceRepo(entry.workspace, known),
    host: machine.name.split("/")[0] || machine.name,
    session: machine.target?.session ?? null,
  }));
}

/** The repos, PCs and herdr sessions the tiles cover, each once and sorted, for the picker's filters. */
export function gridChoices(tiles: readonly GridTile[]): { repos: string[]; hosts: string[]; sessions: string[] } {
  const sorted = (values: Array<string | null>): string[] => [...new Set(values.filter((value): value is string => value !== null))].sort((a, b) => a.localeCompare(b));
  return { repos: sorted(tiles.map((tile) => tile.repo)), hosts: sorted(tiles.map((tile) => tile.host)), sessions: sorted(tiles.map((tile) => tile.session)) };
}

export function matchesGridFilter(tile: GridTile, filter: GridFilter): boolean {
  if ((filter.repo !== null && tile.repo !== filter.repo) || (filter.host !== null && tile.host !== filter.host) || (filter.session !== null && tile.session !== filter.session)) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  const { pane, agent, workspace, agentLabel } = tile.entry;
  return [workspace.label, pane.label, pane.title, agent?.title, agent?.name, agentLabel, tile.repo, tile.host, tile.session]
    .some((text) => text?.toLowerCase().includes(query));
}

export function viewFilter(view: GridView): GridFilter {
  return { query: "", repo: view.repo, host: view.host, session: view.session };
}

const filtered = (view: GridView): boolean => view.repo !== null || view.host !== null || view.session !== null;

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
export function filterView(view: GridView, filter: Pick<GridView, "repo" | "host" | "session">): GridView {
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
