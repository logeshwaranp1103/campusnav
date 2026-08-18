"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { MapPin, Search, Sparkles } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { campusStore } from "@/shared/lib/campus-store";
import type { Destination } from "@/shared/data/campus";

import { isEventActive } from "@/shared/lib/event-utils";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.035,
      delayChildren: 0.02,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.2,
      ease: "easeOut",
    },
  },
};

export function ExplorePanel() {
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [storeData, setStoreData] = useState<ReturnType<typeof campusStore.getPublishedData>>(() => campusStore.getPublishedData());
  const [category, setCategory] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
    let isCancelled = false;
    const updateData = () => {
      if (!isCancelled) {
        setStoreData(campusStore.getPublishedData());
      }
    };
    updateData();
    campusStore.fetchPublishedData().then((freshData) => {
      if (!isCancelled && freshData) {
        setStoreData(freshData);
      }
    });
    const unsub = campusStore.subscribe(updateData);
    return () => {
      isCancelled = true;
      unsub();
    };
  }, []);

  const items = useMemo(() => {
    // Destinations from store
    const destItems: (Destination & { isEvent?: boolean; eventTitle?: string })[] = (storeData.destinations || []).map((d) => ({
      ...d,
      isEvent: false,
    }));

    // Buildings from store
    const buildingItems = (storeData.buildings || []).map((b) => {
      const activeEv = (storeData.events || []).find((ev) => ev.buildingId === b.id && isEventActive(ev));
      return {
        id: b.id,
        name: b.name,
        category: activeEv ? "Events" : "Building",
        floorId: "f-out",
        nodeId: b.id,
        aliases: [b.shortCode || "", b.name, activeEv?.title || ""].filter(Boolean),
        isEvent: !!activeEv,
        eventTitle: activeEv?.title,
      };
    });

    // Standalone Events from store
    const eventItems = (storeData.events || [])
      .filter((ev) => isEventActive(ev) && !storeData.buildings.some((b) => b.id === ev.buildingId))
      .map((ev) => ({
        id: ev.id,
        name: ev.title,
        category: "Events",
        floorId: "f-out",
        nodeId: ev.id,
        aliases: [ev.title, ev.description || ""].filter(Boolean),
        isEvent: true,
        eventTitle: ev.title,
      }));

    // Named Nodes (Gates, Entrances, Landmarks) from store
    const namedNodeItems = (storeData.nodes || [])
      .filter((n) => n.name && n.name.trim().length > 0)
      .map((n) => {
        const category =
          n.type === "GATE"
            ? "Gate / Entrance"
            : n.type === "BUILDING_ENTRANCE" || n.type === "ROOM_ENTRANCE"
            ? "Entrance"
            : n.type === "STAIR" || n.type === "LIFT"
            ? "Floor Transition"
            : n.type === "RECEPTION"
            ? "Reception"
            : n.type === "OUTDOOR" || n.type === "OUTDOOR_PATH" || n.type === "ROAD_JUNCTION"
            ? "Campus Landmark"
            : "Map Location";

        return {
          id: n.id,
          name: n.name!,
          category: category,
          floorId: n.floorId,
          nodeId: n.id,
          aliases: [
            n.name!,
            n.type,
            ...(n.name!.toLowerCase().includes("gate") ? ["gate", "entrance", "main gate", "a gate"] : []),
            ...(n.name!.toLowerCase().includes("entrance") ? ["entrance", "entry", "door"] : []),
          ],
          isEvent: false,
        };
      });

    const map = new Map<string, Destination & { isEvent?: boolean; eventTitle?: string }>();
    destItems.forEach((d) => map.set(d.id, d));
    buildingItems.forEach((b) => {
      if (!map.has(b.id)) map.set(b.id, b);
    });
    eventItems.forEach((e) => {
      if (!map.has(e.id)) map.set(e.id, e);
    });
    namedNodeItems.forEach((n) => {
      if (!map.has(n.id)) map.set(n.id, n);
    });

    return Array.from(map.values());
  }, [storeData]);

  const searchResults = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      const nameMatch = i.name.toLowerCase().includes(needle);
      const catMatch = (i.category ?? "").toLowerCase().includes(needle);
      const aliasMatch = (i.aliases ?? []).some((a) => a.toLowerCase().includes(needle));
      return nameMatch || catMatch || aliasMatch;
    });
  }, [items, q]);

  // Ensure category chips order: "All" -> "Events" -> "Academic" / other categories
  const categories = useMemo(() => {
    const rawSet = new Set(searchResults.map((i) => i.category || "General"));
    const rest = Array.from(rawSet).filter((c) => c !== "Events");
    return ["Events", ...rest];
  }, [searchResults]);

  const filtered = useMemo(() => {
    if (!category) return searchResults;
    if (category === "Events") {
      return searchResults.filter((i) => i.category === "Events" || i.isEvent);
    }
    return searchResults.filter((i) => (i.category || "General") === category);
  }, [searchResults, category]);

  if (!mounted) {
    return (
      <div className="flex h-48 items-center justify-center p-6 text-sm text-[rgb(var(--muted-fg))]">
        <span className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent inline-block" />
        Loading destinations…
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-6 flex items-center">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-fg))] z-10 pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — Buildings, Library, Labs, Rooms…"
          className="h-12 w-full border bg-[rgb(var(--card))] pl-10 pr-4 text-sm rounded-xl transition-shadow focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]"
        />
      </div>

      <div className="mb-6 flex items-center overflow-x-auto scrollbar-none gap-2 py-1 relative [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
        <FilterChip
          active={!category}
          onClick={() => setCategory(null)}
          label="All"
        />
        {categories.map((c) => (
          <FilterChip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
            label={c}
          />
        ))}
      </div>

      <motion.div
        variants={shouldReduceMotion ? undefined : containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {filtered.map((d) => (
          <motion.div
            key={d.id}
            variants={shouldReduceMotion ? undefined : itemVariants}
            className="card card-hover flex flex-col gap-3 p-5 border bg-[rgb(var(--card))] hover:shadow-md hover:border-[rgb(var(--border-strong))] transition-all"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-base font-semibold truncate flex items-center gap-1.5">
                  {d.isEvent && <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />}
                  <span>{d.name}</span>
                </div>
                <div className="mt-0.5 text-xs text-[rgb(var(--muted-fg))] truncate">
                  {d.eventTitle ? `Event: ${d.eventTitle}` : (d.aliases ?? []).slice(0, 2).join(" · ") || d.name}
                </div>
              </div>
              <Badge variant={d.isEvent ? "warning" : "primary"} className="shrink-0">
                {d.category}
              </Badge>
            </div>
            <div className="mt-auto pt-3 flex items-center justify-between border-t border-[rgb(var(--border))/0.5]">
              <div className="text-xs text-[rgb(var(--muted-fg))]">
                <MapPin className="mr-1 inline h-3.5 w-3.5" />
                {d.category}
              </div>
              <Link href={`/navigate?to=${encodeURIComponent(d.id)}`}>
                <Button size="sm" variant="gradient">
                  Navigate
                </Button>
              </Link>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {filtered.length === 0 && (
        <div className="card mt-6 p-10 text-center text-sm text-[rgb(var(--muted-fg))]">
          No results found. Try adding buildings in Admin panel or search another keyword.
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      suppressHydrationWarning
      className={`rounded-full border px-3.5 py-1 text-xs font-medium transition-all ${
        active
          ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))]"
          : "hover:bg-[rgb(var(--muted))]"
      }`}
    >
      {label}
    </button>
  );
}
