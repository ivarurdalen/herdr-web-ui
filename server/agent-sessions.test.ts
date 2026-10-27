import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { descriptionBody, linkRequestBody, resumeCommand } from "../shared/agent-sessions.ts";
import type { Machine } from "../shared/machines.ts";
import { machineSightings, startAgentSessionIngest } from "./agent-session-ingest.ts";
import { handleAgentSessionRequest, suggestLinks } from "./agent-session-routes.ts";
import { AgentSessionStore, type AgentSessionSighting } from "./agent-sessions.ts";

function sighting(id: string, overrides: Partial<AgentSessionSighting> = {}): AgentSessionSighting {
  return {
    machine_id: "box", machine_name: "box/private", host: "box", herdr_session: "private", agent: "claude",
    agent_session_id: id, agent_session_kind: "id", pane_id: "w1:p1", workspace_id: "w1", workspace_label: "devkit-grok",
    repo: "devkit", branch: null, cwd: "/home/me/devkit", title: null, ...overrides,
  };
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 12, minute));
const PR = "https://github.com/me/devkit/pull/7";

describe("AgentSessionStore", () => {
  it("records when an agent session was first and last seen, and when it ended", () => {
    const store = new AgentSessionStore(":memory:");
    store.observe("box", [sighting("a"), sighting("b", { branch: "feat/x" })], at(0));
    store.observe("box", [sighting("b")], at(5));
    const [b, a] = store.list();
    expect(a).toMatchObject({ agent_session_id: "a", first_seen_at: at(0).toISOString(), last_seen_at: at(0).toISOString(), ended_at: at(5).toISOString() });
    expect(b).toMatchObject({ agent_session_id: "b", last_seen_at: at(5).toISOString(), ended_at: null, branch: "feat/x" });
    expect(b!.resume_command).toBe("cd /home/me/devkit && claude --resume b");
  });

  it("opens an ended agent session again when it comes back, and leaves other PCs alone", () => {
    const store = new AgentSessionStore(":memory:");
    store.observe("box", [sighting("a")], at(0));
    store.observe("other", [sighting("z", { machine_id: "other" })], at(0));
    store.observe("box", [], at(1));
    store.observe("box", [sighting("a")], at(2));
    expect(store.list().map((row) => [row.agent_session_id, row.ended_at])).toEqual([["a", null], ["z", null]]);
  });

  it("links many to many, and keeps a removed link rejected", () => {
    const store = new AgentSessionStore(":memory:");
    store.observe("box", [sighting("a"), sighting("b")], at(0));
    const [first, second] = store.list().map((row) => row.id);
    store.link(first!, { kind: "pull_request", url: `${PR}/files`, source: "agent", reason: "branch head" }, { title: "Fix", state: "OPEN" });
    store.link(second!, { kind: "pull_request", url: PR, source: "rule" });
    store.link(first!, { kind: "linear_issue", identifier: "ENG-1" }, { url: "https://linear.app/x/issue/ENG-1" });
    store.link(first!, { kind: "linear_issue", identifier: "ENG-2" });
    const linked = store.get(first!)!;
    expect(linked.pull_requests).toMatchObject([{ url: PR, repo: "me/devkit", number: 7, title: "Fix", status: "linked", source: "agent", reason: "branch head" }]);
    expect(linked.linear_issues.map((issue) => issue.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(store.get(second!)!.pull_requests[0]).toMatchObject({ url: PR, title: "Fix" });
    expect(store.unlink(first!, { kind: "linear_issue", identifier: "ENG-2" })!.linear_issues[1]).toMatchObject({ identifier: "ENG-2", status: "rejected", source: "manual" });
    expect(store.link(999, { kind: "linear_issue", identifier: "ENG-1" })).toBeNull();
  });

  it("keeps a short description with when it was written, and refuses a long one", () => {
    const store = new AgentSessionStore(":memory:");
    store.observe("box", [sighting("a")], at(0));
    const id = store.list()[0]!.id;
    expect(store.describe(id, "- **Grok:** install the CLI", at(3))).toMatchObject({ description: "- **Grok:** install the CLI", description_updated_at: at(3).toISOString() });
    expect(store.describe(id, null)).toMatchObject({ description: null, description_updated_at: null });
    expect(descriptionBody({ description: "- one\n\n- two\n- three  " })).toBe("- one\n- two\n- three");
    expect(descriptionBody({ description: "1\n2\n3\n4" })).toBeUndefined();
    expect(descriptionBody({ description: "  " })).toBeNull();
  });

  it("adds the description to a record made before it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "agent-sessions-")), "agent-sessions.sqlite");
    const first = new AgentSessionStore(path);
    first.observe("box", [sighting("a")], at(0));
    first.close();
    const raw = new Database(path);
    raw.exec("ALTER TABLE agent_sessions DROP COLUMN description; ALTER TABLE agent_sessions DROP COLUMN description_updated_at; PRAGMA user_version = 1;");
    raw.close();
    const again = new AgentSessionStore(path);
    expect(again.describe(again.list()[0]!.id, "- **x:** y", at(1))!.description).toBe("- **x:** y");
    again.close();
  });

  it("keeps its record across a restart", () => {
    const path = join(mkdtempSync(join(tmpdir(), "agent-sessions-")), "agent-sessions.sqlite");
    const store = new AgentSessionStore(path);
    store.observe("box", [sighting("a")], at(0));
    store.close();
    const again = new AgentSessionStore(path);
    expect(again.list().map((row) => row.agent_session_id)).toEqual(["a"]);
    again.close();
  });
});

describe("link requests and resume commands", () => {
  it("accepts a pull request URL or a Linear id, and nothing else", () => {
    expect(linkRequestBody({ kind: "pull_request", url: `${PR}#discussion`, source: "agent", reason: "named in the chat" }))
      .toEqual({ kind: "pull_request", url: PR, source: "agent", reason: "named in the chat" });
    expect(linkRequestBody({ kind: "linear_issue", identifier: "eng-12" })).toEqual({ kind: "linear_issue", identifier: "ENG-12" });
    expect(linkRequestBody({ kind: "pull_request", url: "https://example.com/pull/1" })).toBeNull();
    expect(linkRequestBody({ kind: "linear_issue", identifier: "ENG-12", source: "robot" })).toBeNull();
  });

  it("resumes Claude and Codex agent sessions by id only, with a quoted folder", () => {
    expect(resumeCommand("codex", "019a-x", "id", "/w/my repo")).toBe("cd '/w/my repo' && codex resume 019a-x");
    expect(resumeCommand("claude", "pane:term_1", "pane", null)).toBeNull();
    expect(resumeCommand("pi", "abc", "id", null)).toBeNull();
  });
});

describe("ingest and routes", () => {
  const machine = {
    id: "box", name: "box/private", kind: "ssh", enabled: true, state: "connected", error: null, target: { destination: "me@box", session: "private" },
    snapshot: {
      protocol: 22, version: "t", layouts: [], tabs: [],
      workspaces: [{ workspace_id: "w1", label: "devkit-grok", tokens: { paddock_repo: "devkit" }, active_tab_id: "w1:t1", number: 1, tab_count: 1, pane_count: 2, focused: false, agent_status: "idle" }],
      panes: [
        { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "t1", revision: 1, focused: false, agent_status: "idle", agent: "claude", cwd: "/w/devkit" },
        { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "t2", revision: 1, focused: false, agent_status: "idle", agent: null },
      ],
      agents: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "t1", revision: 1, focused: false, agent_status: "idle", agent: "claude",
        title: "Grok install", agent_session: { source: "herdr:claude", agent: "claude", kind: "id", value: "abc-1" } }],
    },
  } as unknown as Machine;

  it("takes each agent pane of a PC entry, with its herdr session and repo, and no shell", () => {
    expect(machineSightings(machine, new Set())).toEqual([expect.objectContaining({
      machine_id: "box", host: "box", herdr_session: "private", agent: "claude", agent_session_id: "abc-1", agent_session_kind: "id",
      repo: "devkit", workspace_label: "devkit-grok", cwd: "/w/devkit", title: "Grok install",
    })]);
  });

  it("records what the PCs report, with the branch looked up", async () => {
    const store = new AgentSessionStore(":memory:");
    let listener: ((event: { type: string; machines?: Machine[] }) => void) | null = null;
    const stop = startAgentSessionIngest(store, { subscribe: (next) => { listener = next; return () => {}; } }, async () => "feat/grok");
    listener!({ type: "machines", machines: [machine] });
    for (let tries = 0; tries < 50 && store.list().length === 0; tries++) await Bun.sleep(10);
    stop();
    expect(store.list()).toMatchObject([{ agent_session_id: "abc-1", branch: "feat/grok", resume_command: "cd /w/devkit && claude --resume abc-1" }]);
  });

  it("takes a single changed PC from a machine event without another full roster", async () => {
    const store = new AgentSessionStore(":memory:");
    let listener: ((event: { type: string; machines?: Machine[]; machine?: Machine }) => void) | null = null;
    const stop = startAgentSessionIngest(store, { subscribe: (next) => { listener = next; return () => {}; } }, async () => "feat/grok");
    listener!({ type: "machines", machines: [{ ...machine, snapshot: null } as Machine] });
    listener!({ type: "machine", machine });
    for (let tries = 0; tries < 50 && store.list().length === 0; tries++) await Bun.sleep(10);
    stop();
    expect(store.list()).toMatchObject([{ agent_session_id: "abc-1", branch: "feat/grok" }]);
  });

  it("suggests the branch's pull request and the Linear id its title starts with", async () => {
    const store = new AgentSessionStore(":memory:");
    store.observe("box", [sighting("a", { branch: "feat/grok" })], at(0));
    const record = store.list()[0]!;
    const github = {
      byHead: async () => [{ url: PR, title: "ENG-9: grok", state: "OPEN", repo: "devkit" }, { url: "https://github.com/x/other/pull/1", title: "other", state: "OPEN", repo: "other" }],
      view: async () => ({ title: "ENG-9: grok", state: "OPEN" }),
    };
    const linear = { issues: async (ids: readonly string[]) => new Map(ids.map((identifier) => [identifier, { identifier, url: `https://linear.app/x/issue/${identifier}`, title: "Grok", state: "Todo" }])) };
    expect(await suggestLinks(record, github, linear)).toEqual([
      { kind: "pull_request", url: PR, title: "ENG-9: grok", state: "OPEN", evidence: "its head branch is feat/grok, the agent session's branch" },
      { kind: "linear_issue", identifier: "ENG-9", url: "https://linear.app/x/issue/ENG-9", title: "Grok", state: "Todo", evidence: `the title of ${PR} starts with it` },
    ]);
    const post = (body: unknown, method = "POST") => handleAgentSessionRequest(new Request(`http://x/api/agent-sessions/${record.id}/links`, { method, body: JSON.stringify(body) }), `/api/agent-sessions/${record.id}/links`, store, github, linear);
    const linked = await (await post({ kind: "pull_request", url: PR, source: "agent", reason: "branch" })).json() as { agent_session: { pull_requests: Array<{ title: string }> } };
    expect(linked.agent_session.pull_requests[0]!.title).toBe("ENG-9: grok");
    await post({ kind: "linear_issue", identifier: "ENG-9" }, "DELETE");
    expect(await suggestLinks(store.get(record.id)!, github, linear)).toEqual([]);
    expect((await post({ kind: "linear_issue", identifier: "nope" })).status).toBe(400);
  });
});
