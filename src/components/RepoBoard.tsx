import { useMemo, type CSSProperties } from "react";
import type { Machine } from "../../shared/machines.ts";
import { gridTiles, newGridView, newViewId, openRepoView, storeGridViewId } from "../lib/agentGrid.ts";
import { useAgentSessions } from "../lib/agentSessions.ts";
import { useT } from "../lib/i18n.ts";
import { REPO_STATUSES, repoColor, repoStats, type RepoAgent, type RepoStats } from "../lib/repoBoard.ts";
import { useSettings } from "../lib/settings.ts";
import type { KnownStatus } from "../lib/status.ts";
import { tileTitle } from "./AgentGrid.tsx";
import "./RepoBoard.css";

interface Props {
  machines: readonly Machine[];
  /** shows the agent grid, after a card picked the repo's view */
  onOpenGrid: () => void;
}

/** A card shows this many agents by name; the rest are counted. */
const AGENTS_SHOWN = 5;

function useStatusLabels(): Record<KnownStatus, string> {
  const t = useT();
  return { blocked: t("Needs input"), working: t("Working"), waiting: t("Waiting"), done: t("Done"), idle: t("Idle"), unknown: t("Unknown") };
}

/** One status with its count, dimmed at zero so every card lines up. */
function StatusCount({ status, count }: { status: KnownStatus; count: number }) {
  const label = useStatusLabels();
  return (
    <span className={`repo-count${count === 0 ? " is-zero" : ""}`} data-status={status}>
      <span className="repo-count-dot" aria-hidden="true" />
      <span className="repo-count-label">{label[status]}</span>
      <span className="repo-count-n">{count}</span>
    </span>
  );
}

/** The repo's agents by name with their status, the ones in a turn first. */
function AgentList({ agents }: { agents: readonly RepoAgent[] }) {
  const t = useT();
  const label = useStatusLabels();
  const hidden = agents.length - AGENTS_SHOWN;
  return (
    <span className="repo-card-agents">
      {agents.slice(0, AGENTS_SHOWN).map(({ tile, status }) => (
        <span key={tile.key} className={`repo-agent${status === "done" || status === "idle" ? " is-inactive" : ""}`} data-status={status}>
          <span className="repo-count-dot" aria-hidden="true" />
          <span className="repo-agent-name">{tileTitle(tile)}</span>
          <span className="repo-agent-status">{label[status]}</span>
        </span>
      ))}
      {hidden > 0 && <span className="repo-agent-more">{t("{n} more agents", { n: hidden })}</span>}
    </span>
  );
}

function RepoCard({ stats, onOpen }: { stats: RepoStats; onOpen: () => void }) {
  const t = useT();
  const style = { "--repo-color": repoColor(stats.repo) } as CSSProperties;
  return (
    <button type="button" className="repo-card" style={style} data-blocked={stats.counts.blocked > 0 ? "" : undefined}
      title={t("Open the agent grid on {repo}", { repo: stats.repo })} onClick={onOpen}>
      <span className="repo-card-head">
        <span className="repo-card-badge" aria-hidden="true">{stats.repo.trim().charAt(0).toUpperCase() || "?"}</span>
        <span className="repo-card-name">{stats.repo}</span>
        <span className="repo-card-total" title={t("{n} agents", { n: stats.total })}>{stats.total}</span>
      </span>
      <span className="repo-card-activity">
        <span className={stats.active === 0 ? "is-zero" : "is-active"}>{t("{n} active", { n: stats.active })}</span>
        <span className="repo-card-sep" aria-hidden="true">·</span>
        <span className={stats.inactive === 0 ? "is-zero" : undefined}>{t("{n} inactive", { n: stats.inactive })}</span>
        {stats.counts.blocked > 0 && <span className="repo-card-alert">{t("{n} need input", { n: stats.counts.blocked })}</span>}
      </span>
      <span className="repo-card-bar" aria-hidden="true">
        {REPO_STATUSES.filter((status) => stats.counts[status] > 0).map((status) => <span key={status} data-status={status} style={{ flexGrow: stats.counts[status] }} />)}
      </span>
      <AgentList agents={stats.agents} />
      <span className="repo-card-counts">
        {REPO_STATUSES.map((status) => <StatusCount key={status} status={status} count={stats.counts[status]} />)}
      </span>
      <span className="repo-card-meta">
        <span>{t("{n} PCs", { n: stats.hosts })}</span>
        <span>{t("{n} workspaces", { n: stats.workspaces })}</span>
        <span className={stats.pullRequests === 0 ? "is-zero" : undefined}>{t("{n} pull requests", { n: stats.pullRequests })}</span>
        <span className={stats.issues === 0 ? "is-zero" : undefined}>{t("{n} Linear issues", { n: stats.issues })}</span>
      </span>
    </button>
  );
}

/** The repos the agents work on, one card each with live counts; a card opens the agent grid on that repo's view. */
export function RepoBoard({ machines, onOpenGrid }: Props) {
  const t = useT();
  const { settings, update } = useSettings();
  const { records } = useAgentSessions();
  const tiles = useMemo(() => gridTiles(machines), [machines]);
  const repos = useMemo(() => repoStats(tiles, records), [tiles, records]);
  const totals = REPO_STATUSES.map((status) => ({ status, count: repos.reduce((sum, stats) => sum + stats.counts[status], 0) }));

  const openRepo = (stats: RepoStats): void => {
    const saved = settings.agentGridViews;
    // the grid shows its default view while none is saved, and reads its view id from storage on mount
    const next = openRepoView(saved.length > 0 ? saved : [newGridView("first", t("View {n}", { n: 1 }))], stats.repo, stats.total, newViewId());
    if (next !== null) {
      if (!saved.some((view) => view.id === next.id)) update({ agentGridViews: next.views });
      storeGridViewId(next.id);
    }
    onOpenGrid();
  };

  return (
    <section className="repo-board" aria-label={t("Repos")}>
      {repos.length === 0
        ? <p className="repo-board-empty">{t("No agents are running on a connected PC.")}</p>
        : <>
          <div className="repo-board-summary">
            <span className="repo-board-total">{t("{n} repos", { n: repos.length })}</span>
            <span className="repo-board-total">{t("{n} agents", { n: tiles.length })}</span>
            <span className="repo-board-total">{t("{n} active", { n: repos.reduce((sum, stats) => sum + stats.active, 0) })}</span>
            {totals.map(({ status, count }) => <StatusCount key={status} status={status} count={count} />)}
          </div>
          <div className="repo-board-cards">
            {repos.map((stats) => <RepoCard key={stats.repo} stats={stats} onOpen={() => openRepo(stats)} />)}
          </div>
        </>}
    </section>
  );
}
