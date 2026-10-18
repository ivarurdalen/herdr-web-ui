import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeftRight, ArrowUp, Maximize2, Plus, X } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import { composerMessage, composerPayload } from "../lib/compose.ts";
import {
  EMPTY_GRID_FILTER, GRID_MAX_COLUMNS, GRID_MAX_ROWS, gridChoices, gridTiles, lastSegment, loadGridLayout, matchesGridFilter, placeInSlot, storeGridLayout,
  type GridFilter, type GridLayout, type GridTile,
} from "../lib/agentGrid.ts";
import { OpenFileContext } from "../lib/filePaths.ts";
import { useT } from "../lib/i18n.ts";
import { MachineContext } from "../lib/machineContext.tsx";
import type { MachineSession } from "../lib/machineSession.ts";
import { useMachineSessions } from "../lib/machineSessionContext.tsx";
import { DETACHED, usePaneBranch } from "../lib/paneBranch.ts";
import { agentTabName } from "../lib/sidebarAgents.ts";
import { AgentMark } from "./AgentMark.tsx";
import { ChatView } from "./ChatView.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { displayPaneTitle, StatusBadge } from "./Sidebar.tsx";
import "./AgentGrid.css";

interface Props {
  machines: readonly Machine[];
  /** opens the agent in the full single-pane view */
  onOpen: (machineId: string, paneId: string) => void;
}

/** Whether a PC's connection is up. The grid opens it itself: no terminal is mounted to do so. */
function useSessionConnected(session: MachineSession | null): boolean {
  const [connected, setConnected] = useState(() => session?.socket.connected ?? false);
  useEffect(() => {
    if (session === null) return;
    session.connect();
    setConnected(session.socket.connected);
    const offMessage = session.socket.on(() => setConnected(session.socket.connected));
    const offDisconnect = session.socket.onDisconnect(() => setConnected(false));
    return () => { offMessage(); offDisconnect(); };
  }, [session]);
  return connected;
}

const COUNTS = (max: number) => Array.from({ length: max }, (_, index) => index + 1);
type FillKind = "repo" | "host" | "session";

function tileTitle({ entry }: GridTile): string {
  return entry.pane.label?.trim() || entry.agent?.title?.trim() || entry.pane.title?.trim() || displayPaneTitle(entry.pane);
}

/** Agents the user placed, each in its own chat tile: the chat lens only, so no pane is attached or resized. */
export function AgentGrid({ machines, onOpen }: Props) {
  const t = useT();
  const [layout, setLayoutState] = useState<GridLayout>(loadGridLayout);
  const [filter, setFilter] = useState<GridFilter>(EMPTY_GRID_FILTER);
  const [picking, setPicking] = useState<number | null>(null);
  const setLayout = (next: GridLayout): void => { setLayoutState(next); storeGridLayout(next); };
  const tiles = useMemo(() => gridTiles(machines), [machines]);
  const byKey = useMemo(() => new Map(tiles.map((tile) => [tile.key, tile])), [tiles]);
  const choices = useMemo(() => gridChoices(tiles), [tiles]);
  const visible = layout.columns * layout.rows;
  const hidden = layout.slots.slice(visible).filter((slot) => slot !== null).length;
  const multiple = machines.length > 1;
  const style = { "--grid-columns": layout.columns, "--grid-rows": layout.rows } as CSSProperties;

  const fill = (value: string): void => {
    const split = value.indexOf(":");
    const kind = value.slice(0, split) as FillKind;
    const name = value.slice(split + 1);
    setLayout({ ...layout, slots: tiles.filter((tile) => tile[kind] === name).map((tile) => tile.key) });
    setFilter({ ...EMPTY_GRID_FILTER, [kind]: name });
    setPicking(null);
  };
  const place = (index: number, key: string | null): void => {
    setLayout({ ...layout, slots: placeInSlot(layout.slots, index, key) });
    setPicking(null);
  };

  return (
    <OpenFileContext.Provider value={null}>
      <section className="agent-grid" aria-label={t("Agent grid")}>
        <div className="agent-grid-toolbar">
          <select className="agent-grid-fill" value="" aria-label={t("Fill tiles")} onChange={(event) => fill(event.target.value)}>
            <option value="">{t("Fill tiles…")}</option>
            {([["repo", t("Repo"), choices.repos], ["host", t("PC"), choices.hosts], ["session", t("Session"), choices.sessions]] as const).map(([kind, label, names]) =>
              <optgroup key={kind} label={label}>{names.map((name) => <option key={name} value={`${kind}:${name}`}>{name}</option>)}</optgroup>)}
          </select>
          <button type="button" className="btn btn-ghost" disabled={layout.slots.length === 0} onClick={() => setLayout({ ...layout, slots: [] })}>{t("Clear tiles")}</button>
          <label className="agent-grid-size">
            <span>{t("Columns")}</span>
            <select value={layout.columns} onChange={(event) => setLayout({ ...layout, columns: Number(event.target.value) })}>
              {COUNTS(GRID_MAX_COLUMNS).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label className="agent-grid-size">
            <span>{t("Rows")}</span>
            <select value={layout.rows} onChange={(event) => setLayout({ ...layout, rows: Number(event.target.value) })}>
              {COUNTS(GRID_MAX_ROWS).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          {hidden > 0 && <span className="agent-grid-hidden">{t("{n} more chosen agents don't fit. Add columns or rows to show them.", { n: hidden })}</span>}
        </div>
        <div className="agent-grid-tiles" style={style}>
          {COUNTS(visible).map((position) => {
            const index = position - 1;
            const key = layout.slots[index] ?? null;
            const tile = key === null ? undefined : byKey.get(key);
            const picker = picking === index
              ? <GridPicker index={index} tiles={tiles} slots={layout.slots} filter={filter} onFilter={setFilter} onChoose={(chosen) => place(index, chosen)} onClose={() => setPicking(null)} />
              : null;
            return tile
              ? <AgentTile key={`${index}:${tile.key}`} tile={tile} named={multiple} picker={picker} onPick={() => setPicking(index)} onRemove={() => place(index, null)} onOpen={onOpen} />
              : <article key={`${index}:empty`} className="agent-tile is-empty">
                {key !== null && <p className="agent-grid-empty">{t("This agent is not available right now.")}</p>}
                <div className="agent-tile-empty-actions">
                  <button type="button" className="btn" onClick={() => setPicking(index)}><Plus aria-hidden="true" />{t("Choose an agent")}</button>
                  {key !== null && <button type="button" className="btn btn-ghost" onClick={() => place(index, null)}>{t("Remove")}</button>}
                </div>
                {picker}
              </article>;
          })}
        </div>
      </section>
    </OpenFileContext.Provider>
  );
}

interface PickerProps {
  index: number;
  tiles: readonly GridTile[];
  slots: readonly (string | null)[];
  filter: GridFilter;
  onFilter: (filter: GridFilter) => void;
  onChoose: (key: string) => void;
  onClose: () => void;
}

/** Chooses the agent one tile shows, narrowed by repo, PC and herdr session; the filters carry over to the next tile. */
function GridPicker({ index, tiles, slots, filter, onFilter, onChoose, onClose }: PickerProps) {
  const t = useT();
  const choices = useMemo(() => gridChoices(tiles), [tiles]);
  const matches = tiles.filter((tile) => matchesGridFilter(tile, filter));
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  const field = (name: "repo" | "host" | "session", label: string, all: string, options: string[]) => (
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
        {field("session", t("Session"), t("All sessions"), choices.sessions)}
      </div>
      {matches.length === 0
        ? <p className="agent-grid-empty">{t("No agents match.")}</p>
        : <ul className="agent-pick-list">
          {matches.map((tile) => {
            const name = tile.entry.workspace.label;
            const title = tileTitle(tile);
            const placed = slots.indexOf(tile.key);
            const meta = [tile.host, tile.session, tile.repo !== name ? tile.repo : null, title !== name ? title : null].filter(Boolean).join(" · ");
            const mark = tile.entry.canonicalAgent ?? tile.entry.agentLabel;
            return (
              <li key={tile.key}>
                <button type="button" className="agent-pick-row" aria-current={placed === index} onClick={() => onChoose(tile.key)}>
                  {mark && <AgentMark agent={mark} size={16} />}
                  <span className="agent-pick-text">
                    <span className="agent-pick-name">{name}</span>
                    <span className="agent-pick-meta">{meta}</span>
                  </span>
                  {placed >= 0 && <span className="agent-pick-placed">{t("Tile {n}", { n: placed + 1 })}</span>}
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
  /** the PC is named only beside another, as the sidebar does */
  named: boolean;
  picker: ReactNode;
  onPick: () => void;
  onRemove: () => void;
  onOpen: (machineId: string, paneId: string) => void;
}

function AgentTile({ tile, named, picker, onPick, onRemove, onOpen }: TileProps) {
  const t = useT();
  const { machine, entry } = tile;
  const { pane, workspace, tab, agent } = entry;
  const sessions = useMachineSessions();
  const session = sessions?.get(machine.id) ?? null;
  const connected = useSessionConnected(session);
  const branch = usePaneBranch(machine.id, workspace.workspace_id);
  const [promptDock, setPromptDock] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sentKey, setSentKey] = useState(0);

  const title = tileTitle(tile);
  const mark = entry.canonicalAgent ?? entry.agentLabel;
  const status = agent?.agent_status ?? pane.agent_status;
  const sessionRef = agent?.agent_session ?? pane.agent_session ?? null;
  const sessionWord = sessionRef === null ? null : sessionRef.kind === "path" ? lastSegment(sessionRef.value) : sessionRef.value.slice(0, 8);
  const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
  const tabName = agentTabName(tab, machine.snapshot?.tabs.filter((candidate) => candidate.workspace_id === workspace.workspace_id) ?? [], t);
  // a remote PC's name often ends with its session already (host/session): say it once
  const herdrSession = machine.target?.session && !machine.name.endsWith(`/${machine.target.session}`) ? machine.target.session : null;
  const label = workspace.label !== title && workspace.label !== tile.repo ? workspace.label : null;
  const where = [named ? machine.name : null, herdrSession, tile.repo, label, tabName !== tile.repo ? tabName : null, branch && branch !== DETACHED ? branch : null]
    .filter((part): part is string => Boolean(part));
  const detail = [entry.agentLabel, agent?.name, sessionWord, lastSegment(cwd)].filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  const tooltip = [title, machine.target?.destination ?? machine.name, workspace.worktree?.checkout_path ?? workspace.label, sessionRef?.value, cwd, pane.pane_id]
    .filter(Boolean).join("\n");

  const send = async (): Promise<void> => {
    const text = composerMessage(draft);
    if (!text.trim() || session === null || sending) return;
    setSending(true);
    setFailure(null);
    const result = await session.socket.submit(pane.pane_id, text, composerPayload(text, true));
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
