"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Plus, LayoutGrid, Table, Trash2, Undo2, Redo2 } from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import { DigitalTwinEditor } from "@/features/admin/components/digital-twin-editor";

const variantForType: Record<string, Parameters<typeof Badge>[0]["variant"]> = {
  WALK: "default",
  ROAD: "default",
  STAIRS: "warning",
  LIFT: "primary",
  RAMP: "success",
};

export default function Page() {
  const [storeData, setStoreData] = useState(campusStore.getWorkingData());
  const [viewMode, setViewMode] = useState<"TABLE" | "EDITOR">("TABLE");

  useEffect(() => {
    const unsub = campusStore.subscribe(() => setStoreData(campusStore.getWorkingData()));
    return () => {
      unsub();
    };
  }, []);


  const nodeById = (id: string) => storeData.nodes.find((n) => n.id === id);

  const seen = new Set<string>();
  const unique = storeData.edges.filter((e) => {
    const key = [e.from, e.to, e.type].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rows = unique.map((e) => ({
    id: e.id,
    from: nodeById(e.from)?.name ?? e.from,
    to: nodeById(e.to)?.name ?? e.to,
    type: e.type,
    distance: e.distance,
  }));

  return (
    <>
      <PageHeader
        title="Edges"
        description="Edges connect two nodes with live path preview lines and dynamic distance calculations."
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!campusStore.canUndo()}
              onClick={() => campusStore.undo()}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!campusStore.canRedo()}
              onClick={() => campusStore.redo()}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>

            <Button
              size="sm"
              variant={viewMode === "EDITOR" ? "primary" : "outline"}
              onClick={() => setViewMode(viewMode === "EDITOR" ? "TABLE" : "EDITOR")}
            >
              {viewMode === "EDITOR" ? <Table className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              {viewMode === "EDITOR" ? "Table View" : "CAD Editor"}
            </Button>
            <Button size="sm" onClick={() => setViewMode("EDITOR")}>
              <Plus className="h-4 w-4" /> New Edge
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="EDGE" />
      ) : (
        <DataTable
          keyField="id"
          data={rows}
          columns={[
            { key: "from", label: "From" },
            { key: "to", label: "To" },
            {
              key: "type",
              label: "Type",
              render: (r) => (
                <Badge variant={variantForType[String(r.type)] ?? "default"}>
                  {String(r.type)}
                </Badge>
              ),
            },
            {
              key: "distance",
              label: "Distance",
              render: (r) => `${r.distance} m`,
            },
            {
              key: "actions",
              label: "Actions",
              render: (e) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => campusStore.deleteEdge(String(e.id))}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

