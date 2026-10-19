import { Fragment } from "react";
import { parsePullRequestUrl, type AgentSessionRecord } from "../../shared/agent-sessions.ts";

/** A pull request's short name: `repo#number`. */
export function pullRequestName(url: string): string {
  const pr = parsePullRequestUrl(url);
  return pr === null ? url : `${pr.repo.split("/")[1]}#${pr.number}`;
}

/** An agent session's linked pull requests or Linear issues, as links out, comma-separated. */
export function AgentSessionLinks({ record, kind }: { record: AgentSessionRecord; kind: "pull_request" | "linear_issue" }) {
  const links = kind === "pull_request"
    ? record.pull_requests.filter((link) => link.status === "linked").map((link) => ({ key: link.url, label: pullRequestName(link.url), url: link.url as string | null, title: link.title, state: link.state, reason: link.reason }))
    : record.linear_issues.filter((link) => link.status === "linked").map((link) => ({ key: link.identifier, label: link.identifier, url: link.url, title: link.title, state: link.state, reason: link.reason }));
  return <span className="agent-session-link-list">
    {links.map((link, index) => (
      <Fragment key={link.key}>
        {index > 0 && ", "}
        {link.url
          ? <a href={link.url} target="_blank" rel="noreferrer" title={[link.title, link.state, link.reason].filter(Boolean).join(" · ")} onClick={(event) => event.stopPropagation()}>{link.label}</a>
          : <span title={link.reason ?? undefined}>{link.label}</span>}
      </Fragment>
    ))}
  </span>;
}

/** The names of the linked pull requests or issues, for sorting and filtering a table by them. */
export function linkNames(record: AgentSessionRecord, kind: "pull_request" | "linear_issue"): string | null {
  const names = kind === "pull_request"
    ? record.pull_requests.filter((link) => link.status === "linked").map((link) => pullRequestName(link.url))
    : record.linear_issues.filter((link) => link.status === "linked").map((link) => link.identifier);
  return names.length > 0 ? names.join(", ") : null;
}
