import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="rounded-full bg-[rgb(var(--muted))] p-3">
        <Icon className="h-6 w-6 text-[rgb(var(--muted-fg))]" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-[rgb(var(--muted-fg))]">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
