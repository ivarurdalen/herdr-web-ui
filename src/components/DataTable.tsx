import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useT } from "../lib/i18n.ts";

export interface Column<T> {
  key: string;
  label: string;
  /** the one value the cell holds, which sorting and filtering read */
  value: (row: T) => string | null;
  /** how the cell shows it, when not as text */
  render?: (row: T) => ReactNode;
}

interface Props<T> {
  label: string;
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** the detail a row opens to, when it has one */
  expansion?: (row: T) => ReactNode;
  empty: string;
}

/** A table that sorts by any column and filters by each, one value per cell. */
export function DataTable<T>({ label, columns, rows, rowKey, expansion, empty }: Props<T>) {
  const t = useT();
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const active = columns.filter((column) => filters[column.key]?.trim());
    const kept = rows.filter((row) => active.every((column) => (column.value(row) ?? "").toLowerCase().includes(filters[column.key]!.trim().toLowerCase())));
    const column = sort === null ? undefined : columns.find((candidate) => candidate.key === sort.key);
    if (column === undefined) return kept;
    const sign = sort!.descending ? -1 : 1;
    // an empty cell sorts last either way
    return [...kept].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return sign * left.localeCompare(right, undefined, { numeric: true });
    });
  }, [rows, columns, filters, sort]);

  return (
    <div className="data-table-scroll">
      <table className="data-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sorted = sort?.key === column.key ? sort : null;
              return (
                <th key={column.key} scope="col" aria-sort={sorted === null ? "none" : sorted.descending ? "descending" : "ascending"}>
                  <button type="button" className="data-table-sort" onClick={() => setSort(sorted === null ? { key: column.key, descending: false } : sorted.descending ? null : { key: column.key, descending: true })}>
                    {column.label}
                    {sorted && (sorted.descending ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />)}
                  </button>
                </th>
              );
            })}
          </tr>
          <tr className="data-table-filters">
            {columns.map((column) => (
              <th key={column.key} scope="col">
                <input type="search" value={filters[column.key] ?? ""} aria-label={t("Filter {column}", { column: column.label })} placeholder={t("Filter")}
                  onChange={(event) => setFilters({ ...filters, [column.key]: event.target.value })} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && <tr><td className="data-table-empty" colSpan={columns.length}>{empty}</td></tr>}
          {shown.map((row) => {
            const key = rowKey(row);
            const expanded = expansion !== undefined && open === key;
            return (
              <Fragment key={key}>
                <tr className={expansion ? "data-table-row is-expandable" : "data-table-row"} aria-expanded={expansion ? expanded : undefined}
                  tabIndex={expansion ? 0 : undefined} onClick={() => expansion && setOpen(expanded ? null : key)}
                  onKeyDown={(event) => { if (expansion && (event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); setOpen(expanded ? null : key); } }}>
                  {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : column.value(row) ?? ""}</td>)}
                </tr>
                {expanded && <tr className="data-table-expansion"><td colSpan={columns.length}>{expansion(row)}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
