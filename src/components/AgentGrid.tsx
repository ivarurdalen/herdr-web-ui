import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, Maximize2, Pin, PinOff } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import { composerMessage, composerPayload } from "../lib/compose.ts";
import { GRID_MAX_COLUMNS, GRID_MAX_ROWS, gridPage, gridTiles, lastSegment, loadGridLayout, storeGridLayout, type GridLayout, type GridTile } from "../lib/agentGrid.ts";
import { OpenFileContext } from "../lib/filePaths.ts";
import { useT } from "../lib/i18n.ts";
import { MachineContext } from "../lib/machineContext.tsx";
import type { MachineSession } from "../lib/machineSession.ts";
import { useMachineSessions } from "../lib/machineSessionContext.tsx";
import { DETACHED, usePaneBranch } from "../lib/paneBranch.ts";
import { agentTabName } from "../lib/sidebarAgents.ts";
import { currentSidebarPins, setSidebarPins, subscribeSidebarPins, toggleSidebarPin } from "../lib/sidebarPins.ts";
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

/** Every agent as a chat tile, several at once: the chat lens only, so no pane is attached or resized. */
export function AgentGrid({ machines, onOpen }: Props) {
  const t = useT();
  const [layout, setLayoutState] = useState<GridLayout>(loadGridLayout);
  const [page, setPage] = useState(0);
  const pins = useSyncExternalStore(subscribeSidebarPins, currentSidebarPins, currentSidebarPins);
  const setLayout = (next: GridLayout): void => { setLayoutState(next); storeGridLayout(next); };
  const tiles = useMemo(() => gridTiles(machines, pins, layout.filter), [machines, pins, layout.filter]);
  const perPage = layout.columns * layout.rows;
  const shown = gridPage(tiles, perPage, page);
  const togglePin = useCallback((key: string) => setSidebarPins(toggleSidebarPin(currentSidebarPins(), key)), []);
  const multiple = machines.length > 1;
  const style = { "--grid-columns": layout.columns, "--grid-rows": layout.rows } as CSSProperties;

  return (
    <OpenFileContext.Provider value={null}>
      <section className="agent-grid" aria-label={t("Agent grid")}>
        <div className="agent-grid-toolbar">
          <span className="agent-grid-count">{t("{n} agents", { n: tiles.length })}</span>
          <div className="segmented agent-grid-filter" role="group" aria-label={t("Agents shown")}>
            <button type="button" aria-pressed={layout.filter === "all"} onClick={() => { setLayout({ ...layout, filter: "all" }); setPage(0); }}>{t("All")}</button>
            <button type="button" aria-pressed={layout.filter === "active"} onClick={() => { setLayout({ ...layout, filter: "active" }); setPage(0); }}>{t("Active")}</button>
          </div>
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
          {shown.pages > 1 && <div className="agent-grid-pages">
            <button type="button" className="icon-button" aria-label={t("Previous page")} disabled={shown.page === 0} onClick={() => setPage(shown.page - 1)}><ChevronLeft /></button>
            <span>{t("Page {page} of {pages}", { page: shown.page + 1, pages: shown.pages })}</span>
            <button type="button" className="icon-button" aria-label={t("Next page")} disabled={shown.page >= shown.pages - 1} onClick={() => setPage(shown.page + 1)}><ChevronRight /></button>
          </div>}
        </div>
        {shown.tiles.length === 0
          ? <p className="agent-grid-empty">{t(layout.filter === "active" ? "No agent is working or waiting right now." : "No agents are running.")}</p>
          : <div className="agent-grid-tiles" style={style}>
            {shown.tiles.map((tile) => <AgentTile key={tile.key} tile={tile} named={multiple} pinned={pins.includes(tile.key)} onPin={togglePin} onOpen={onOpen} />)}
          </div>}
      </section>
    </OpenFileContext.Provider>
  );
}

interface TileProps {
  tile: GridTile;
  /** the PC is named only beside another, as the sidebar does */
  named: boolean;
  pinned: boolean;
  onPin: (key: string) => void;
  onOpen: (machineId: string, paneId: string) => void;
}

function AgentTile({ tile, named, pinned, onPin, onOpen }: TileProps) {
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

  const title = pane.label?.trim() || agent?.title?.trim() || pane.title?.trim() || displayPaneTitle(pane);
  const mark = entry.canonicalAgent ?? entry.agentLabel;
  const status = agent?.agent_status ?? pane.agent_status;
  const project = workspace.worktree?.repo_name || workspace.label;
  const sessionRef = agent?.agent_session ?? pane.agent_session ?? null;
  const sessionWord = sessionRef === null ? null : sessionRef.kind === "path" ? lastSegment(sessionRef.value) : sessionRef.value.slice(0, 8);
  const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
  const tabName = agentTabName(tab, machine.snapshot?.tabs.filter((candidate) => candidate.workspace_id === workspace.workspace_id) ?? [], t);
  // a remote PC's name often ends with its session already (host/session): say it once
  const herdrSession = machine.target?.session && !machine.name.endsWith(`/${machine.target.session}`) ? machine.target.session : null;
  const where = [named ? machine.name : null, herdrSession, project, tabName !== project ? tabName : null, branch && branch !== DETACHED ? branch : null]
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
          <button type="button" className="icon-button agent-tile-action" aria-label={t(pinned ? "Unpin {title}" : "Pin {title}", { title })} aria-pressed={pinned} onClick={() => onPin(tile.key)}>
            {pinned ? <PinOff /> : <Pin />}
          </button>
          <button type="button" className="icon-button agent-tile-action" aria-label={t("Open {title}", { title })} title={t("Open {title}", { title })} onClick={() => onOpen(machine.id, pane.pane_id)}>
            <Maximize2 />
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
    </article>
  );
}
