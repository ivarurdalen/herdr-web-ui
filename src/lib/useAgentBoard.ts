import { useCallback, useMemo, useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import type { PaneView } from "./actions.ts";
import { filterMachinesByRepo, gridTiles, loadBoard, loadSidebarRepos, repoCounts, storeBoard, storeSidebarRepos, type Board } from "./agentGrid.ts";

/** The board that takes the pane area's place (lib/agentGrid.ts Board); a pane opened from it closes it. */
export function useAgentBoard(selectTarget: (machineId: string, paneId: string | null, view?: PaneView) => void) {
  const [board, setBoardState] = useState(loadBoard);
  const setBoard = useCallback((next: Board) => {
    setBoardState(next);
    storeBoard(next);
  }, []);
  // a tile's Open, or a sidebar pick while a board is open: the agent in the full view
  const openFromGrid = useCallback((machineId: string, paneId: string | null, view?: PaneView) => {
    if (paneId !== null) setBoard(null);
    selectTarget(machineId, paneId, view);
  }, [selectTarget, setBoard]);
  return { board, setBoard, openFromGrid };
}

/** The sidebar's repo filter (components/RepoFilter.tsx): it narrows only what the sidebar lists. */
export function useSidebarRepos(machines: readonly Machine[]) {
  const [sidebarRepos, setSidebarReposState] = useState(loadSidebarRepos);
  const setSidebarRepos = useCallback((repos: string[]) => {
    setSidebarReposState(repos);
    storeSidebarRepos(repos);
  }, []);
  const sidebarRepoCounts = useMemo(() => repoCounts(gridTiles(machines)), [machines]);
  const sidebarMachines = useMemo(() => filterMachinesByRepo(machines, new Set(sidebarRepos)), [machines, sidebarRepos]);
  return { sidebarRepos, setSidebarRepos, sidebarRepoCounts, sidebarMachines };
}
