/**
 * Linear lookups for the agent session links (agent-sessions.ts). Works with any Linear workspace:
 * the API key comes from HERDR_WEB_LINEAR_API_KEY, else from the linear CLI's credentials file
 * under the workspace HERDR_WEB_LINEAR_WORKSPACE names. Without a key, issue ids are still
 * recognized and linked; they just carry no title, state or verified URL.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LinearIssue {
  identifier: string;
  url: string | null;
  title: string | null;
  state: string | null;
}

export interface LinearClient {
  /** the issues of these ids that exist, by id; ids of no team are left out */
  issues(identifiers: readonly string[]): Promise<Map<string, LinearIssue>>;
}

/** An issue id like `ENG-123`: a team key, a dash, a number. */
const IDENTIFIER = /\b([A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6})\b/g;

/** Every Linear-looking issue id in a text, each once, in order. */
export function linearIdentifiers(text: string): string[] {
  return [...new Set([...text.matchAll(IDENTIFIER)].map((match) => match[1]!))];
}

/** The issue id a PR title starts with (`ENG-123: fix`, `[ENG-123] fix`), if any. */
export function titleIdentifier(title: string): string | null {
  return /^\s*\[?([A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6})\]?\b/.exec(title)?.[1] ?? null;
}

/** The workspace's key from the linear CLI's credentials.toml (`<workspace> = "<key>"` lines). */
export function credentialsKey(text: string, workspace: string): string | null {
  for (const line of text.split("\n")) {
    const match = /^\s*"?([\w-]+)"?\s*=\s*"([^"]+)"\s*$/.exec(line);
    if (match && match[1] === workspace) return match[2]!;
  }
  return null;
}

function apiKey(): string | null {
  const fromEnv = process.env["HERDR_WEB_LINEAR_API_KEY"]?.trim();
  if (fromEnv) return fromEnv;
  const workspace = process.env["HERDR_WEB_LINEAR_WORKSPACE"]?.trim() || "default";
  try {
    return credentialsKey(readFileSync(join(homedir(), ".config", "linear", "credentials.toml"), "utf8"), workspace);
  } catch {
    return null;
  }
}

/** A client over Linear's GraphQL API, or null with no key configured. */
export function linearClient(fetcher: typeof fetch = fetch, key: string | null = apiKey()): LinearClient | null {
  if (key === null) return null;
  const graphql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const response = await fetcher("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    // never echo the response body: an auth error can quote the request
    if (!response.ok) throw new Error(`Linear answered ${response.status}`);
    const body = await response.json() as { data?: T; errors?: unknown[] };
    if (!body.data) throw new Error("Linear answered without data");
    return body.data;
  };
  let teams: Promise<Set<string>> | null = null;
  return {
    async issues(identifiers) {
      teams ??= graphql<{ teams: { nodes: Array<{ key: string }> } }>("query { teams(first: 250) { nodes { key } } }", {})
        .then((data) => new Set(data.teams.nodes.map((team) => team.key)))
        .catch((error: unknown) => { teams = null; throw error; });
      const known = await teams;
      const found = new Map<string, LinearIssue>();
      for (const identifier of identifiers) {
        if (!known.has(identifier.split("-")[0]!)) continue;
        const data = await graphql<{ issue: { identifier: string; url: string; title: string; state: { name: string } | null } | null }>(
          "query Issue($id: String!) { issue(id: $id) { identifier url title state { name } } }", { id: identifier },
        ).catch(() => ({ issue: null }));
        if (data.issue) found.set(identifier, { identifier: data.issue.identifier, url: data.issue.url, title: data.issue.title, state: data.issue.state?.name ?? null });
      }
      return found;
    },
  };
}

