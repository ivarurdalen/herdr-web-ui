import type { Machine, MachineEvent } from "../shared/machines.ts";

/** Tests that watch the roster: calls `listener` with the whole roster each time a full or single-PC event changes it. */
export function subscribeRoster(
  source: { subscribe(listener: (event: MachineEvent) => void): () => void },
  listener: (machines: Machine[], event: MachineEvent) => void,
): () => void {
  let roster: Machine[] = [];
  return source.subscribe((event) => {
    if (event.type === "machines") roster = event.machines;
    else if (event.type === "machine") roster = roster.map((machine) => machine.id === event.machine.id ? event.machine : machine);
    else return;
    listener(roster, event);
  });
}
