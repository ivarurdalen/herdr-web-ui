import type { WorkspaceInfo } from "./protocol.ts";

/** The repo a workspace names outright: its `paddock_repo` token or its git worktree's repo. */
export function workspaceRepoHint(workspace: WorkspaceInfo): string | null {
  const token = workspace.tokens?.["paddock_repo"];
  if (typeof token === "string" && token.trim()) return token.trim();
  return workspace.worktree?.repo_name || null;
}

/** The repo a workspace works on: its repo token or git worktree, else the known repo its label is prefixed with (`repo-topic`). */
export function workspaceRepo(workspace: WorkspaceInfo, known: ReadonlySet<string>): string {
  const hint = workspaceRepoHint(workspace);
  if (hint !== null) return hint;
  let best: string | null = null;
  for (const repo of known) {
    if ((workspace.label === repo || workspace.label.startsWith(`${repo}-`)) && repo.length > (best?.length ?? 0)) best = repo;
  }
  return best ?? workspace.label;
}

