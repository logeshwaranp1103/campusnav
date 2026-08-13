"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
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


  return (
    <>
      <PageHeader
        title="Buildings"
        description="Manage building footprints and metadata directly on the interactive CAD canvas."
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
              <Plus className="h-4 w-4" /> New Building
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="BUILDING" />
      ) : (
        <DataTable
          keyField="id"
          data={storeData.buildings.map((b) => ({
            ...b,
            floors: storeData.floors.filter((f) => f.buildingId === b.id).length,
          }))}
          columns={[
            {
              key: "shortCode",
              label: "Code",
              render: (b) => (
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ background: b.color as string }}
                >
                  {String(b.shortCode)}
                </span>
              ),
            },
            { key: "name", label: "Name" },
            { key: "floors", label: "Floors" },
            {
              key: "coords",
              label: "Coordinates",
              render: (b) => `${(b.lat ?? 12.971).toFixed(9)}, ${(b.lng ?? 77.594).toFixed(9)}`,
            },
            {
              key: "status",
              label: "Status",
              render: () => <Badge variant="success">Published</Badge>,
            },
            {
              key: "actions",
              label: "Actions",
              render: (b) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => campusStore.deleteBuilding(String(b.id))}
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

