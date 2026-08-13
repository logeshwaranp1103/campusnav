"use client";

import { PageHeader } from "@/features/admin/components/page-header";
import { EntityManager } from "@/features/admin/components/entity-manager";
import { Badge } from "@/shared/components/ui/badge";

export default function EntityManagementPage() {
  return (
    <>
      <PageHeader
        eyebrow="Campus Objects Manager"
        title="Entity Management"
        description="Dedicated panel for creating, editing, and managing every campus object with real-time CAD Canvas synchronization."
        action={
          <Badge variant="success">
            <span className="mr-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))] pulse-dot" />
            Live Sync Active
          </Badge>
        }
      />
      <EntityManager />
    </>
  );
}
