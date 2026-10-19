import { useMemo } from "react";
import { openAgentSessionsByPane, useAgentSessions } from "../lib/agentSessions.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { AgentSessionLinks } from "./AgentSessionLinks.tsx";
import { Markdown } from "./Markdown.tsx";
import "./AgentSessionStrip.css";

const when = (iso: string): string => iso.slice(0, 16).replace("T", " ");

/** Above a chat, what the hub's record knows of the agent session in it: its summary, links and where it runs. */
export function AgentSessionStrip({ paneId }: { paneId: string }) {
  const t = useT();
  const machineId = useMachineId();
  const { records } = useAgentSessions();
  const record = useMemo(() => openAgentSessionsByPane(records).get(`${machineId}:${paneId}`) ?? null, [records, machineId, paneId]);
  if (record === null) return null;
  const linked = record.pull_requests.some((link) => link.status === "linked") || record.linear_issues.some((link) => link.status === "linked");
  const facts = [record.repo, record.branch, record.herdr_session ? `${record.host}/${record.herdr_session}` : record.host].filter(Boolean).join(" · ");
  return (
    <details className="agent-session-strip" open>
      <summary>
        <span className="agent-session-strip-facts">{facts}</span>
        {linked && <span className="agent-session-strip-links">
          <AgentSessionLinks record={record} kind="pull_request" />
          {record.pull_requests.some((link) => link.status === "linked") && record.linear_issues.some((link) => link.status === "linked") && " · "}
          <AgentSessionLinks record={record} kind="linear_issue" />
        </span>}
      </summary>
      {record.description && <Markdown className="agent-session-strip-description">{record.description}</Markdown>}
      <p className="agent-session-strip-meta">
        {record.agent_session_kind !== "pane" && <span title={t("Agent session id")}><code>{record.agent_session_id}</code></span>}
        {record.description_updated_at && <span>{t("Described {when}", { when: when(record.description_updated_at) })}</span>}
      </p>
    </details>
  );
}
