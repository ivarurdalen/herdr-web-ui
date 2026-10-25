import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Machine } from "../../shared/machines.ts";
import { gridTiles, newGridView, newViewId, openRepoView, storeGridViewId, type RepoViewScope } from "../lib/agentGrid.ts";
import { useAgentSessions } from "../lib/agentSessions.ts";
import { useT } from "../lib/i18n.ts";
import {
  choices, EMPTY_REPO_FILTER, filterTiles, groupRepos, isFiltered, loadRepoBoardState, matchesScope, MAX_REPO_SCOPES, REPO_STATUSES, repoColor, repoStats,
  sessionLabel, statusCounts, storeRepoBoardState, type Choice, type GroupBy, type RepoAgent, type RepoFilter, type RepoGroup, type RepoScope, type RepoStats,
} from "../lib/repoBoard.ts";
import { useSettings } from "../lib/settings.ts";
import type { KnownStatus } from "../lib/status.ts";
import { tileTitle } from "./AgentGrid.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
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

/** A herdr session as a small badge in its color. */
function SessionBadge({ sessionKey }: { sessionKey: string }) {
  const label = sessionLabel(sessionKey);
  return (
    <span className="repo-session" style={{ "--repo-color": repoColor(label) } as CSSProperties}>
      <span className="repo-session-dot" aria-hidden="true" />{label}
    </span>
  );
}

/** `hideSession` is the session of the group the card sits in, which its header already says. */
function RepoCard({ stats, hideSession, onOpen }: { stats: RepoStats; hideSession?: string; onOpen: () => void }) {
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
        {stats.sessions.filter((key) => key !== hideSession).map((key) => <SessionBadge key={key} sessionKey={key} />)}
        <span>{t("{n} machines", { n: stats.hosts })}</span>
        <span>{t("{n} workspaces", { n: stats.workspaces })}</span>
        <span className={stats.pullRequests === 0 ? "is-zero" : undefined}>{t("{n} pull requests", { n: stats.pullRequests })}</span>
        <span className={stats.issues === 0 ? "is-zero" : undefined}>{t("{n} Linear issues", { n: stats.issues })}</span>
      </span>
    </button>
  );
}

const GROUP_BY: readonly GroupBy[] = ["none", "session", "machine", "attention"];

/** A filter chip: a name with its agent count, and its active count when not zero. */
function FilterChip({ choice, pressed, onToggle }: { choice: Choice; pressed: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button type="button" className="repo-chip" aria-pressed={pressed} style={{ "--repo-color": repoColor(choice.label) } as CSSProperties} onClick={onToggle}>
      <span className="repo-chip-dot" aria-hidden="true" />
      <span className="repo-chip-label">{choice.label}</span>
      <span className="repo-chip-count">{choice.agents}</span>
      {choice.active > 0 && <span className="repo-chip-active" title={t("{n} active", { n: choice.active })}>{choice.active}</span>}
    </button>
  );
}

const toggle = (list: readonly string[], key: string): string[] => (list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key]);

/** The chips of one filter axis; a chosen key no agent has now stays, so it can be unchosen. */
function chipsFor(found: readonly Choice[], chosen: readonly string[], labelOf: (key: string) => string): Choice[] {
  return [...found, ...chosen.filter((key) => !found.some((choice) => choice.key === key)).map((key) => ({ key, label: labelOf(key), agents: 0, active: 0 }))];
}

/** Where a card opens the grid: the session or machine it was scoped to, by group first, then by a single filter choice. */
function viewScope(groupBy: GroupBy, group: RepoGroup, filter: RepoFilter): RepoViewScope {
  const session = (key: string): RepoViewScope => (key.startsWith("@") ? { host: sessionLabel(key), herdrSession: null } : { host: null, herdrSession: key });
  if (groupBy === "session") return session(group.key);
  if (groupBy === "machine") return { host: group.key, herdrSession: null };
  if (filter.sessions.length === 1) return session(filter.sessions[0]!);
  if (filter.machines.length === 1) return { host: filter.machines[0]!, herdrSession: null };
  return { host: null, herdrSession: null };
}

/** The repos the agents work on, one card each with live counts; a card opens the agent grid on that repo's view. */
export function RepoBoard({ machines, onOpenGrid }: Props) {
  const t = useT();
  const { settings, update } = useSettings();
  const { records } = useAgentSessions();
  const [initial] = useState(loadRepoBoardState);
  const [filter, setFilter] = useState<RepoFilter>(initial.filter);
  const [groupBy, setGroupBy] = useState<GroupBy>(initial.groupBy);
  const [scopeId, setScopeId] = useState<string | null>(initial.scopeId);
  const [naming, setNaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RepoScope | null>(null);
  useEffect(() => storeRepoBoardState({ filter, groupBy, scopeId }), [filter, groupBy, scopeId]);

  const scopes = settings.repoBoardScopes;
  const scope = scopes.find((saved) => saved.id === scopeId) ?? null;
  const tiles = useMemo(() => gridTiles(machines), [machines]);
  const shown = useMemo(() => filterTiles(tiles, filter), [tiles, filter]);
  const repos = useMemo(() => repoStats(shown, records), [shown, records]);
  const groups = useMemo(() => groupRepos(shown, records, groupBy), [shown, records, groupBy]);
  const found = useMemo(() => choices(tiles), [tiles]);
  const counts = useMemo(() => statusCounts(filterTiles(tiles, filter, "status")), [tiles, filter]);
  const totals = REPO_STATUSES.map((status) => ({ status, count: repos.reduce((sum, stats) => sum + stats.counts[status], 0) }));
  const narrowed = filter.status !== "all" || filter.sessions.length > 0 || filter.machines.length > 0;

  // a hand change leaves the scope's chip pressed only while the filter still equals that scope
  const change = (patch: Partial<RepoFilter>): void => {
    const next = { ...filter, ...patch };
    setFilter(next);
    if (scope !== null && !matchesScope(next, scope)) setScopeId(null);
  };
  const clear = (): void => { setFilter(EMPTY_REPO_FILTER); setScopeId(null); };
  const apply = (saved: RepoScope): void => {
    setFilter({ ...filter, sessions: saved.sessions, machines: saved.machines, status: saved.status });
    setScopeId(saved.id);
  };
  const save = (): void => {
    const name = (naming ?? "").trim();
    if (name === "") return;
    const saved: RepoScope = { id: newViewId(), name: name.slice(0, 40), sessions: filter.sessions, machines: filter.machines, status: filter.status };
    update({ repoBoardScopes: [...scopes, saved] });
    setScopeId(saved.id);
    setNaming(null);
  };
  const remove = async (saved: RepoScope): Promise<void> => {
    update({ repoBoardScopes: scopes.filter((other) => other.id !== saved.id) });
    if (scopeId === saved.id) setScopeId(null);
    setDeleting(null);
  };

  const openRepo = (stats: RepoStats, group: RepoGroup): void => {
    const saved = settings.agentGridViews;
    // the grid shows its default view while none is saved, and reads its view id from storage on mount
    const next = openRepoView(saved.length > 0 ? saved : [newGridView("first", t("View {n}", { n: 1 }))], stats.repo, stats.total, newViewId(), viewScope(groupBy, group, filter));
    if (next !== null) {
      if (!saved.some((view) => view.id === next.id)) update({ agentGridViews: next.views });
      storeGridViewId(next.id);
    }
    onOpenGrid();
  };

  const attentionLabel = { blocked: t("Needs input"), active: t("Active"), inactive: t("Inactive") };
  const statusOptions: Array<[RepoFilter["status"], string, number]> = [
    ["all", t("All"), counts.blocked + counts.active + counts.inactive],
    ["blocked", t("Needs input"), counts.blocked], ["active", t("Active"), counts.active], ["inactive", t("Inactive"), counts.inactive],
  ];
  const groupLabel: Record<GroupBy, string> = { none: t("None"), session: t("Session"), machine: t("Machine"), attention: t("Attention") };

  return (
    <section className="repo-board" aria-label={t("Repos")}>
      {tiles.length === 0
        ? <p className="repo-board-empty">{t("No agents are running on a connected PC.")}</p>
        : <>
          <div className="repo-board-toolbar">
            <div className="repo-toolbar-row repo-scopes" role="group" aria-label={t("Scopes")}>
              <span className="repo-toolbar-label">{t("Scopes")}</span>
              <button type="button" className="repo-chip repo-scope-all" aria-pressed={scope === null && !narrowed} onClick={clear}>{t("All")}</button>
              {scopes.map((saved) => (
                <span key={saved.id} className="repo-scope" data-pressed={scope?.id === saved.id ? "" : undefined}>
                  <button type="button" className="repo-chip repo-scope-chip" aria-pressed={scope?.id === saved.id} onClick={() => apply(saved)}>{saved.name}</button>
                  <button type="button" className="repo-scope-delete" aria-label={t("Delete scope {name}", { name: saved.name })} title={t("Delete scope {name}", { name: saved.name })} onClick={() => setDeleting(saved)}>×</button>
                </span>
              ))}
              {naming === null
                ? <button type="button" className="btn btn-ghost repo-scope-save" disabled={!narrowed || scopes.length >= MAX_REPO_SCOPES} onClick={() => setNaming("")}>{t("Save as scope")}</button>
                : <input className="input repo-scope-name" value={naming} maxLength={40} autoFocus aria-label={t("Scope name")} placeholder={t("Scope name")}
                  onChange={(event) => setNaming(event.target.value)} onBlur={() => { if (naming === "") setNaming(null); }}
                  onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); save(); } else if (event.key === "Escape") { event.stopPropagation(); setNaming(null); } }} />}
            </div>
            <div className="repo-toolbar-row">
              <input type="search" className="input repo-search" value={filter.query} placeholder={t("Search repos and agents")} aria-label={t("Search repos and agents")}
                onChange={(event) => setFilter({ ...filter, query: event.target.value })} />
              <div className="segmented repo-status" role="group" aria-label={t("Status")}>
                {statusOptions.map(([value, label, count]) => (
                  <button key={value} type="button" className="repo-status-option" data-filter-status={value} aria-pressed={filter.status === value} onClick={() => change({ status: value })}>
                    {label} <span className="repo-status-count">{count}</span>
                  </button>
                ))}
              </div>
              <label className="repo-groupby">
                <span className="repo-toolbar-label">{t("Group by")}</span>
                <select className="repo-groupby-select" value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
                  {GROUP_BY.map((value) => <option key={value} value={value}>{groupLabel[value]}</option>)}
                </select>
              </label>
              {isFiltered(filter) && <button type="button" className="btn btn-ghost repo-clear" onClick={clear}>{t("Clear filters")}</button>}
            </div>
            <div className="repo-toolbar-row repo-sessions" role="group" aria-label={t("Sessions")}>
              <span className="repo-toolbar-label">{t("Sessions")}</span>
              {chipsFor(found.sessions, filter.sessions, sessionLabel).map((choice) => <FilterChip key={choice.key} choice={choice} pressed={filter.sessions.includes(choice.key)} onToggle={() => change({ sessions: toggle(filter.sessions, choice.key) })} />)}
            </div>
            <div className="repo-toolbar-row repo-machines" role="group" aria-label={t("Machines")}>
              <span className="repo-toolbar-label">{t("Machines")}</span>
              {chipsFor(found.machines, filter.machines, (key) => key).map((choice) => <FilterChip key={choice.key} choice={choice} pressed={filter.machines.includes(choice.key)} onToggle={() => change({ machines: toggle(filter.machines, choice.key) })} />)}
            </div>
          </div>
          {shown.length === 0
            ? <div className="repo-board-none">
              <p className="repo-board-empty">{t("No agents match these filters.")}</p>
              <button type="button" className="btn repo-clear" onClick={clear}>{t("Clear filters")}</button>
            </div>
            : <>
              <div className="repo-board-summary">
                <span className="repo-board-total">{t("{n} repos", { n: repos.length })}</span>
                <span className="repo-board-total">{t("{n} agents", { n: shown.length })}</span>
                <span className="repo-board-total">{t("{n} active", { n: repos.reduce((sum, stats) => sum + stats.active, 0) })}</span>
                {totals.map(({ status, count }) => <StatusCount key={status} status={status} count={count} />)}
              </div>
              {groups.map((group) => (
                <section key={group.key} className="repo-group" aria-label={groupBy === "none" ? undefined : groupBy === "attention" ? attentionLabel[group.key as keyof typeof attentionLabel] : group.label}>
                  {groupBy !== "none" && (
                    <header className="repo-group-head" style={groupBy === "attention" ? undefined : { "--repo-color": repoColor(group.label) } as CSSProperties}>
                      <span className="repo-group-dot" data-attention={groupBy === "attention" ? group.key : undefined} aria-hidden="true" />
                      <h3 className="repo-group-label">{groupBy === "attention" ? attentionLabel[group.key as keyof typeof attentionLabel] : group.label}</h3>
                      <span className="repo-group-counts">
                        {[t("{n} agents", { n: group.totals.agents }), t("{n} active", { n: group.totals.active }), t("{n} need input", { n: group.totals.blocked })].join(" · ")}
                      </span>
                    </header>
                  )}
                  <div className="repo-board-cards">
                    {group.repos.map((stats) => <RepoCard key={stats.repo} stats={stats} hideSession={groupBy === "session" ? group.key : undefined} onOpen={() => openRepo(stats, group)} />)}
                  </div>
                </section>
              ))}
            </>}
          {deleting && <ConfirmDialog title={t("Delete scope {name}?", { name: deleting.name })} body={t("The scope leaves every device. The agents keep running.")}
            confirmLabel={t("Delete")} onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
        </>}
    </section>
  );
}
