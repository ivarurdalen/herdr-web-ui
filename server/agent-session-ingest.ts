/**
 * Feeds the agent session record (agent-sessions.ts) from the PCs the hub watches: each connected
 * PC entry's snapshot says which agent sessions run now, and the record notes them seen or ended.
 */
import type { Machine } from "../shared/machines.ts";
import type { WorkspaceInfo } from "../shared/protocol.ts";
import { workspaceRepo, workspaceRepoHint } from "../shared/repos.ts";
import type { AgentSessionSighting, AgentSessionStore } from "./agent-sessions.ts";

/** How often at most the record takes the PCs' state: agent sessions start and end in minutes, not seconds. */
const INGEST_MS = 30_000;
/** A workspace's branch is looked up again after this long. */
const BRANCH_MS = 10 * 60_000;

const text = (value: string | null | undefined): string | null => value?.trim() || null;

/** The agent sessions a connected PC entry runs now, as its snapshot tells; `known` are the repos named anywhere. */
export function machineSightings(machine: Machine, known: ReadonlySet<string>): AgentSessionSighting[] {
  const snapshot = machine.snapshot;
  if (!snapshot) return [];
  const workspaces = new Map(snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace]));
  const agentByPane = new Map(snapshot.agents.map((agent) => [agent.pane_id, agent]));
  const sightings: AgentSessionSighting[] = [];
  for (const pane of snapshot.panes) {
    const info = agentByPane.get(pane.pane_id);
    const agent = text(pane.agent) ?? text(info?.agent);
    const workspace = workspaces.get(pane.workspace_id);
    if (agent === null || workspace === undefined) continue;
    const session = info?.agent_session ?? pane.agent_session ?? null;
    const own = session !== null && text(session.value) !== null;
    sightings.push({
      machine_id: machine.id,
      machine_name: machine.name,
      host: machine.name.split("/")[0] || machine.name,
      herdr_session: machine.target?.session ?? null,
      agent,
      agent_session_id: own ? session.value.trim() : `pane:${pane.terminal_id}`,
      agent_session_kind: own ? (session.kind === "path" ? "path" : "id") : "pane",
      pane_id: pane.pane_id,
      workspace_id: workspace.workspace_id,
      workspace_label: workspace.label,
      repo: workspaceRepo(workspace, known),
      branch: null,
      cwd: text(pane.foreground_cwd) ?? text(pane.cwd) ?? text(info?.cwd),
      title: text(pane.label) ?? text(info?.title) ?? text(info?.terminal_title_stripped),
    });
  }
  return sightings;
}

export interface IngestSource {
  subscribe(listener: (event: { type: string; machines?: Machine[]; machine?: Machine }) => void): () => void;
}

/** Looks up a workspace's branch on its PC; null when it is no git checkout or the PC does not answer. */
export type BranchLookup = (machineId: string, workspace: WorkspaceInfo) => Promise<string | null>;

export function startAgentSessionIngest(store: AgentSessionStore, source: IngestSource, branchOf: BranchLookup): () => void {
  let latest: Machine[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastRun = 0;
  let stopped = false;
  const branches = new Map<string, { branch: string | null; at: number }>();

  const branchFor = async (machineId: string, workspace: WorkspaceInfo): Promise<string | null> => {
    const key = `${machineId}:${workspace.workspace_id}`;
    const cached = branches.get(key);
    if (cached && Date.now() - cached.at < BRANCH_MS) return cached.branch;
    const branch = await branchOf(machineId, workspace).catch(() => cached?.branch ?? null);
    branches.set(key, { branch, at: Date.now() });
    return branch;
  };

  const run = async (): Promise<void> => {
    timer = null;
    if (running || stopped) return;
    running = true;
    lastRun = Date.now();
    try {
      const machines = latest.filter((machine) => machine.state === "connected" && machine.snapshot);
      const known = new Set(machines.flatMap((machine) => machine.snapshot!.workspaces.map(workspaceRepoHint)).filter((repo): repo is string => repo !== null));
      for (const machine of machines) {
        const sightings = machineSightings(machine, known);
        const workspaces = new Map(machine.snapshot!.workspaces.map((workspace) => [workspace.workspace_id, workspace]));
        for (const sighting of sightings) sighting.branch = await branchFor(machine.id, workspaces.get(sighting.workspace_id)!);
        if (stopped) return;
        store.observe(machine.id, sightings);
      }
    } catch (error) {
      console.error(`agent sessions: the record was not updated (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      running = false;
      // also without a roster change: an unchanged roster sends no event, and sightings and branches still age
      schedule();
    }
  };
  const schedule = (): void => {
    if (timer === null && !stopped) timer = setTimeout(() => void run(), Math.max(0, lastRun + INGEST_MS - Date.now()));
  };

  const unsubscribe = source.subscribe((event) => {
    if (event.type === "machines" && event.machines) latest = event.machines;
    else if (event.type === "machine" && event.machine) latest = latest.map((machine) => machine.id === event.machine!.id ? event.machine! : machine);
    else return;
    schedule();
  });
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
