"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/shared/components/layout/sidebar";
import { AdminTopbar } from "@/shared/components/layout/admin-topbar";
import { AdminGuard } from "@/features/admin/components/admin-guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/admin/login";

  return (
    <AdminGuard>
      {isLoginPage ? (
        children
      ) : (
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopbar />
            <main className="scrollbar-thin flex-1 overflow-y-auto p-4 md:p-8">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
