import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeftRight, ArrowUp, Maximize2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AgentSessionRecord } from "../../shared/agent-sessions.ts";
import type { Machine } from "../../shared/machines.ts";
import { composerMessage, composerPayload } from "../lib/compose.ts";
import {
  arrangeView, chooseInView, filterView, GRID_MAX_COLUMNS, GRID_MAX_ROWS, gridChoices, gridTiles, lastSegment, loadGridViewId, matchesGridFilter, newGridView, newViewId,
  openRepoView, removeFromView, repoCounts, storeGridViewId, viewFilter, type GridFilter, type GridTile, type GridView,
} from "../lib/agentGrid.ts";
import { OpenFileContext } from "../lib/filePaths.ts";
import { useT } from "../lib/i18n.ts";
import { MachineContext } from "../lib/machineContext.tsx";
import type { MachineSession } from "../lib/machineSession.ts";
import { useMachineSessions } from "../lib/machineSessionContext.tsx";
import { DETACHED, usePaneBranch } from "../lib/paneBranch.ts";
import { openAgentSessionsByPane, useAgentSessions } from "../lib/agentSessions.ts";
import { useSettings } from "../lib/settings.ts";
import { agentTabName } from "../lib/sidebarAgents.ts";
import { AgentMark } from "./AgentMark.tsx";
import { AgentSessionLinks } from "./AgentSessionLinks.tsx";
import { ChatView } from "./ChatView.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { displayPaneTitle, StatusBadge } from "./Sidebar.tsx";
import "./AgentGrid.css";

interface Props {
  machines: readonly Machine[];
  /** opens the agent in the full single-pane view */
  onOpen: (machineId: string, paneId: string) => void;
}

/** Whether this browser's connection to a PC is up. The grid opens it itself: no terminal is mounted to do so. */
function useMachineConnected(connection: MachineSession | null): boolean {
  const [connected, setConnected] = useState(() => connection?.socket.connected ?? false);
  useEffect(() => {
    if (connection === null) return;
    connection.connect();
    setConnected(connection.socket.connected);
    const offMessage = connection.socket.on(() => setConnected(connection.socket.connected));
    const offDisconnect = connection.socket.onDisconnect(() => setConnected(false));
    return () => { offMessage(); offDisconnect(); };
  }, [connection]);
  return connected;
}

const COUNTS = (max: number) => Array.from({ length: max }, (_, index) => index + 1);

export function tileTitle({ entry }: GridTile): string {
  return entry.pane.label?.trim() || entry.agent?.title?.trim() || entry.pane.title?.trim() || displayPaneTitle(entry.pane);
}

/** A filter select; a saved value no agent has right now still shows. */
function FilterSelect({ label, all, value, options, onChange }: { label: string; all: string; value: string | null; options: string[]; onChange: (value: string | null) => void }) {
  const shown = value !== null && !options.includes(value) ? [value, ...options] : options;
  return (
    <label className="agent-grid-field">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{all}</option>
        {shown.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

/** Saved views of agents, each in its own chat tile: the chat lens only, so no pane is attached or resized. */
export function AgentGrid({ machines, onOpen }: Props) {
  const t = useT();
  const { settings, update } = useSettings();
  const saved = settings.agentGridViews;
  const views = saved.length > 0 ? saved : [newGridView("first", t("View {n}", { n: 1 }))];
  const [viewId, setViewId] = useState(loadGridViewId);
  const view = views.find((candidate) => candidate.id === viewId) ?? views[0]!;
  const [picking, setPicking] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tiles = useMemo(() => gridTiles(machines), [machines]);
  const { records } = useAgentSessions();
  const recordByPane = useMemo(() => openAgentSessionsByPane(records), [records]);
  const byKey = useMemo(() => new Map(tiles.map((tile) => [tile.key, tile])), [tiles]);
  const choices = useMemo(() => gridChoices(tiles), [tiles]);
  const visible = view.columns * view.rows;
  const { keys, hidden } = arrangeView(view, tiles, visible);
  const multiple = machines.length > 1;
  const style = { "--grid-columns": view.columns, "--grid-rows": view.rows } as CSSProperties;

  const select = (id: string): void => { setViewId(id); storeGridViewId(id); setPicking(null); setRenaming(false); };
  const save = (next: GridView): void => {
    update({ agentGridViews: saved.some((candidate) => candidate.id === next.id) ? saved.map((candidate) => (candidate.id === next.id ? next : candidate)) : [...saved, next] });
  };
  const addView = (): void => {
    const next = newGridView(newViewId(), t("View {n}", { n: views.length + 1 }));
    update({ agentGridViews: [...(saved.length > 0 ? saved : views), next] });
    select(next.id);
  };
  const deleteView = async (): Promise<void> => {
    update({ agentGridViews: saved.filter((candidate) => candidate.id !== view.id) });
    setDeleting(false);
  };
  const setFilter = (patch: Partial<Pick<GridView, "repo" | "host" | "herdrSession">>): void => {
    save(filterView(view, { repo: view.repo, host: view.host, herdrSession: view.herdrSession, ...patch }));
    setPicking(null);
  };
  const openRepo = (repo: string, count: number): void => {
    const next = openRepoView(saved.length > 0 ? saved : views, repo, count, newViewId());
    if (next === null) return;
    if (!saved.some((candidate) => candidate.id === next.id)) update({ agentGridViews: next.views });
    select(next.id);
  };

  return (
    <OpenFileContext.Provider value={null}>
      <section className="agent-grid" aria-label={t("Agent grid")}>
        <div className="agent-grid-toolbar">
          <div className="agent-grid-views">
            {renaming
              ? <input className="agent-grid-name" defaultValue={view.name} aria-label={t("View name")} autoFocus onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => { save({ ...view, name: event.target.value.trim() || view.name }); setRenaming(false); }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(false); }} />
              : <select className="agent-grid-view" value={view.id} aria-label={t("View")} onChange={(event) => select(event.target.value)}>
                {views.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>}
            <button type="button" className="icon-button agent-tile-action" aria-label={t("Rename")} title={t("Rename")} onClick={() => setRenaming(true)}><Pencil /></button>
            <button type="button" className="icon-button agent-tile-action" aria-label={t("New view")} title={t("New view")} onClick={addView}><Plus /></button>
            <button type="button" className="icon-button agent-tile-action" aria-label={t("Delete view")} title={t("Delete view")} disabled={saved.length === 0} onClick={() => setDeleting(true)}><Trash2 /></button>
          </div>
          <FilterSelect label={t("Repo")} all={t("All repos")} value={view.repo} options={choices.repos} onChange={(repo) => setFilter({ repo })} />
          <FilterSelect label={t("PC")} all={t("All PCs")} value={view.host} options={choices.hosts} onChange={(host) => setFilter({ host })} />
          <FilterSelect label={t("herdr session")} all={t("All herdr sessions")} value={view.herdrSession} options={choices.herdrSessions} onChange={(herdrSession) => setFilter({ herdrSession })} />
          <label className="agent-grid-field agent-grid-size">
            <span>{t("Columns")}</span>
            <select value={view.columns} onChange={(event) => save({ ...view, columns: Number(event.target.value) })}>
              {COUNTS(GRID_MAX_COLUMNS).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label className="agent-grid-field agent-grid-size">
            <span>{t("Rows")}</span>
            <select value={view.rows} onChange={(event) => save({ ...view, rows: Number(event.target.value) })}>
              {COUNTS(GRID_MAX_ROWS).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost" disabled={keys.every((key) => key === null) && view.slots.length === 0} onClick={() => save(filterView(view, { repo: null, host: null, herdrSession: null }))}>{t("Clear tiles")}</button>
          {hidden > 0 && <span className="agent-grid-hidden">{t("{n} more agents don't fit. Add columns or rows to show them.", { n: hidden })}</span>}
        </div>
        <nav className="agent-grid-repos" aria-label={t("A view per repo")}>
          {repoCounts(tiles).map(({ repo, count }) => (
            <button key={repo} type="button" className="agent-grid-repo" aria-pressed={view.repo === repo && view.host === null && view.herdrSession === null}
              title={t("Show the {n} agents working on {repo}", { n: count, repo })} onClick={() => openRepo(repo, count)}>
              <span>{repo}</span><span className="agent-grid-repo-count">{count}</span>
            </button>
          ))}
        </nav>
        <div className="agent-grid-tiles" style={style}>
          {keys.map((key, index) => {
            const tile = key === null ? undefined : byKey.get(key);
            const picker = picking === index
              ? <GridPicker current={key} tiles={tiles} placed={keys} initial={viewFilter(view)} onChoose={(chosen) => { save(chooseInView(view, index, chosen)); setPicking(null); }} onClose={() => setPicking(null)} />
              : null;
            const remove = (): void => { if (key !== null) save(removeFromView(view, index, key)); };
            return tile
              ? <AgentTile key={`${index}:${tile.key}`} tile={tile} record={recordByPane.get(tile.key) ?? null} named={multiple} picker={picker} onPick={() => setPicking(index)} onRemove={remove} onOpen={onOpen} />
              : <article key={`${index}:empty`} className="agent-tile is-empty">
                {key !== null && <p className="agent-grid-empty">{t("This agent is not available right now.")}</p>}
                <div className="agent-tile-empty-actions">
                  <button type="button" className="btn" onClick={() => setPicking(index)}><Plus aria-hidden="true" />{t("Choose an agent")}</button>
                  {key !== null && <button type="button" className="btn btn-ghost" onClick={remove}>{t("Remove")}</button>}
                </div>
                {picker}
              </article>;
          })}
        </div>
        {deleting && <ConfirmDialog title={t("Delete view {name}?", { name: view.name })} body={t("The view leaves every device. The agents keep running.")}
          confirmLabel={t("Delete view")} onConfirm={deleteView} onClose={() => setDeleting(false)} />}
      </section>
    </OpenFileContext.Provider>
  );
}

interface PickerProps {
  /** the agent the tile shows now */
  current: string | null;
  tiles: readonly GridTile[];
  /** the agent in each tile, to say where one already is */
  placed: readonly (string | null)[];
  /** the view's filter, which the picker starts from */
  initial: GridFilter;
  onChoose: (key: string) => void;
  onClose: () => void;
}

/** Chooses the agent one tile shows, narrowed by repo, PC, herdr session and text. */
function GridPicker({ current, tiles, placed, initial, onChoose, onClose }: PickerProps) {
  const t = useT();
  const [filter, onFilter] = useState<GridFilter>(initial);
  const choices = useMemo(() => gridChoices(tiles), [tiles]);
  const matches = tiles.filter((tile) => matchesGridFilter(tile, filter));
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  const field = (name: "repo" | "host" | "herdrSession", label: string, all: string, options: string[]) => (
    <label className="agent-pick-field">
      <span>{label}</span>
      <select value={filter[name] ?? ""} onChange={(event) => onFilter({ ...filter, [name]: event.target.value || null })}>
        <option value="">{all}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="agent-pick" role="dialog" aria-label={t("Choose an agent")} onKeyDown={onKeyDown}>
      <div className="agent-pick-filters">
        <input type="search" className="agent-pick-search" value={filter.query} placeholder={t("Search agents")} aria-label={t("Search agents")}
          ref={search} onChange={(event) => onFilter({ ...filter, query: event.target.value })} />
        <button type="button" className="icon-button agent-tile-action" aria-label={t("Close")} onClick={onClose}><X /></button>
        {field("repo", t("Repo"), t("All repos"), choices.repos)}
        {field("host", t("PC"), t("All PCs"), choices.hosts)}
        {field("herdrSession", t("herdr session"), t("All herdr sessions"), choices.herdrSessions)}
      </div>
      {matches.length === 0
        ? <p className="agent-grid-empty">{t("No agents match.")}</p>
        : <ul className="agent-pick-list">
          {matches.map((tile) => {
            const name = tile.entry.workspace.label;
            const title = tileTitle(tile);
            const at = placed.indexOf(tile.key);
            const meta = [tile.host, tile.herdrSession, tile.repo !== name ? tile.repo : null, title !== name ? title : null].filter(Boolean).join(" · ");
            const mark = tile.entry.canonicalAgent ?? tile.entry.agentLabel;
            return (
              <li key={tile.key}>
                <button type="button" className="agent-pick-row" aria-current={tile.key === current} onClick={() => onChoose(tile.key)}>
                  {mark && <AgentMark agent={mark} size={16} />}
                  <span className="agent-pick-text">
                    <span className="agent-pick-name">{name}</span>
                    <span className="agent-pick-meta">{meta}</span>
                  </span>
                  {at >= 0 && <span className="agent-pick-placed">{t("Tile {n}", { n: at + 1 })}</span>}
                  <StatusBadge status={tile.entry.agent?.agent_status ?? tile.entry.pane.agent_status} />
                </button>
              </li>
            );
          })}
        </ul>}
    </div>
  );
}

interface TileProps {
  tile: GridTile;
  /** the hub's record of the agent session this pane runs, with its links */
  record: AgentSessionRecord | null;
  /** the PC is named only beside another, as the sidebar does */
  named: boolean;
  picker: ReactNode;
  onPick: () => void;
  onRemove: () => void;
  onOpen: (machineId: string, paneId: string) => void;
}

/** The pull requests and Linear issues an agent session is linked to, as links out. */
function TileLinks({ record }: { record: AgentSessionRecord }) {
  const prs = record.pull_requests.some((link) => link.status === "linked");
  const issues = record.linear_issues.some((link) => link.status === "linked");
  if (!prs && !issues) return null;
  return (
    <div className="agent-tile-links">
      {prs && <AgentSessionLinks record={record} kind="pull_request" />}
      {issues && <AgentSessionLinks record={record} kind="linear_issue" />}
    </div>
  );
}

function AgentTile({ tile, record, named, picker, onPick, onRemove, onOpen }: TileProps) {
  const t = useT();
  const { machine, entry } = tile;
  const { pane, workspace, tab, agent } = entry;
  const connection = useMachineSessions()?.get(machine.id) ?? null;
  const connected = useMachineConnected(connection);
  const branch = usePaneBranch(machine.id, workspace.workspace_id);
  const [promptDock, setPromptDock] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sentKey, setSentKey] = useState(0);

  const title = tileTitle(tile);
  const mark = entry.canonicalAgent ?? entry.agentLabel;
  const status = agent?.agent_status ?? pane.agent_status;
  const agentSession = agent?.agent_session ?? pane.agent_session ?? null;
  const agentSessionWord = agentSession === null ? null : agentSession.kind === "path" ? lastSegment(agentSession.value) : agentSession.value.slice(0, 8);
  const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
  const tabName = agentTabName(tab, machine.snapshot?.tabs.filter((candidate) => candidate.workspace_id === workspace.workspace_id) ?? [], t);
  // a remote PC's name often ends with its herdr session already (host/herdr-session): say it once
  const herdrSession = tile.herdrSession && !machine.name.endsWith(`/${tile.herdrSession}`) ? tile.herdrSession : null;
  const label = workspace.label !== title && workspace.label !== tile.repo ? workspace.label : null;
  const where = [named ? machine.name : null, herdrSession, tile.repo, label, tabName !== tile.repo ? tabName : null, branch && branch !== DETACHED ? branch : null]
    .filter((part): part is string => Boolean(part));
  const detail = [entry.agentLabel, agent?.name, agentSessionWord, lastSegment(cwd)].filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  const tooltip = [
    title,
    t("PC: {name}", { name: machine.target?.destination ?? machine.name }),
    tile.herdrSession ? t("herdr session: {name}", { name: tile.herdrSession }) : null,
    workspace.worktree?.checkout_path ?? workspace.label,
    agentSession ? t("Agent session: {id}", { id: agentSession.value }) : null,
    cwd,
  ].filter(Boolean).join("\n");

  const send = async (): Promise<void> => {
    const text = composerMessage(draft);
    if (!text.trim() || connection === null || sending) return;
    setSending(true);
    setFailure(null);
    const result = await connection.socket.submit(pane.pane_id, text, composerPayload(text, true));
    setSending(false);
    if (result === null) { setFailure(t("Not connected to this PC. Nothing was sent.")); return; }
    if (!result.ok) { setFailure(result.message); return; }
    setDraft("");
    setSentKey((key) => key + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <article className={`agent-tile is-${status}`} data-machine={machine.id} data-pane={pane.pane_id} aria-label={title}>
      <header className="agent-tile-head" title={tooltip}>
        <div className="agent-tile-title">
          {mark && <AgentMark agent={mark} size={16} />}
          <span className="agent-tile-name">{title}</span>
          <StatusBadge status={status} />
          <button type="button" className="icon-button agent-tile-action" aria-label={t("Change agent")} title={t("Change agent")} onClick={onPick}>
            <ArrowLeftRight />
          </button>
          <button type="button" className="icon-button agent-tile-action" aria-label={t("Open {title}", { title })} title={t("Open {title}", { title })} onClick={() => onOpen(machine.id, pane.pane_id)}>
            <Maximize2 />
          </button>
          <button type="button" className="icon-button agent-tile-action" aria-label={t("Remove {title} from the grid", { title })} title={t("Remove {title} from the grid", { title })} onClick={onRemove}>
            <X />
          </button>
        </div>
        {where.length > 0 && <div className="agent-tile-where">{where.join(" · ")}</div>}
        {detail.length > 0 && <div className="agent-tile-detail">{detail.join(" · ")}</div>}
        {record && <TileLinks record={record} />}
      </header>
      <div className="agent-tile-chat">
        <MachineContext.Provider value={machine.id}>
          <RenderBoundary resetKey={pane.pane_id} fallback={(retry) => <p className="agent-grid-empty">{t("This chat can't be shown.")} <button type="button" className="btn btn-ghost" onClick={retry}>{t("Retry")}</button></p>}>
            <ChatView paneId={pane.pane_id} active={false} refreshKey={0} sentKey={sentKey} connected={connected} ended={false}
              agent={entry.canonicalAgent} agentStatus={status} promptDock={promptDock} title={title} />
          </RenderBoundary>
        </MachineContext.Provider>
      </div>
      <div className="prompt-dock agent-tile-prompt" ref={setPromptDock} />
      <div className="agent-tile-input">
        <textarea rows={1} value={draft} placeholder={connected ? t("Message {title}", { title }) : t("Connecting…")} aria-label={t("Message {title}", { title })}
          onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} disabled={!connected} />
        <button type="button" className="icon-button agent-tile-send" aria-label={t("Send")} disabled={!connected || sending || !draft.trim()} onClick={() => void send()}>
          <ArrowUp />
        </button>
      </div>
      {failure !== null && <p className="agent-tile-failure" role="alert">{failure}</p>}
      {picker}
    </article>
  );
}
