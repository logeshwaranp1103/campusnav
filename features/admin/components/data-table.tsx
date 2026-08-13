"use client";

import { useMemo, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { Search } from "lucide-react";

type Column<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
};

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  searchable = true,
  keyField,
}: {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  keyField: keyof T;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q) return data;
    const needle = q.toLowerCase();
    return data.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [data, q]);

  return (
    <div className="card overflow-hidden p-0">
      {searchable && (
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-[rgb(var(--muted-fg))]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            className="h-11 border-0 bg-transparent focus-visible:ring-0"
          />
          <span className="text-xs text-[rgb(var(--muted-fg))] shrink-0 whitespace-nowrap select-none">
            {filtered.length} of {data.length}
          </span>
        </div>
      )}
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-[rgb(var(--muted))]">
            <tr>
              {columns.map((c) => (
                <th
                  key={String(c.key)}
                  className={`p-3 text-left text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))] ${c.className ?? ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={String(row[keyField])}
                className="border-b transition-colors hover:bg-[rgb(var(--muted)/0.5)] last:border-0"
              >
                {columns.map((c) => (
                  <td key={String(c.key)} className={`p-3 ${c.className ?? ""}`}>
                    {c.render
                      ? c.render(row)
                      : String(row[c.key as keyof T] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-8 text-center text-sm text-[rgb(var(--muted-fg))]"
                >
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
