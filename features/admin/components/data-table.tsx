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
    <div className="card overflow-hidden p-0 border border-[rgb(var(--border))] shadow-xs">
      {searchable && (
        <div className="flex items-center gap-2 border-b bg-[rgb(var(--card))] px-4 py-2">
          <Search className="h-4 w-4 shrink-0 text-[rgb(var(--muted-fg))]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search & filter rows..."
            className="h-9 border-0 bg-transparent px-1 text-xs focus-visible:ring-0 shadow-none"
          />
          <span className="text-[11px] font-medium text-[rgb(var(--muted-fg))] shrink-0 whitespace-nowrap select-none bg-[rgb(var(--muted))] px-2 py-0.5 rounded-md">
            {filtered.length} of {data.length} entries
          </span>
        </div>
      )}
      <div className="scrollbar-thin overflow-x-auto min-w-0">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="border-b bg-[rgb(var(--muted))/0.5] text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
            <tr>
              {columns.map((c) => (
                <th
                  key={String(c.key)}
                  className={`px-4 py-3.5 whitespace-nowrap font-bold ${c.className ?? ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border))]">
            {filtered.map((row) => (
              <tr
                key={String(row[keyField])}
                className="transition-colors hover:bg-[rgb(var(--muted))/0.3]"
              >
                {columns.map((c) => (
                  <td key={String(c.key)} className={`px-4 py-3.5 align-middle text-[rgb(var(--fg))] font-medium ${c.className ?? ""}`}>
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
                  className="px-4 py-12 text-center text-xs sm:text-sm text-[rgb(var(--muted-fg))]"
                >
                  No matching records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
