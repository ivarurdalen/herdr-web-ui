/**
 * /api/agent-sessions: the agent session record (agent-sessions.ts) and its links to pull requests
 * and Linear issues, for the agent sessions page, the grid's tiles and the agent-sessions CLI.
 */
import {
  descriptionBody, linkRequestBody, parseLinearIdentifier, parsePullRequestUrl,
  type AgentSessionRecord, type LinkSuggestion, type LinkTarget,
} from "../shared/agent-sessions.ts";
import type { AgentSessionStore } from "./agent-sessions.ts";
import { badRequest, jsonResponse } from "./http.ts";
import { titleIdentifier, type LinearClient } from "./linear.ts";

export interface PullRequestInfo { url: string; title: string; state: string; repo: string }

export interface GitHub {
  /** pull requests whose head is this branch */
  byHead(branch: string): Promise<PullRequestInfo[]>;
  view(url: string): Promise<{ title: string; state: string } | null>;
}

const DEFAULT_BRANCHES = new Set(["main", "master", "trunk", "develop"]);

async function gh(args: string[]): Promise<unknown> {
  const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error(`gh exited ${code}`);
    return JSON.parse(out);
  } finally {
    clearTimeout(timer);
  }
}

/** GitHub through the gh CLI the hub's user is signed in to. */
export const ghCli: GitHub = {
  async byHead(branch) {
    const found = await gh(["search", "prs", "--head", branch, "--json", "url,title,state,repository", "--limit", "20"]) as Array<{ url: string; title: string; state: string; repository: { name: string } }>;
    return found.map((pr) => ({ url: pr.url, title: pr.title, state: pr.state, repo: pr.repository.name }));
  },
  async view(url) {
    return await gh(["pr", "view", url, "--json", "title,state"]).catch(() => null) as { title: string; state: string } | null;
  },
};

/** Links an automatic run may make for one agent session; links already made or rejected are left out. */
export async function suggestLinks(record: AgentSessionRecord, github: GitHub, linear: LinearClient | null): Promise<LinkSuggestion[]> {
  const known = new Set([...record.pull_requests.map((link) => link.url), ...record.linear_issues.map((link) => link.identifier)]);
  const suggestions: LinkSuggestion[] = [];
  const titles: Array<{ title: string; url: string }> = record.pull_requests.filter((link) => link.status === "linked" && link.title).map((link) => ({ title: link.title!, url: link.url }));
  if (record.branch && !DEFAULT_BRANCHES.has(record.branch)) {
    const prs = await github.byHead(record.branch).catch(() => []);
    for (const pr of prs.filter((candidate) => record.repo === null || candidate.repo === record.repo)) {
      const parsed = parsePullRequestUrl(pr.url);
      if (parsed === null) continue;
      titles.push({ title: pr.title, url: parsed.url });
      if (known.has(parsed.url)) continue;
      known.add(parsed.url);
      suggestions.push({ kind: "pull_request", url: parsed.url, title: pr.title, state: pr.state, evidence: `its head branch is ${record.branch}, the agent session's branch` });
    }
  }
  const identifiers = titles.flatMap(({ title, url }) => {
    const identifier = titleIdentifier(title);
    return identifier === null || known.has(identifier) ? [] : [{ identifier, url }];
  });
  const issues = linear && identifiers.length > 0 ? await linear.issues(identifiers.map((item) => item.identifier)).catch(() => new Map()) : new Map();
  for (const { identifier, url } of identifiers) {
    if (known.has(identifier) || (linear && !issues.has(identifier))) continue;
    known.add(identifier);
    const issue = issues.get(identifier);
    suggestions.push({ kind: "linear_issue", identifier, url: issue?.url ?? null, title: issue?.title ?? null, state: issue?.state ?? null, evidence: `the title of ${url} starts with it` });
  }
  return suggestions;
}

function linkTarget(raw: unknown): LinkTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (body["kind"] === "pull_request" && typeof body["url"] === "string") {
    const pr = parsePullRequestUrl(body["url"]);
    return pr === null ? null : { kind: "pull_request", url: pr.url };
  }
  if (body["kind"] === "linear_issue" && typeof body["identifier"] === "string") {
    const identifier = parseLinearIdentifier(body["identifier"]);
    return identifier === null ? null : { kind: "linear_issue", identifier };
  }
  return null;
}

async function readBody(request: Request): Promise<unknown> {
  try { return JSON.parse(await request.text()); } catch { return null; }
}

export async function handleAgentSessionRequest(request: Request, pathname: string, store: AgentSessionStore, github: GitHub, linear: LinearClient | null): Promise<Response> {
  if (pathname === "/api/agent-sessions") {
    if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
    return jsonResponse({ agent_sessions: store.list() });
  }
  const match = /^\/api\/agent-sessions\/(\d+)(\/links|\/suggestions|\/description)?$/.exec(pathname);
  if (!match) return jsonResponse({ error: { code: "not_found", message: "no such agent session route" } }, 404);
  const id = Number(match[1]);
  const record = store.get(id);
  if (record === null) return jsonResponse({ error: { code: "not_found", message: "no such agent session" } }, 404);
  if (match[2] === undefined) {
    if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
    return jsonResponse({ agent_session: record });
  }
  if (match[2] === "/description") {
    if (request.method !== "PUT") return badRequest("method_not_allowed", "use PUT");
    const description = descriptionBody(await readBody(request));
    if (description === undefined) return badRequest("bad_description", "send { description } with at most three lines and 600 characters, or null to clear it");
    return jsonResponse({ agent_session: store.describe(id, description) });
  }
  if (match[2] === "/suggestions") {
    if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
    return jsonResponse({ suggestions: await suggestLinks(record, github, linear) });
  }
  if (request.method === "POST") {
    const link = linkRequestBody(await readBody(request));
    if (link === null) return badRequest("bad_link", "send { kind: \"pull_request\", url } or { kind: \"linear_issue\", identifier }, with an optional source and reason");
    const facts = link.kind === "pull_request"
      ? await github.view(link.url).catch(() => null) ?? {}
      : await linear?.issues([link.identifier]).then((found) => found.get(link.identifier) ?? {}).catch(() => ({})) ?? {};
    return jsonResponse({ agent_session: store.link(id, link, facts) });
  }
  if (request.method === "DELETE") {
    const target = linkTarget(await readBody(request));
    if (target === null) return badRequest("bad_link", "send { kind: \"pull_request\", url } or { kind: \"linear_issue\", identifier }");
    return jsonResponse({ agent_session: store.unlink(id, target) });
  }
  return badRequest("method_not_allowed", "use POST to link or DELETE to unlink");
}
