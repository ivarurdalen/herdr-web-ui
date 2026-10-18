/**
 * The agent grid: a grid of fixed columns and rows whose tiles each show one agent the user chose,
 * from any PC. Only the chat lens is drawn, so no tile attaches a terminal or resizes a pane herdr
 * shows. Every tile starts empty; a tile holds its agent by sidebar pin key (`machine:pane`).
 */

import type { Machine } from "../../shared/machines.ts";
import type { WorkspaceInfo } from "../../shared/protocol.ts";
import { sidebarAgents, type SidebarAgent } from "./sidebarAgents.ts";
import { sidebarPinKey } from "./sidebarPins.ts";

export interface GridLayout {
  columns: number;
  rows: number;
  /** the agent key each tile shows, by position; null or past the end is an empty tile */
  slots: Array<string | null>;
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
const MAX_KEY_LENGTH = 300;
export const DEFAULT_GRID_LAYOUT: GridLayout = { columns: 3, rows: 2, slots: [] };
export const EMPTY_GRID_FILTER: GridFilter = { query: "", repo: null, host: null, session: null };

const LAYOUT_KEY = "herdr-web-ui:agent-grid-slots";
const OPEN_KEY = "herdr-web-ui:agent-grid-open";

function clamp(value: unknown, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
}

export function parseGridLayout(raw: string | null): GridLayout {
  try {
    const value = raw === null ? null : JSON.parse(raw) as Partial<GridLayout> | null;
    if (value === null || typeof value !== "object") return DEFAULT_GRID_LAYOUT;
    const slots = Array.isArray(value.slots) ? value.slots.slice(0, MAX_SLOTS) : [];
    return {
      columns: clamp(value.columns, GRID_MAX_COLUMNS, DEFAULT_GRID_LAYOUT.columns),
      rows: clamp(value.rows, GRID_MAX_ROWS, DEFAULT_GRID_LAYOUT.rows),
      slots: slots.map((slot) => typeof slot === "string" && slot.length > 0 && slot.length <= MAX_KEY_LENGTH ? slot : null),
    };
  } catch {
    return DEFAULT_GRID_LAYOUT;
  }
}

// storage can throw (a private window, blocked site data): the grid then starts from the defaults
export function loadGridLayout(): GridLayout {
  try { return parseGridLayout(localStorage.getItem(LAYOUT_KEY)); } catch { return DEFAULT_GRID_LAYOUT; }
}

export function storeGridLayout(layout: GridLayout): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* per-browser convenience only */ }
}

export function loadGridOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
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
