import { useEffect, useRef, useState, type FormEvent } from "react";
import { Columns3, Copy, Sparkles, X } from "lucide-react";
import {
  parseLinearIdentifier, parsePullRequestUrl,
  type AgentSessionRecord, type LinkSuggestion, type LinkTarget,
} from "../../shared/agent-sessions.ts";
import { fetchLinkSuggestions, linkAgentSession, unlinkAgentSession } from "../lib/api.ts";
import { useAgentSessions } from "../lib/agentSessions.ts";
import { useT } from "../lib/i18n.ts";
import { AgentMark } from "./AgentMark.tsx";
import { AgentSessionLinks, linkNames, pullRequestName } from "./AgentSessionLinks.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import { Markdown } from "./Markdown.tsx";
import "./AgentSessionsPage.css";

interface Props {
  /** opens a running agent session's pane, in the chat view */
  onOpen: (machineId: string, paneId: string, view: "chat") => void;
}

const when = (iso: string | null): string | null => iso === null ? null : iso.slice(0, 16).replace("T", " ");

const HIDDEN_KEY = "herdr-web-ui:agent-sessions-hidden";
/** columns a first look does without; the column picker shows them */
const HIDDEN_AT_FIRST = ["agent", "branch", "first_seen", "ended", "agent_session_id"];

function loadHidden(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "null");
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : HIDDEN_AT_FIRST;
  } catch {
    return HIDDEN_AT_FIRST;
  }
}

function storeHidden(hidden: readonly string[]): void {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch { /* per-browser convenience only */ }
}

/** The hub's record of every agent session it saw (docs/agent-sessions.md), with what each is linked to. */
export function AgentSessionsPage({ onOpen }: Props) {
  const t = useT();
  const { records, replace } = useAgentSessions();
  const [hidden, setHiddenState] = useState(loadHidden);
  const setHidden = (next: string[]): void => { setHiddenState(next); storeHidden(next); };

  const columns: Array<Column<AgentSessionRecord>> = [
    {
      key: "title", label: t("Title"), value: (row) => row.title ?? row.workspace_label,
      render: (row) => row.ended_at === null && row.pane_id !== null
        ? <button type="button" className="agent-sessions-title" title={t("Open the chat")} onClick={(event) => { event.stopPropagation(); onOpen(row.machine_id, row.pane_id!, "chat"); }}>{row.title ?? row.workspace_label}</button>
        : row.title ?? row.workspace_label,
    },
    { key: "description", label: t("Description"), value: (row) => row.description, wrap: true, render: (row) => row.description ? <Markdown className="agent-sessions-description">{row.description}</Markdown> : "" },
    { key: "pull_requests", label: t("Pull requests"), value: (row) => linkNames(row, "pull_request"), wrap: true, render: (row) => <AgentSessionLinks record={row} kind="pull_request" /> },
    { key: "linear_issues", label: t("Linear issues"), value: (row) => linkNames(row, "linear_issue"), wrap: true, render: (row) => <AgentSessionLinks record={row} kind="linear_issue" /> },
    { key: "repo", label: t("Repo"), value: (row) => row.repo },
    { key: "host", label: t("PC"), value: (row) => row.host },
    { key: "herdr_session", label: t("herdr session"), value: (row) => row.herdr_session },
    { key: "state", label: t("State"), value: (row) => (row.ended_at === null ? t("Running") : t("Ended")) },
    { key: "last_seen", label: t("Last seen"), value: (row) => when(row.last_seen_at) },
    { key: "described", label: t("Described"), value: (row) => when(row.description_updated_at) },
    { key: "agent", label: t("Agent"), value: (row) => row.agent, render: (row) => <span className="agent-sessions-agent"><AgentMark agent={row.agent} size={14} />{row.agent}</span> },
    { key: "branch", label: t("Branch"), value: (row) => row.branch },
    { key: "first_seen", label: t("First seen"), value: (row) => when(row.first_seen_at) },
    { key: "ended", label: t("Ended"), value: (row) => when(row.ended_at) },
    { key: "agent_session_id", label: t("Agent session id"), value: (row) => (row.agent_session_kind === "pane" ? null : row.agent_session_id), render: (row) => row.agent_session_kind === "pane" ? "" : <code>{row.agent_session_id.slice(0, 8)}</code> },
  ];

  return (
    <section className="agent-sessions" aria-label={t("Agent sessions")}>
      <div className="agent-sessions-toolbar">
        <span className="agent-sessions-count">{t("{n} agent sessions", { n: records.length })}</span>
        <ColumnPicker columns={columns} hidden={hidden} onChange={setHidden} />
      </div>
      <DataTable label={t("Agent sessions")} columns={columns.filter((column) => !hidden.includes(column.key))} rows={records} rowKey={(row) => String(row.id)}
        empty={t("No agent sessions recorded yet.")} expansion={(row) => <AgentSessionDetail record={row} onChange={replace} />} />
    </section>
  );
}

/** Which columns the table shows: a checkbox per column. */
function ColumnPicker({ columns, hidden, onChange }: { columns: ReadonlyArray<Column<AgentSessionRecord>>; hidden: readonly string[]; onChange: (hidden: string[]) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);
  return (
    <div className="agent-sessions-columns" ref={root}>
      <button type="button" className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}><Columns3 aria-hidden="true" />{t("Columns")}</button>
      {open && <div className="agent-sessions-columns-menu" role="group" aria-label={t("Columns shown")}>
        {columns.map((column) => (
          <label key={column.key} className="agent-sessions-columns-row">
            <input type="checkbox" checked={!hidden.includes(column.key)}
              onChange={() => onChange(hidden.includes(column.key) ? hidden.filter((key) => key !== column.key) : [...hidden, column.key])} />
            {column.label}
          </label>
        ))}
      </div>}
    </div>
  );
}

function AgentSessionDetail({ record, onChange }: { record: AgentSessionRecord; onChange: (record: AgentSessionRecord) => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[] | null>(null);
  const [copied, setCopied] = useState(false);
  const linked: Array<{ target: LinkTarget; label: string }> = [
    ...record.pull_requests.filter((link) => link.status === "linked").map((link) => ({ target: { kind: "pull_request" as const, url: link.url }, label: pullRequestName(link.url) })),
    ...record.linear_issues.filter((link) => link.status === "linked").map((link) => ({ target: { kind: "linear_issue" as const, identifier: link.identifier }, label: link.identifier })),
  ];
  const run = (action: Promise<AgentSessionRecord>): void => {
    setError(null);
    action.then(onChange).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  const add = (event: FormEvent): void => {
    event.preventDefault();
    const pr = parsePullRequestUrl(draft);
    const identifier = pr === null ? parseLinearIdentifier(draft) : null;
    if (pr === null && identifier === null) { setError(t("Paste a GitHub pull request URL or a Linear issue id.")); return; }
    run(linkAgentSession(record.id, pr ? { kind: "pull_request", url: pr.url, source: "manual" } : { kind: "linear_issue", identifier: identifier!, source: "manual" }));
    setDraft("");
  };
  const accept = (suggestion: LinkSuggestion): void => {
    const target: LinkTarget = suggestion.kind === "pull_request" ? { kind: "pull_request", url: suggestion.url } : { kind: "linear_issue", identifier: suggestion.identifier };
    run(linkAgentSession(record.id, { ...target, source: "manual", reason: suggestion.evidence }));
    setSuggestions((current) => current?.filter((other) => other !== suggestion) ?? null);
  };

  return (
    <div className="agent-session-detail" onClick={(event) => event.stopPropagation()}>
      <dl className="agent-session-facts">
        <dt>{t("Agent session id")}</dt><dd><code>{record.agent_session_id}</code></dd>
        <dt>{t("Folder")}</dt><dd><code>{record.cwd ?? ""}</code></dd>
        <dt>{t("Branch")}</dt><dd>{record.branch ?? ""}</dd>
        <dt>{t("Described")}</dt><dd>{when(record.description_updated_at) ?? ""}</dd>
      </dl>
      {record.resume_command && <div className="agent-session-resume">
        <span>{t("Resume on {host}", { host: record.host })}</span>
        <code>{record.resume_command}</code>
        <button type="button" className="icon-button agent-session-action" aria-label={t("Copy the resume command")} title={t("Copy the resume command")}
          onClick={() => { void navigator.clipboard?.writeText(record.resume_command!).then(() => setCopied(true)); }}><Copy /></button>
        {copied && <span role="status">{t("Copied")}</span>}
      </div>}
      <div className="agent-session-links">
        {linked.length === 0 && <span className="agent-session-none">{t("Not linked to a pull request or Linear issue yet.")}</span>}
        {linked.map((link) => (
          <span key={link.label} className="agent-session-link">
            {link.label}
            <button type="button" className="icon-button agent-session-action" aria-label={t("Remove the link to {name}", { name: link.label })} onClick={() => run(unlinkAgentSession(record.id, link.target))}><X /></button>
          </span>
        ))}
      </div>
      <form className="agent-session-add" onSubmit={add}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("Pull request URL or Linear issue id")} aria-label={t("Pull request URL or Linear issue id")} />
        <button type="submit" className="btn" disabled={!draft.trim()}>{t("Link")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setError(null); fetchLinkSuggestions(record.id).then(setSuggestions).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))); }}>
          <Sparkles aria-hidden="true" />{t("Suggest links")}
        </button>
      </form>
      {suggestions !== null && (suggestions.length === 0
        ? <p className="agent-session-none">{t("No suggestions: link by hand, or run the linking agent.")}</p>
        : <ul className="agent-session-suggestions">
          {suggestions.map((suggestion) => {
            const label = suggestion.kind === "pull_request" ? pullRequestName(suggestion.url) : suggestion.identifier;
            return (
              <li key={label}>
                <span className="agent-session-link">{label}</span>
                <span className="agent-session-evidence">{[suggestion.title, suggestion.evidence].filter(Boolean).join(" · ")}</span>
                <button type="button" className="btn" onClick={() => accept(suggestion)}>{t("Link")}</button>
              </li>
            );
          })}
        </ul>)}
      {error !== null && <p className="agent-session-error" role="alert">{error}</p>}
    </div>
  );
}
