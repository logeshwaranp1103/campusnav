"use client";

import { Suspense } from "react";
import { DigitalTwinEditor } from "@/features/admin/components/digital-twin-editor";

export default function CADEditorPage() {
  return (
    <div className="h-[calc(100vh-1rem)] w-full overflow-hidden">
      <Suspense fallback={<div className="p-8 text-xs text-muted-foreground">Loading CAD Editor...</div>}>
        <DigitalTwinEditor initialTool="SELECT" />
      </Suspense>
    </div>
  );
}
