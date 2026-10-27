import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { createInflateRaw, deflateRawSync, constants } from "node:zlib";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import { MachineRelay } from "../machine-relay.ts";
import type { MachineManager } from "../machines.ts";
import { connectionData, type SocketData } from "./connections.ts";
import { createSocket } from "./socket.ts";

/**
 * The wire proof: a raw TCP client does the WebSocket handshake itself, so it sees the RSV1 bit that
 * Bun's own client would hide. Frames go out compressed only above the size threshold.
 */

const DEADLINE_MS = 2000;
const TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const BIG = "x".repeat(600);

interface Frame { rsv1: boolean; opcode: number; payload: Buffer }

/** Reads frames off a raw socket; a compressed one is inflated with the connection's shared window. */
async function rawClient(port: number, extensions: string | null) {
  let buffer = Buffer.alloc(0);
  let headers: string | null = null;
  const frames: Frame[] = [];
  let wake: (() => void) | undefined;
  const socket = await Bun.connect({
    hostname: "127.0.0.1", port,
    socket: {
      data(_socket, chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        if (headers === null) {
          const end = buffer.indexOf("\r\n\r\n");
          if (end < 0) return;
          headers = buffer.subarray(0, end).toString("latin1");
          buffer = buffer.subarray(end + 4);
        }
        for (;;) {
          if (buffer.length < 2) break;
          let length = buffer[1]! & 0x7f;
          let offset = 2;
          if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); offset = 4; }
          else if (length === 127) { if (buffer.length < 10) break; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
          if (buffer.length < offset + length) break;
          frames.push({ rsv1: (buffer[0]! & 0x40) !== 0, opcode: buffer[0]! & 0x0f, payload: Buffer.from(buffer.subarray(offset, offset + length)) });
          buffer = buffer.subarray(offset + length);
        }
        wake?.();
      },
      error() {},
    },
  });
  socket.write([
    "GET /ws HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade",
    `Sec-WebSocket-Key: ${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64")}`, "Sec-WebSocket-Version: 13",
    ...(extensions === null ? [] : [`Sec-WebSocket-Extensions: ${extensions}`]), "", "",
  ].join("\r\n"));
  const waitFor = async (ready: () => boolean, what: string) => {
    const timer = setTimeout(() => wake?.(), DEADLINE_MS);
    try { while (!ready()) { const before = Date.now(); await new Promise<void>((resolve) => { wake = resolve; }); if (!ready() && Date.now() - before >= DEADLINE_MS) throw new Error(`${what}: not seen within ${DEADLINE_MS} ms`); } }
    finally { clearTimeout(timer); }
  };
  const inflate = createInflateRaw();
  const text = (frame: Frame): Promise<string> => {
    if (!frame.rsv1) return Promise.resolve(frame.payload.toString("utf8"));
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const collect = (chunk: Buffer) => { chunks.push(chunk); };
      inflate.on("data", collect);
      inflate.write(Buffer.concat([frame.payload, TAIL]));
      inflate.flush(constants.Z_SYNC_FLUSH, () => { inflate.off("data", collect); resolve(Buffer.concat(chunks).toString("utf8")); });
    });
  };
  /** A masked text frame from the client, deflated like a browser's when asked to. */
  const send = (message: string, deflate = false) => {
    const body = Buffer.from(message);
    const payload = deflate ? deflateRawSync(body, { finishFlush: constants.Z_SYNC_FLUSH }).subarray(0, -4) : body;
    const mask = crypto.getRandomValues(new Uint8Array(4));
    const head = payload.length < 126 ? Buffer.from([0x80 | (deflate ? 0x40 : 0) | 1, 0x80 | payload.length]) : Buffer.from([0x80 | (deflate ? 0x40 : 0) | 1, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    socket.write(Buffer.concat([head, mask, payload.map((byte, i) => byte ^ mask[i % 4]!)]));
  };
  await waitFor(() => headers !== null, "handshake");
  return {
    negotiated: (/sec-websocket-extensions: *([^\r\n]*)/i.exec(headers!)?.[1] ?? "").toLowerCase().includes("permessage-deflate"),
    frames, text, send, waitFor,
    // the close handshake, so the server logs a normal end and not an abnormal one
    end: async () => {
      inflate.destroy();
      socket.write(Buffer.from([0x88, 0x82, 0, 0, 0, 0, 0x03, 0xe8]));
      await waitFor(() => frames.some((frame) => frame.opcode === 8), "close reply");
      socket.end();
    },
  };
}

function snapshotServer(clientSnapshot: () => Promise<SessionSnapshot>, relay?: () => MachineRelay): Server<SocketData> {
  const handler = createSocket({
    clients: new Set(), present: new Set(), stopped: () => false, admit: () => true, setRole() {}, watchPane() {}, unwatchPane() {},
    end() {}, holdPending() {}, attachments: new Map(), clientSnapshot, countVisit() {}, drainOutput() {}, frames: {} as never,
  });
  return Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(request, server) {
      const data = connectionData({ deviceId: undefined, readOnly: false, ...(relay ? { relay: relay() } : {}) });
      return server.upgrade(request, { data }) ? undefined : new Response("upgrade required", { status: 426 });
    },
    websocket: handler,
  });
}

describe("local send path", () => {
  let server: Server<SocketData>;
  const snapshot = { big: BIG } as unknown as SessionSnapshot;
  beforeAll(() => { server = snapshotServer(async () => snapshot); });
  afterAll(() => { server.stop(true); });

  it("deflates a frame at the threshold and sends a small one plain, both intact", async () => {
    const client = await rawClient(server.port!, "permessage-deflate");
    try {
      expect(client.negotiated).toBe(true);
      await client.waitFor(() => client.frames.length >= 1, "snapshot");
      const [first] = client.frames;
      expect(first!.rsv1).toBe(true);
      expect(first!.payload.length).toBeLessThan(BIG.length);
      expect(JSON.parse(await client.text(first!))).toMatchObject({ type: "snapshot", snapshot });
      // the client's own frames may be deflated too: a browser deflates what it sends once negotiated
      client.send(JSON.stringify({ type: "ping", id: 7 }), true);
      await client.waitFor(() => client.frames.length >= 2, "pong");
      expect(client.frames[1]!.rsv1).toBe(false);
      expect(JSON.parse(await client.text(client.frames[1]!))).toEqual({ type: "pong", id: 7 });
    } finally { await client.end(); }
  });

  it("sends every frame plain, intact, to a client that did not negotiate the extension", async () => {
    const client = await rawClient(server.port!, null);
    try {
      expect(client.negotiated).toBe(false);
      await client.waitFor(() => client.frames.length >= 1, "snapshot");
      expect(client.frames[0]!.rsv1).toBe(false);
      expect(JSON.parse(await client.text(client.frames[0]!))).toMatchObject({ type: "snapshot", snapshot });
      client.send(JSON.stringify({ type: "ping", id: 8 }));
      await client.waitFor(() => client.frames.length >= 2, "pong");
      expect(JSON.parse(await client.text(client.frames[1]!))).toEqual({ type: "pong", id: 8 });
    } finally { await client.end(); }
  });
});

describe("relay send path", () => {
  let upstream: Server<undefined>;
  let server: Server<SocketData>;
  const SMALL = JSON.stringify({ type: "pong", id: 1 });
  const LARGE = JSON.stringify({ type: "pty-data", data: BIG });
  beforeAll(() => {
    upstream = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      fetch(request, srv) { return srv.upgrade(request) ? undefined : new Response("no", { status: 400 }); },
      websocket: { open(ws) { ws.send(LARGE); ws.send(SMALL); ws.send(LARGE); }, message() {} },
    });
    const manager = { endpoint: () => ({ url: `http://127.0.0.1:${upstream.port}`, token: "test" }), trackTerminal: () => () => {} } as unknown as MachineManager;
    server = snapshotServer(async () => ({}) as SessionSnapshot, () => new MachineRelay(manager, "pc"));
  });
  afterAll(() => { server.stop(true); upstream.stop(true); });

  it("deflates a relayed frame at the threshold and sends a small one plain, both intact", async () => {
    const client = await rawClient(server.port!, "permessage-deflate");
    try {
      expect(client.negotiated).toBe(true);
      await client.waitFor(() => client.frames.length >= 3, "relayed frames");
      expect(client.frames.map((frame) => frame.rsv1)).toEqual([true, false, true]);
      // one shared deflate window: frames are inflated in the order they arrived
      const texts: string[] = [];
      for (const frame of client.frames) texts.push(await client.text(frame));
      expect(texts).toEqual([LARGE, SMALL, LARGE]);
    } finally { await client.end(); }
  });

  it("relays every frame plain, intact, to a client that did not negotiate the extension", async () => {
    const client = await rawClient(server.port!, null);
    try {
      expect(client.negotiated).toBe(false);
      await client.waitFor(() => client.frames.length >= 3, "relayed frames");
      expect(client.frames.map((frame) => frame.rsv1)).toEqual([false, false, false]);
      expect(client.frames.map((frame) => frame.payload.toString("utf8"))).toEqual([LARGE, SMALL, LARGE]);
    } finally { await client.end(); }
  });
});
