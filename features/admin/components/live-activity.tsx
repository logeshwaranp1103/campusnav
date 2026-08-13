"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navigation2, Search, MapPin, LogIn } from "lucide-react";
import { destinations } from "@/shared/data/campus";

type Event = { id: string; type: "route" | "search" | "arrival" | "login"; text: string; time: string };

const icons = {
  route: <Navigation2 className="h-4 w-4 text-[rgb(var(--primary))]" />,
  search: <Search className="h-4 w-4 text-[rgb(var(--warning))]" />,
  arrival: <MapPin className="h-4 w-4 text-[rgb(var(--success))]" />,
  login: <LogIn className="h-4 w-4 text-[rgb(var(--muted-fg))]" />,
};

function synth(): Event {
  const kinds: Event["type"][] = ["route", "search", "arrival", "login"];
  const type = kinds[Math.floor(Math.random() * kinds.length)];
  const d = destinations[Math.floor(Math.random() * destinations.length)];
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const text =
    type === "route"
      ? `Route requested to ${d.name}`
      : type === "search"
        ? `Searched "${d.aliases[0] ?? d.name}"`
        : type === "arrival"
          ? `Arrived at ${d.name}`
          : "Guest session started";
  return { id: Math.random().toString(36).slice(2), type, text, time };
}

export function LiveActivity() {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    setEvents(Array.from({ length: 4 }, synth));
    const t = setInterval(() => {
      setEvents((s) => [synth(), ...s].slice(0, 12));
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <ul className="scrollbar-thin max-h-80 space-y-1 overflow-y-auto">
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <motion.li
            key={e.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-[rgb(var(--muted))]"
          >
            <div className="rounded-md bg-[rgb(var(--muted))] p-1.5">{icons[e.type]}</div>
            <div className="flex-1">{e.text}</div>
            <div className="text-xs text-[rgb(var(--muted-fg))]">{e.time}</div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
