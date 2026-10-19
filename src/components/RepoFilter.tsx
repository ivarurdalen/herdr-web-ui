import { useEffect, useId, useRef, useState } from "react";
import { Filter } from "lucide-react";
import { useT } from "../lib/i18n.ts";
import "./RepoFilter.css";

interface Props {
  /** each repo with how many agents work on it */
  repos: ReadonlyArray<{ repo: string; count: number }>;
  chosen: readonly string[];
  onChange: (chosen: string[]) => void;
}

/** The sidebar's repo filter: a funnel that opens a checkbox per repo. */
export function RepoFilter({ repos, chosen, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  const toggle = (repo: string): void => onChange(chosen.includes(repo) ? chosen.filter((other) => other !== repo) : [...chosen, repo]);
  const label = chosen.length === 0 ? t("Filter by repo") : t("Filtered to {n} repos", { n: chosen.length });

  return (
    <div className="repo-filter" ref={root}>
      <button type="button" className={`icon-button repo-filter-button${chosen.length > 0 ? " is-active" : ""}`} aria-label={label} title={label}
        aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        <Filter />
        {chosen.length > 0 && <span className="repo-filter-count" aria-hidden="true">{chosen.length}</span>}
      </button>
      {open && <div className="repo-filter-menu" id={listId} role="group" aria-label={t("Filter by repo")}>
        <div className="repo-filter-head">
          <span>{t("Show only these repos")}</span>
          <button type="button" className="btn btn-ghost" disabled={chosen.length === 0} onClick={() => onChange([])}>{t("Show all")}</button>
        </div>
        <ul className="repo-filter-list">
          {repos.map(({ repo, count }) => (
            <li key={repo}>
              <label className="repo-filter-row">
                <input type="checkbox" checked={chosen.includes(repo)} onChange={() => toggle(repo)} />
                <span className="repo-filter-name">{repo}</span>
                <span className="repo-filter-row-count">{count}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>}
    </div>
  );
}
