"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Menu, X, ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const links = [
  { href: "/", label: "Home" },
  { href: "/navigate", label: "Navigate" },
];



export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const isScrolled = window.scrollY > 8;
      setScrolled((prev) => (prev !== isScrolled ? isScrolled : prev));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-[rgb(var(--border))] transition-shadow duration-200 glass-strong",
        scrolled ? "shadow-[var(--shadow-sm)]" : "",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-[rgb(var(--primary))] opacity-30 blur-md group-hover:opacity-60 transition-opacity" />
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl gradient-primary text-white shadow-[var(--shadow-sm)]">
              <Compass className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight">
              CampusNav
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-fg))] sm:block">
              Digital Twin
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))]/60 p-1 md:flex">
          {links.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "text-[rgb(var(--fg))]"
                    : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-full bg-[rgb(var(--muted))]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                  />
                )}
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/navigate" className="hidden sm:block">
            <Button size="sm" variant="gradient">
              Start Navigating
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-t md:hidden"
          >
            <div className="flex flex-col gap-1 p-3">
              {links.map((l) => {
                const active =
                  l.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-[rgb(var(--muted))] text-[rgb(var(--fg))]"
                        : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]",
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
              <Link href="/navigate" onClick={() => setOpen(false)} className="mt-2">
                <Button variant="gradient" className="w-full">
                  Start Navigating <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
