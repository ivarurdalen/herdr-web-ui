import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as zlib from "node:zlib";
import { createGunzip, type Gunzip } from "node:zlib";
import type { MachineEvent } from "../shared/machines.ts";
import { handleMachineRequest } from "./machine-api.ts";
import type { MachineManager } from "./machines.ts";

afterEach(() => mock.restore());

const DEADLINE_MS = 2000;
const HEARTBEAT_MS = 15_000;

/** A manager whose listeners the test fires by hand; `listeners` shows what is still subscribed. */
function fakeManager() {
  const listeners = new Set<(event: MachineEvent) => void>();
  const manager = { subscribe: (listener: (event: MachineEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } } as unknown as MachineManager;
  return { manager, listeners, emit: (event: MachineEvent) => { for (const listener of [...listeners]) listener(event); } };
}

/** Holds the heartbeat timer back so a test fires it by hand. */
function heldHeartbeat() {
  let beat: (() => void) | undefined;
  const handle = {} as ReturnType<typeof setInterval>;
  const cleared: unknown[] = [];
  spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === HEARTBEAT_MS) { beat = fn; return handle; }
    return 0 as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval);
  spyOn(globalThis, "clearInterval").mockImplementation(((id: unknown) => { cleared.push(id); }) as unknown as typeof clearInterval);
  return { beat: () => beat!(), handle, cleared };
}

const events = (accept?: string, signal?: AbortSignal) => new Request("http://127.0.0.1:7317/api/machines/events", { headers: accept === undefined ? {} : { "accept-encoding": accept }, ...(signal ? { signal } : {}) });
const roster = (n: number): MachineEvent => ({ type: "machines", machines: [{ id: `pc-${n}` }] } as unknown as MachineEvent);

/** The next text a reader yields, within the deadline. Resolves with "" for a stream that ended. */
function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: not decoded within ${DEADLINE_MS} ms`)), DEADLINE_MS); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Feeds the response's bytes to a gunzip as they arrive, so a frame decodes only if it was flushed. */
function gunzipped(response: Response) {
  const gunzip: Gunzip = createGunzip();
  const reader = response.body!.getReader();
  let decoded = "";
  let wake: (() => void) | undefined;
  gunzip.on("data", (chunk: Buffer) => { decoded += chunk.toString("utf8"); wake?.(); });
  gunzip.on("error", () => wake?.());
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      gunzip.write(value);
    }
  })().catch(() => undefined);
  return {
    /** Waits until `count` complete frames are decoded and returns them all. */
    async frames(count: number): Promise<string[]> {
      await within((async () => {
        while (decoded.split("\n\n").length - 1 < count) await new Promise<void>((resolve) => { wake = resolve; });
      })(), `frame ${count}`);
      return decoded.split("\n\n").slice(0, -1);
    },
    done: async () => { await reader.cancel().catch(() => undefined); gunzip.destroy(); await pump; },
  };
}

describe("the event stream's gzip", () => {
  it("decodes every event and the heartbeat as soon as it is written", async () => {
    const { manager, emit } = fakeManager();
    const heartbeat = heldHeartbeat();
    const abort = new AbortController();
    const response = await handleMachineRequest(events("gzip, deflate, br", abort.signal), manager);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const stream = gunzipped(response);
    try {
      emit(roster(1));
      expect(await stream.frames(1)).toEqual([`data: ${JSON.stringify(roster(1))}`]);
      emit(roster(2));
      expect((await stream.frames(2))[1]).toBe(`data: ${JSON.stringify(roster(2))}`);
      heartbeat.beat();
      expect((await stream.frames(3))[2]).toBe(": heartbeat");
      emit(roster(3));
      expect((await stream.frames(4))[3]).toBe(`data: ${JSON.stringify(roster(3))}`);
    } finally {
      abort.abort();
      await stream.done();
    }
  });

  for (const accept of [undefined, "identity", "gzip;q=0", "br, gzip; q=0.0"]) {
    it(`stays the plain stream for Accept-Encoding ${accept === undefined ? "missing" : accept}`, async () => {
      const { manager, emit } = fakeManager();
      const abort = new AbortController();
      const response = await handleMachineRequest(events(accept, abort.signal), manager);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(Object.fromEntries(response.headers)).toEqual({ "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
      const reader = response.body!.getReader();
      try {
        emit(roster(1));
        const { value } = await within(reader.read(), "plain event");
        expect(new TextDecoder().decode(value)).toBe(`data: ${JSON.stringify(roster(1))}\n\n`);
      } finally {
        abort.abort();
        await reader.cancel().catch(() => undefined);
      }
    });
  }

  it("unsubscribes, stops the heartbeat and destroys its zlib stream when the request aborts", async () => {
    const { manager, listeners, emit } = fakeManager();
    const heartbeat = heldHeartbeat();
    const made = spyOn(zlib, "createGzip");
    const abort = new AbortController();
    const response = await handleMachineRequest(events("gzip", abort.signal), manager);
    const stream = gunzipped(response);
    emit(roster(1));
    await stream.frames(1);
    expect(listeners.size).toBe(1);
    abort.abort();
    expect(listeners.size).toBe(0);
    expect(heartbeat.cleared).toContain(heartbeat.handle);
    expect(made).toHaveBeenCalledTimes(1);
    expect((made.mock.results[0]!.value as zlib.Gzip).destroyed).toBe(true);
    emit(roster(2));
    heartbeat.beat();
    await stream.done();
  });

  it("unsubscribes when the reader cancels", async () => {
    const { manager, listeners, emit } = fakeManager();
    heldHeartbeat();
    const response = await handleMachineRequest(events("gzip"), manager);
    const stream = gunzipped(response);
    emit(roster(1));
    await stream.frames(1);
    await stream.done();
    expect(listeners.size).toBe(0);
  });

  it("closes a reader that stops reading instead of buffering without bound", async () => {
    const { manager, listeners, emit } = fakeManager();
    heldHeartbeat();
    const response = await handleMachineRequest(events("gzip"), manager);
    const reader = response.body!.getReader();
    // Distinct, poorly compressible events so that output keeps queueing in the stream.
    for (let i = 0; emit(roster(i)), listeners.size > 0; i++) {
      if (i > 5000) throw new Error("a stalled reader was never cut off");
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(listeners.size).toBe(0);
    await reader.cancel().catch(() => undefined);
  });
});
