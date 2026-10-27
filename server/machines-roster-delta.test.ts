import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine, MachineEvent } from "../shared/machines.ts";
import { CompletionTracker } from "./completion.ts";
import { MachineManager } from "./machines.ts";
import type { PushService } from "./push.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

type Drive = { machines: Map<string, unknown>; emit(): void; runtime(machine: Machine): unknown };

/** A manager whose local PC is offline and settled, plus two remote PCs added without any network. */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "herdr-roster-delta-"));
  const manager = new MachineManager(dir, {} as PushService, new CompletionTracker(null), async () => { throw new Error("local offline"); });
  cleanups.push(() => { manager.stop(); rmSync(dir, { recursive: true, force: true }); });
  for (let tries = 0; tries < 200 && manager.list()[0]?.state === "connecting"; tries++) await Bun.sleep(5);
  const drive = manager as unknown as Drive;
  const remote = (id: string): Machine => ({ id, name: id, kind: "ssh", enabled: true, state: "connected", error: null, snapshot: null });
  for (const id of ["a", "b"]) drive.machines.set(id, drive.runtime(remote(id)));
  drive.emit();
  const events: MachineEvent[] = [];
  manager.subscribe((event) => events.push(event));
  events.length = 0;
  const pc = (id: string) => manager.list().find((machine) => machine.id === id)!;
  return { manager, drive, events, pc };
}

describe("roster delta events", () => {
  it("sends nothing when no PC changed, whatever the key order of a replaced object", async () => {
    const { drive, events, pc } = await fixture();
    drive.emit();
    expect(events).toEqual([]);
    const reordered = Object.fromEntries(Object.entries(pc("a")).reverse()) as Machine;
    (drive.machines.get("a") as { machine: Machine }).machine = reordered;
    drive.emit();
    expect(events).toEqual([]);
  });

  it("sends one machine event with only the PC that changed, also for an in-place mutation", async () => {
    const { drive, events, pc } = await fixture();
    pc("b").state = "reconnecting";
    drive.emit();
    expect(events).toEqual([{ type: "machine", machine: expect.objectContaining({ id: "b", state: "reconnecting" }) }]);
    events.length = 0;
    pc("a").error = "boom";
    pc("b").error = "boom";
    drive.emit();
    expect(events.map((event) => event.type === "machine" && event.machine.id)).toEqual(["a", "b"]);
    events.length = 0;
    drive.emit();
    expect(events).toEqual([]);
  });

  it("sends the full roster when a PC is added, removed or reordered", async () => {
    const { drive, events, pc } = await fixture();
    drive.machines.set("c", drive.runtime({ ...pc("a"), id: "c" }));
    drive.emit();
    expect(events.map((event) => event.type)).toEqual(["machines"]);
    events.length = 0;
    const [first, second] = [drive.machines.get("a"), drive.machines.get("b")];
    drive.machines.delete("a"); drive.machines.delete("b"); drive.machines.set("b", second); drive.machines.set("a", first);
    drive.emit();
    expect(events.map((event) => event.type === "machines" && event.machines.map((machine) => machine.id))).toEqual([["local", "c", "b", "a"]]);
    events.length = 0;
    drive.machines.delete("c");
    drive.emit();
    expect(events.map((event) => event.type)).toEqual(["machines"]);
  });

  it("gives a new subscriber the full roster at once", async () => {
    const { manager, drive, pc } = await fixture();
    pc("a").state = "error";
    drive.emit();
    const seen: MachineEvent[] = [];
    manager.subscribe((event) => seen.push(event));
    expect(seen.map((event) => event.type)).toEqual(["machines"]);
  });
});
