/**
 * The agent grid: every agent of every PC as a chat tile, in a grid of fixed columns and rows.
 * Only the chat lens is drawn, so no tile attaches a terminal or resizes a pane herdr shows.
 * Pinned agents (the sidebar's pins) lead, then the sidebar's order: PC, workspace, tab, pane.
 */

import type { Machine } from "../../shared/machines.ts";
import { sidebarAgents, type SidebarAgent } from "./sidebarAgents.ts";
import { sidebarPinKey, splitPinnedRows } from "./sidebarPins.ts";

export type GridFilter = "all" | "active";

export interface GridLayout {
  columns: number;
  rows: number;
  filter: GridFilter;
}

export interface GridTile {
  machine: Machine;
  entry: SidebarAgent;
  key: string;
}

export const GRID_MAX_COLUMNS = 6;
export const GRID_MAX_ROWS = 4;
export const DEFAULT_GRID_LAYOUT: GridLayout = { columns: 4, rows: 2, filter: "all" };

const LAYOUT_KEY = "herdr-web-ui:agent-grid";
const OPEN_KEY = "herdr-web-ui:agent-grid-open";

function clamp(value: unknown, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
}

export function parseGridLayout(raw: string | null): GridLayout {
  try {
    const value = raw === null ? null : JSON.parse(raw) as Partial<GridLayout> | null;
    if (value === null || typeof value !== "object") return DEFAULT_GRID_LAYOUT;
    return {
      columns: clamp(value.columns, GRID_MAX_COLUMNS, DEFAULT_GRID_LAYOUT.columns),
      rows: clamp(value.rows, GRID_MAX_ROWS, DEFAULT_GRID_LAYOUT.rows),
      filter: value.filter === "active" ? "active" : "all",
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

/** An agent that asks for a look: running a turn, or waiting on the user. */
export function isActiveTile(tile: GridTile): boolean {
  const status = tile.entry.agent?.agent_status ?? tile.entry.pane.agent_status;
  return status === "working" || status === "blocked";
}

/** Every connected PC's agents, pinned ones first, then filtered. */
export function gridTiles(machines: readonly Machine[], pins: readonly string[], filter: GridFilter): GridTile[] {
  const tiles = machines.filter((machine) => machine.state === "connected").flatMap((machine) =>
    sidebarAgents(machine.snapshot).map((entry): GridTile => ({ machine, entry, key: sidebarPinKey(machine.id, entry.pane.pane_id) })));
  const { pinned, rest } = splitPinnedRows(tiles, pins, (tile) => tile.key);
  const ordered = [...pinned, ...rest];
  return filter === "active" ? ordered.filter(isActiveTile) : ordered;
}

/** The tiles one page shows, and how many pages there are; a page past the end shows the last. */
export function gridPage<T>(tiles: readonly T[], perPage: number, page: number): { tiles: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(tiles.length / perPage));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { tiles: tiles.slice(current * perPage, (current + 1) * perPage), page: current, pages };
}

/** The last path segment, for a folder or a session file named in a tile's narrow header. */
export function lastSegment(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return null;
  return trimmed.split(/[\\/]/).pop() || trimmed;
}
