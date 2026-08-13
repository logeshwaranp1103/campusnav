"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/shared/components/ui/toast";

type AdminAuthContextType = {
  isAuthenticated: boolean;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextType>({
  isAuthenticated: false,
  logout: () => {},
});

export const useAdminAuth = () => useContext(AdminAuthContext);

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    if (pathname === "/admin/login") {
      setIsAuthenticated(true);
      return;
    }

    // Use sessionStorage so closing browser tab automatically logs out user
    const storedAuth = typeof window !== "undefined" ? sessionStorage.getItem("campusnav_admin_auth") : null;
    if (storedAuth === "true") {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
      const redirectTarget = `/admin/login?redirect=${encodeURIComponent(pathname)}`;
      router.replace(redirectTarget);
    }
  }, [pathname, router]);

  const logout = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("campusnav_admin_auth");
      localStorage.removeItem("campusnav_admin_auth");
    }
    setIsAuthenticated(false);
    toast({
      type: "info",
      title: "Signed Out",
      description: "You have been logged out of the Admin Panel.",
    });
    router.replace("/admin/login");
  };

  if (pathname === "/admin/login") {
    return (
      <AdminAuthContext.Provider value={{ isAuthenticated: true, logout }}>
        {children}
      </AdminAuthContext.Provider>
    );
  }

  if (isAuthenticated === null || !isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 text-sm text-[rgb(var(--muted-fg))] bg-[rgb(var(--bg))]">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
        Verifying admin session…
      </div>
    );
  }

  return (
    <AdminAuthContext.Provider value={{ isAuthenticated: true, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}
