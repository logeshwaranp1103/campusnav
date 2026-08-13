"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Plus, LayoutGrid, Table } from "lucide-react";
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
        title="Search Manager"
        description="Aliases and categories that power search. Connect new destinations visually on the canvas."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={viewMode === "EDITOR" ? "primary" : "outline"}
              onClick={() => setViewMode(viewMode === "EDITOR" ? "TABLE" : "EDITOR")}
            >
              {viewMode === "EDITOR" ? <Table className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              {viewMode === "EDITOR" ? "Table View" : "CAD Editor"}
            </Button>
            <Button size="sm" onClick={() => setViewMode("EDITOR")}>
              <Plus className="h-4 w-4" /> New Destination
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="DESTINATION" />
      ) : (
        <DataTable
          keyField="id"
          data={storeData.destinations}
          columns={[
            { key: "name", label: "Destination" },
            {
              key: "category",
              label: "Category",
              render: (d) => <Badge variant="primary">{String(d.category)}</Badge>,
            },
            {
              key: "aliases",
              label: "Aliases",
              render: (d) => (
                <div className="flex flex-wrap gap-1">
                  {(d.aliases as string[]).map((a) => (
                    <Badge key={a}>{a}</Badge>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

