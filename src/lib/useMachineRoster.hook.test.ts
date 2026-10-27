import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Machine, MachineEvent } from "../../shared/machines.ts";
import { SnapshotRequests } from "./snapshotRequests.ts";
import { ReorderCoordinator } from "./workspaceOrder.ts";
import { applyRosterEvent, useRosterEvents, useRosterState } from "./useMachineRoster.ts";

const pc = (id: string, state = "connected"): Machine => ({ id, name: id, kind: "ssh", enabled: true, state, error: null, snapshot: null }) as Machine;
const full = (...machines: Machine[]): MachineEvent => ({ type: "machines", machines });
const delta = (machine: Machine): MachineEvent => ({ type: "machine", machine });

describe("applyRosterEvent", () => {
  it("replaces the roster on a full event and one PC on a machine event", () => {
    const [a, b] = [pc("a"), pc("b")];
    const roster = applyRosterEvent([], full(a, b) as never)!;
    expect(roster).toEqual([a, b]);
    const next = applyRosterEvent(roster, delta(pc("b", "reconnecting")) as never)!;
    expect(next.map((machine) => machine.state)).toEqual(["connected", "reconnecting"]);
    expect(next[0]).toBe(a);
  });

  it("ignores a PC the roster does not hold", () => {
    expect(applyRosterEvent([pc("a")], delta(pc("x")) as never)).toBeNull();
  });
});

class FakeSource {
  static all: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  readyState = 1;
  constructor(readonly url: string) { FakeSource.all.push(this); }
  close(): void { this.readyState = 2; }
  tell(event: MachineEvent): void { this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>); }
}

function mount() {
  const rosters: Machine[][] = [];
  let latest: Machine[] = [];
  let setter: ReturnType<typeof useRosterState>["setMachines"] | null = null;
  const ref = <T,>(current: T) => ({ current });
  const reorderCoordinator = new ReorderCoordinator({ verify: async () => ({ kind: "unknown" }) as never, onSettled: () => {} });
  const noop = () => {};
  const fixed = {
    receivePreferencesRef: ref(noop), snapshotRequests: ref(new SnapshotRequests()), onRoster: (machines: Machine[]) => { rosters.push(machines); },
    reorderCoordinator, rosterIn: noop, onPaneStatus: noop, onPaneExited: noop, followFocusRef: ref(false), selectionRef: ref(null),
    splitShownRef: ref(false), splitRef: ref(null), pendingLink: ref(null), selectionHint: ref(null), setSelectedPaneId: noop,
    setNotificationViewTarget: noop, setTerminalPeek: noop, setAutoSelected: noop, scheduleRefetch: noop,
    preferencesResubscribedRef: ref(noop), preferencesDisconnectedRef: ref(noop), preferencesClosedRef: ref(noop),
    dropIn: noop, chime: noop, getTakeNotificationTargetRef: () => ref(noop),
  };
  function Probe() {
    const state = useRosterState();
    latest = state.machines; setter = state.setMachines;
    useRosterEvents({ ...fixed, locked: false, setMachines: state.setMachines, setMachineRosterLoaded: state.setMachineRosterLoaded, machinesRef: ref(state.machines) } as never);
    return null;
  }
  let renderer: ReactTestRenderer | null = null;
  act(() => { renderer = create(createElement(Probe)); });
  return {
    rosters, machines: () => latest, setMachines: () => setter!, stream: () => FakeSource.all.at(-1)!,
    unmount: () => act(() => { renderer!.unmount(); }),
  };
}

describe("the roster hook", () => {
  const realSource = globalThis.EventSource;
  const mounted: { unmount: () => void }[] = [];
  beforeAll(() => { Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true }); });
  afterEach(() => { for (const probe of mounted.splice(0)) probe.unmount(); globalThis.EventSource = realSource; FakeSource.all = []; });
  const start = () => { globalThis.EventSource = FakeSource as never; const probe = mount(); mounted.push(probe); return probe; };

  it("merges a PC event onto the roster the stream last sent", () => {
    const probe = start();
    act(() => { probe.stream().tell(full(pc("a"), pc("b"))); });
    act(() => { probe.stream().tell(delta(pc("b", "reconnecting"))); });
    expect(probe.machines().map((machine) => machine.state)).toEqual(["connected", "reconnecting"]);
  });

  it("keeps two PC events of one burst, before any render", () => {
    const probe = start();
    act(() => {
      probe.stream().tell(full(pc("a"), pc("b")));
      probe.stream().tell(delta(pc("a", "error")));
      probe.stream().tell(delta(pc("b", "reconnecting")));
    });
    expect(probe.machines().map((machine) => machine.state)).toEqual(["error", "reconnecting"]);
    expect(probe.rosters.at(-1)!.map((machine) => machine.state)).toEqual(["error", "reconnecting"]);
  });

  it("merges a PC event onto a roster a poll just set", () => {
    const probe = start();
    act(() => {
      probe.stream().tell(full(pc("a"), pc("b")));
      probe.setMachines()([pc("a", "polled"), pc("b"), pc("c")]);
      probe.stream().tell(delta(pc("b", "error")));
    });
    expect(probe.machines().map((machine) => `${machine.id}:${machine.state}`)).toEqual(["a:polled", "b:error", "c:connected"]);
  });

  it("ignores a PC event for an unknown id", () => {
    const probe = start();
    act(() => { probe.stream().tell(full(pc("a"))); });
    const before = probe.rosters.length;
    act(() => { probe.stream().tell(delta(pc("x"))); });
    expect(probe.rosters.length).toBe(before);
    expect(probe.machines().map((machine) => machine.id)).toEqual(["a"]);
  });
});
