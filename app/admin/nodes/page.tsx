"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Plus, LayoutGrid, Table, Trash2, Undo2, Redo2 } from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import { DigitalTwinEditor } from "@/features/admin/components/digital-twin-editor";

export default function Page() {
  const [storeData, setStoreData] = useState(campusStore.getWorkingData());
  const [viewMode, setViewMode] = useState<"TABLE" | "EDITOR">("TABLE");

  useEffect(() => {
    const unsub = campusStore.subscribe(() => setStoreData(campusStore.getWorkingData()));
    return () => {
      unsub();
    };
  }, []);


  const rows = storeData.nodes.map((n) => {
    const f = storeData.floors.find((fl) => fl.id === n.floorId);
    const b = f ? storeData.buildings.find((bg) => bg.id === f.buildingId) : undefined;
    return {
      id: n.id,
      name: n.name ?? "—",
      type: n.type,
      building: b?.name ?? "Outdoor",
      floor: f?.name ?? "—",
    };
  });

  return (
    <>
      <PageHeader
        title="Nodes"
        description="Every walkable location is a node. Connect and edit them interactively on the CAD canvas."
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
              <Plus className="h-4 w-4" /> New Node
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="NODE" />
      ) : (
        <DataTable
          keyField="id"
          data={rows}
          columns={[
            { key: "id", label: "ID", className: "font-mono text-xs" },
            { key: "name", label: "Name" },
            {
              key: "type",
              label: "Type",
              render: (r) => <Badge>{String(r.type)}</Badge>,
            },
            { key: "building", label: "Building" },
            { key: "floor", label: "Floor" },
            {
              key: "actions",
              label: "Actions",
              render: (n) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => campusStore.deleteNode(String(n.id))}
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

