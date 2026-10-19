import { useMemo, useState, type FormEvent } from "react";
import { Copy, Maximize2, Sparkles, X } from "lucide-react";
import {
  parseLinearIdentifier, parsePullRequestUrl,
  type AgentSessionRecord, type LinkSuggestion, type LinkTarget,
} from "../../shared/agent-sessions.ts";
import { fetchLinkSuggestions, linkAgentSession, unlinkAgentSession } from "../lib/api.ts";
import { useAgentSessions } from "../lib/agentSessions.ts";
import { useT } from "../lib/i18n.ts";
import { AgentMark } from "./AgentMark.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import "./AgentSessionsPage.css";

interface Props {
  /** opens a running agent session's pane in the full view */
  onOpen: (machineId: string, paneId: string) => void;
}

/** One link of one agent session: the links table's row. */
interface LinkRow {
  record: AgentSessionRecord;
  kind: "pull_request" | "linear_issue";
  ref: string;
  url: string | null;
  title: string | null;
  state: string | null;
  status: string;
  source: string;
  reason: string | null;
}

const when = (iso: string | null): string | null => iso === null ? null : iso.slice(0, 16).replace("T", " ");
const prName = (url: string): string => { const pr = parsePullRequestUrl(url); return pr === null ? url : `${pr.repo.split("/")[1]}#${pr.number}`; };

function linkRows(records: readonly AgentSessionRecord[]): LinkRow[] {
  return records.flatMap((record) => [
    ...record.pull_requests.map((link): LinkRow => ({ record, kind: "pull_request", ref: prName(link.url), url: link.url, title: link.title, state: link.state, status: link.status, source: link.source, reason: link.reason })),
    ...record.linear_issues.map((link): LinkRow => ({ record, kind: "linear_issue", ref: link.identifier, url: link.url, title: link.title, state: link.state, status: link.status, source: link.source, reason: link.reason })),
  ]);
}

/** The hub's record of every agent session it saw (docs/agent-sessions.md), and what each is linked to. */
export function AgentSessionsPage({ onOpen }: Props) {
  const t = useT();
  const { records, replace } = useAgentSessions();
  const [tab, setTab] = useState<"sessions" | "links">("sessions");
  const links = useMemo(() => linkRows(records), [records]);

  const sessionColumns: Array<Column<AgentSessionRecord>> = [
    { key: "state", label: t("State"), value: (row) => (row.ended_at === null ? t("Running") : t("Ended")) },
    { key: "agent", label: t("Agent"), value: (row) => row.agent, render: (row) => <span className="agent-sessions-agent"><AgentMark agent={row.agent} size={14} />{row.agent}</span> },
    { key: "title", label: t("Title"), value: (row) => row.title ?? row.workspace_label },
    { key: "repo", label: t("Repo"), value: (row) => row.repo },
    { key: "branch", label: t("Branch"), value: (row) => row.branch },
    { key: "host", label: t("PC"), value: (row) => row.host },
    { key: "herdr_session", label: t("herdr session"), value: (row) => row.herdr_session },
    { key: "first_seen", label: t("First seen"), value: (row) => when(row.first_seen_at) },
    { key: "ended", label: t("Ended"), value: (row) => when(row.ended_at) },
    { key: "agent_session_id", label: t("Agent session id"), value: (row) => (row.agent_session_kind === "pane" ? null : row.agent_session_id), render: (row) => row.agent_session_kind === "pane" ? "" : <code>{row.agent_session_id.slice(0, 8)}</code> },
  ];
  const linkColumns: Array<Column<LinkRow>> = [
    { key: "kind", label: t("Kind"), value: (row) => (row.kind === "pull_request" ? t("Pull request") : t("Linear issue")) },
    { key: "ref", label: t("Link"), value: (row) => row.ref, render: (row) => row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.ref}</a> : row.ref },
    { key: "title", label: t("Title"), value: (row) => row.title },
    { key: "state", label: t("State"), value: (row) => row.state },
    { key: "status", label: t("Status"), value: (row) => row.status },
    { key: "source", label: t("Made by"), value: (row) => row.source },
    { key: "session", label: t("Agent session"), value: (row) => row.record.title ?? row.record.workspace_label },
    { key: "repo", label: t("Repo"), value: (row) => row.record.repo },
    { key: "host", label: t("PC"), value: (row) => row.record.host },
    { key: "reason", label: t("Reason"), value: (row) => row.reason },
  ];

  return (
    <section className="agent-sessions" aria-label={t("Agent sessions")}>
      <div className="agent-sessions-toolbar">
        <div className="segmented" role="group" aria-label={t("Show")}>
          <button type="button" aria-pressed={tab === "sessions"} onClick={() => setTab("sessions")}>{t("Agent sessions")}</button>
          <button type="button" aria-pressed={tab === "links"} onClick={() => setTab("links")}>{t("Links")}</button>
        </div>
        <span className="agent-sessions-count">{t(tab === "sessions" ? "{n} agent sessions" : "{n} links", { n: tab === "sessions" ? records.length : links.length })}</span>
      </div>
      {tab === "sessions"
        ? <DataTable label={t("Agent sessions")} columns={sessionColumns} rows={records} rowKey={(row) => String(row.id)} empty={t("No agent sessions recorded yet.")}
          expansion={(row) => <AgentSessionDetail record={row} onChange={replace} onOpen={onOpen} />} />
        : <DataTable label={t("Links")} columns={linkColumns} rows={links} rowKey={(row) => `${row.record.id}:${row.kind}:${row.ref}`} empty={t("No links yet.")} />}
    </section>
  );
}

function AgentSessionDetail({ record, onChange, onOpen }: { record: AgentSessionRecord; onChange: (record: AgentSessionRecord) => void; onOpen: Props["onOpen"] }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[] | null>(null);
  const [copied, setCopied] = useState(false);
  const linked: Array<{ target: LinkTarget; label: string; url: string | null; reason: string | null; source: string }> = [
    ...record.pull_requests.filter((link) => link.status === "linked").map((link) => ({ target: { kind: "pull_request" as const, url: link.url }, label: prName(link.url), url: link.url, reason: link.reason, source: link.source })),
    ...record.linear_issues.filter((link) => link.status === "linked").map((link) => ({ target: { kind: "linear_issue" as const, identifier: link.identifier }, label: link.identifier, url: link.url, reason: link.reason, source: link.source })),
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
        <dt>{t("Workspace")}</dt><dd>{record.workspace_label ?? ""}</dd>
        <dt>{t("Last seen")}</dt><dd>{when(record.last_seen_at)}</dd>
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
          <span key={link.label} className="agent-session-link" title={[link.source, link.reason].filter(Boolean).join(" · ")}>
            {link.url ? <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> : link.label}
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
        {record.ended_at === null && record.pane_id && <button type="button" className="btn btn-ghost" onClick={() => onOpen(record.machine_id, record.pane_id!)}><Maximize2 aria-hidden="true" />{t("Open")}</button>}
      </form>
      {suggestions !== null && (suggestions.length === 0
        ? <p className="agent-session-none">{t("No suggestions: link by hand, or run the linking agent.")}</p>
        : <ul className="agent-session-suggestions">
          {suggestions.map((suggestion) => {
            const label = suggestion.kind === "pull_request" ? prName(suggestion.url) : suggestion.identifier;
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
