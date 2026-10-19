import { useCallback, useEffect, useState } from "react";
import type { AgentSessionRecord } from "../../shared/agent-sessions.ts";
import { fetchAgentSessions } from "./api.ts";
import { usePageVisible } from "./visibility.ts";

/** Links change when an agent or a person makes them, not by the second. */
const POLL_MS = 30_000;

/** The hub's agent session record (shared/agent-sessions.ts), read while `active` and the page shows. */
export function useAgentSessions(active = true): { records: AgentSessionRecord[]; reload: () => void; replace: (record: AgentSessionRecord) => void } {
  const visible = usePageVisible();
  const [records, setRecords] = useState<AgentSessionRecord[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || !visible) return;
    let stopped = false;
    const read = (): void => { fetchAgentSessions().then((next) => { if (!stopped) setRecords(next); }).catch(() => { /* the next poll tries again */ }); };
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [active, visible, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const replace = useCallback((record: AgentSessionRecord) => setRecords((current) => current.map((other) => (other.id === record.id ? record : other))), []);
  return { records, reload, replace };
}

/** The running agent session in each pane, keyed `machine:pane` like the grid's tiles. */
export function openAgentSessionsByPane(records: readonly AgentSessionRecord[]): Map<string, AgentSessionRecord> {
  return new Map(records.filter((record) => record.ended_at === null && record.pane_id !== null).map((record) => [`${record.machine_id}:${record.pane_id}`, record]));
}
