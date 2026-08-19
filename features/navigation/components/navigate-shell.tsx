"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  MapPin,
  Navigation2,
  Search,
  X,
  Timer,
  Ruler,
  ChevronDown,
  ArrowRight,
  ArrowDown,
  AlertTriangle,
  Plus,
  Minus,
  Building2,
  Layers,
  Check,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { useToast } from "@/shared/components/ui/toast";
import { cn } from "@/shared/lib/utils";
import type { Destination, Node as CampusNode, Edge, Building, Floor } from "@/shared/data/campus";
import { shortestPath, type Route, type RouteInstruction } from "@/features/navigation/services/graph";
import { campusStore } from "@/shared/lib/campus-store";
import { CampusMap } from "./campus-map";
import { LiveRoutePanel } from "./live-route-panel";
import { TurnByTurnBar } from "./turn-by-turn-bar";
import { getValidNavigationDestinations } from "@/shared/lib/destination-utils";
import { findNearestNodeByGps, findContextAwareNearestNode } from "@/lib/geo/haversine";
import { detectBuildingAtGps } from "@/lib/geo/containment";
import { isPointInsideBuilding } from "@/lib/geo/building-geometry";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { useNavigationStore } from "@/features/navigation/navigation-store";

type StopEntry = {
  dest: Destination | null;
  query: string;
  focus: boolean;
};

const YOUR_LOCATION_ID = "dest-live-user-location";

const YOUR_LOCATION_DEST: Destination = {
  id: YOUR_LOCATION_ID,
  name: "Your Location",
  category: "Live GPS Location",
  nodeId: "n-live-user",
  aliases: ["current location", "my location", "live location", "gps", "me"],
};

export function NavigateShell() {
  const [mounted, setMounted] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Published graph data loaded from store
  const [publishedData, setPublishedData] = useState(() => campusStore.getPublishedData());
  const gps = useVisitorGps();
  const navSession = useNavigationStore();

  // Building & Floor Indoor Navigation Context (Feature 1 & 2)
  const [detectedBuilding, setDetectedBuilding] = useState<Building | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string>("f-out");
  const [showFloorModal, setShowFloorModal] = useState(false);
  const lastPromptedBuildingIdRef = useRef<string | null>(null);

  // Search state for FROM (Start Location)
  const [fromQuery, setFromQuery] = useState("");
  const [fromSelected, setFromSelected] = useState<Destination | null>(null);
  const [fromFocus, setFromFocus] = useState(false);

  // Search state for TO (End Destination)
  const [toQuery, setToQuery] = useState("");
  const [toSelected, setToSelected] = useState<Destination | null>(null);
  const [toFocus, setToFocus] = useState(false);

  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [livePos, setLivePos] = useState<{ node: CampusNode; progress: number } | null>(null);
  const [mobileView, setMobileView] = useState<"panel" | "map">("panel");
  // Fix #11: Multi-stop state
  const [stops, setStops] = useState<StopEntry[]>([]);
  const { toast } = useToast();
  const params = useSearchParams();

  // Close search popups when clicking outside search container
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as globalThis.Node)) {
        setFromFocus(false);
        setToFocus(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setMounted(true);
    let isCancelled = false;

    const updateData = () => {
      if (!isCancelled) {
        setPublishedData(campusStore.getPublishedData());
      }
    };

    updateData();
    const unsub = campusStore.subscribe(updateData);

    // Fetch fresh published graph from database on mount
    campusStore.fetchPublishedData().then((freshData) => {
      if (!isCancelled && freshData) {
        setPublishedData(freshData);
      }
    });

    // Realtime SSE sync when admin publishes map updates
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/campus/stream");
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.version) {
            campusStore.fetchPublishedData(true).then((freshData) => {
              if (!isCancelled && freshData) {
                setPublishedData(freshData);
              }
            });
          }
        } catch {}
      };
    } catch {}

    return () => {
      isCancelled = true;
      unsub();
      if (eventSource) eventSource.close();
    };
  }, []);

  // Filter start/end destinations: no staircase, no lift group, no unnamed nodes. Show all named nodes.
  const allDestinations: Destination[] = useMemo(() => {
    return getValidNavigationDestinations(publishedData);
  }, [publishedData]);

  // Handle URL query parameter ?to=...
  useEffect(() => {
    if (!mounted) return;
    const toId = params.get("to");
    if (toId && allDestinations.length > 0) {
      const match = allDestinations.find((x) => x.id === toId);
      if (match) {
        pickToDestination(match, fromSelected);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, params, allDestinations]);

  // Auto-detect building containment silently for live GPS tracking (NO automatic modal popups)
  useEffect(() => {
    if (!mounted || !gps.isGpsActive || gps.lat === 0 || gps.lng === 0) return;
    if (fromSelected?.id !== YOUR_LOCATION_ID && !live) return;

    const detection = detectBuildingAtGps(
      gps.lat,
      gps.lng,
      gps.accuracy || 10,
      publishedData.buildings || []
    );

    if (detection.isInside && detection.building) {
      const bld = detection.building;
      if (lastPromptedBuildingIdRef.current !== bld.id) {
        lastPromptedBuildingIdRef.current = bld.id;
        setDetectedBuilding(bld);
      }
    } else {
      if (lastPromptedBuildingIdRef.current !== null) {
        lastPromptedBuildingIdRef.current = null;
        setDetectedBuilding(null);
      }
    }
  }, [mounted, gps.lat, gps.lng, gps.isGpsActive, fromSelected?.id, live, publishedData.buildings]);

  // Automatically sync map floor & update user location when user arrives at destination via Live GPS
  useEffect(() => {
    if (navSession.status === "ARRIVED" && toSelected) {
      if (toSelected.floorId && toSelected.floorId !== selectedFloorId) {
        setSelectedFloorId(toSelected.floorId);
      }
      setFromSelected(toSelected);
      setFromQuery(toSelected.name);
      toast({
        type: "success",
        title: "🎉 Destination Reached!",
        description: `You have arrived at ${toSelected.name}. Your location has been updated.`,
      });
    }
  }, [navSession.status]);

  // Suggestions for FROM (Always place "📍 Your Location" as the VERY FIRST option)
  const fromSuggestions = useMemo(() => {
    const q = fromQuery.trim().toLowerCase();
    const list = [YOUR_LOCATION_DEST, ...allDestinations];
    if (!q) return list;
    return list.filter((d) => {
      const nameMatch = d.name.toLowerCase().includes(q);
      const catMatch = (d.category ?? "").toLowerCase().includes(q);
      const aliasMatch = (d.aliases ?? []).some((a) => a.toLowerCase().includes(q));
      return nameMatch || catMatch || aliasMatch;
    });
  }, [fromQuery, allDestinations]);

  // Suggestions for TO
  const toSuggestions = useMemo(() => {
    const q = toQuery.trim().toLowerCase();
    if (!q) return allDestinations;
    return allDestinations.filter((d) => {
      const nameMatch = d.name.toLowerCase().includes(q);
      const catMatch = (d.category ?? "").toLowerCase().includes(q);
      const aliasMatch = (d.aliases ?? []).some((a) => a.toLowerCase().includes(q));
      return nameMatch || catMatch || aliasMatch;
    });
  }, [toQuery, allDestinations]);

  async function calculateRoute(
    startDest: Destination | null,
    endDest: Destination | null,
    currentStops: StopEntry[] = stops,
    currentFloorId = selectedFloorId,
    currentBuildingId: string | null | undefined = detectedBuilding?.id
  ) {
    if (!endDest || !startDest) {
      setRoute(null);
      setLive(false);
      setLivePos(null);
      return;
    }
    setLoading(true);
    setRoute(null);
    setLive(false);
    setLivePos(null);

    // If startDest is Live Location, resolve context-aware nearest node
    let liveStartNodeId: string | null = null;
    if (startDest.id === YOUR_LOCATION_ID) {
      const isInsideBld = Boolean(currentBuildingId && currentFloorId !== "f-out");
      const nearestResult = findContextAwareNearestNode(
        gps.lat,
        gps.lng,
        publishedData.nodes || [],
        {
          isInside: isInsideBld,
          buildingId: currentBuildingId,
          floorId: isInsideBld ? currentFloorId : "f-out",
          floors: publishedData.floors,
        }
      );

      if (!nearestResult.node) {
        setLoading(false);
        toast({
          type: "error",
          title: "Floor Navigation Unavailable",
          description: nearestResult.error || "No navigation nodes are available on this floor.",
        });
        return;
      }
      liveStartNodeId = nearestResult.node.id;
    }

    // Build ordered waypoints: start → stop1 → stop2 → ... → end
    const waypoints: Destination[] = [
      startDest,
      ...currentStops.map((s) => s.dest).filter((d): d is Destination => d !== null),
      endDest,
    ];

    // Chain Dijkstra segments for each consecutive pair
    let totalDistance = 0;
    let totalDurationSec = 0;
    let combinedNodes: CampusNode[] = [];
    let combinedEdges: Edge[] = [];
    let combinedInstructions: RouteInstruction[] = [];
    let hasObstacles = false;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const segStart = waypoints[i];
      const segEnd = waypoints[i + 1];

      const segStartId =
        segStart.id === YOUR_LOCATION_ID
          ? (liveStartNodeId || segStart.nodeId || "n1")
          : (segStart.nodeId || segStart.id);
      const segEndId =
        segEnd.id === YOUR_LOCATION_ID
          ? (liveStartNodeId || segEnd.nodeId || "n1")
          : (segEnd.nodeId || segEnd.id);

      const segRoute = shortestPath(segStartId, segEndId);
      if (!segRoute) {
        setLoading(false);
        toast({
          type: "error",
          title: "No route found",
          description: `No path from "${segStart.name}" to "${segEnd.name}".`,
        });
        return;
      }
      totalDistance += segRoute.distance;
      totalDurationSec += segRoute.durationSec;
      if (segRoute.hasObstacles) hasObstacles = true;

      // Merge (avoid duplicating the connecting node)
      if (i === 0) {
        combinedNodes = [...segRoute.nodes];
        combinedEdges = [...segRoute.edges];
      } else {
        combinedNodes = [...combinedNodes, ...segRoute.nodes.slice(1)];
        combinedEdges = [...combinedEdges, ...segRoute.edges];
      }
      // Merge instructions with a segment header
      if (waypoints.length > 2 && i > 0) {
        combinedInstructions.push({ text: `📍 Via ${segStart.name}`, distance: 0, transition: "arrive" });
      }
      combinedInstructions = combinedInstructions.concat(segRoute.instructions || []);
    }

    const clientRoute: Route = {
      id: `multi-${Date.now()}`,
      nodes: combinedNodes,
      edges: combinedEdges,
      distance: totalDistance,
      durationSec: totalDurationSec,
      instructions: combinedInstructions,
      hasObstacles,
    };

    setRoute(clientRoute);
    setLoading(false);

    if (hasObstacles) {
      toast({
        type: "warning",
        title: "All Routes Have Obstacles",
        description: "No 100% obstacle-free path exists. Routing through the least obstructed path.",
      });
    } else {
      const stopCount = currentStops.filter((s) => s.dest).length;
      toast({
        type: "success",
        title: stopCount > 0 ? `Multi-Stop Route (${stopCount + 2} waypoints)` : `Route to ${endDest.name}`,
        description: `${Math.round(totalDistance)} m · ~${Math.round(totalDurationSec / 60)} min`,
      });
    }
  }

  function handleSelectFloor(floorId: string) {
    setSelectedFloorId(floorId);
    setShowFloorModal(false);

    const bld = detectedBuilding;
    useNavigationStore.getState().setIndoorContext(
      bld?.id ?? null,
      floorId,
      "MANUAL_FLOOR_SELECTION",
      "HIGH"
    );

    const nearestResult = findContextAwareNearestNode(
      gps.lat,
      gps.lng,
      publishedData.nodes || [],
      {
        isInside: true,
        buildingId: bld?.id,
        floorId,
        floors: publishedData.floors,
      }
    );

    const floorName = (publishedData.floors || []).find((f) => f.id === floorId)?.name || "Floor";

    if (!nearestResult.node) {
      toast({
        type: "error",
        title: "Floor Unavailable",
        description: nearestResult.error || "No navigation nodes are available on this floor.",
      });
      setRoute(null);
      return;
    }

    const updatedDest: Destination = {
      ...YOUR_LOCATION_DEST,
      nodeId: nearestResult.node.id,
      floorId,
    };
    setFromSelected(updatedDest);

    if (nearestResult.node) {
      setLivePos({ node: nearestResult.node, progress: 0 });
    }

    toast({
      type: "success",
      title: "Floor Confirmed",
      description: `Starting from ${nearestResult.node.name || nearestResult.node.id} on ${floorName} (${bld?.name ?? "Building"}). Path calculated!`,
    });

    if (toSelected) {
      calculateRoute(updatedDest, toSelected, stops, floorId, bld?.id);
    }
  }

  function handleSelectYourLocation() {
    if (gps.status === "unavailable") {
      toast({
        type: "error",
        title: "Geolocation Unavailable",
        description: "Your browser or device does not support live GPS location.",
      });
      return;
    }

    if (gps.status === "denied") {
      toast({
        type: "error",
        title: "Location Permission Required",
        description: "Please turn on location / allow browser location permission to use live location.",
      });
      return;
    }

    // Start tracking if not active
    if (!gps.isTracking) {
      gps.startTracking();
    }

    // Use the hook's live GPS position if available
    if (gps.isGpsActive && gps.lat !== 0 && gps.lng !== 0) {
      const detection = detectBuildingAtGps(
        gps.lat,
        gps.lng,
        gps.accuracy || 10,
        publishedData.buildings || []
      );

      if (detection.isInside && detection.building) {
        const bld = detection.building;
        setDetectedBuilding(bld);
        lastPromptedBuildingIdRef.current = bld.id;

        const bldFloors = (publishedData.floors || [])
          .filter((f) => f.buildingId === bld.id)
          .sort((a, b) => a.ordinal - b.ordinal);

        let floorToUse = selectedFloorId;
        if (bldFloors.length === 1) {
          // Edge Case 3: Single-floor building -> auto select without prompting
          floorToUse = bldFloors[0].id;
          setSelectedFloorId(floorToUse);
          setShowFloorModal(false);
          useNavigationStore.getState().setIndoorContext(bld.id, floorToUse, "INDOOR_GRAPH_CONTEXT", "HIGH");
        } else if (bldFloors.length > 1) {
          if (!bldFloors.some((f) => f.id === selectedFloorId) || selectedFloorId === "f-out") {
            const ground = bldFloors.find((f) => f.ordinal === 0) || bldFloors[0];
            floorToUse = ground.id;
            setSelectedFloorId(ground.id);
          }
          // Multi-floor building -> open prompt
          setShowFloorModal(true);
          useNavigationStore.getState().setIndoorContext(bld.id, floorToUse, "INDOOR_GRAPH_CONTEXT", "MEDIUM");
        }

        const nearestResult = findContextAwareNearestNode(
          gps.lat,
          gps.lng,
          publishedData.nodes || [],
          {
            isInside: true,
            buildingId: bld.id,
            floorId: floorToUse,
            floors: publishedData.floors,
          }
        );

        const liveDest: Destination = {
          ...YOUR_LOCATION_DEST,
          nodeId: nearestResult.node?.id || "n1",
          floorId: floorToUse,
        };

        setFromSelected(liveDest);
        setFromQuery("Your Location");
        setFromFocus(false);

        if (nearestResult.node) {
          setLivePos({ node: nearestResult.node, progress: 0 });
        }

        if (toSelected) {
          calculateRoute(liveDest, toSelected, stops, floorToUse, bld.id);
        }
      } else {
        // Outdoor user -> NEVER ask for floor
        setDetectedBuilding(null);
        setSelectedFloorId("f-out");
        setShowFloorModal(false);
        useNavigationStore.getState().setIndoorContext(null, "f-out", "OUTDOOR_GPS", "HIGH");

        const nearestResult = findContextAwareNearestNode(
          gps.lat,
          gps.lng,
          publishedData.nodes || [],
          { isInside: false, floorId: "f-out" }
        );

        const liveDest: Destination = {
          ...YOUR_LOCATION_DEST,
          nodeId: nearestResult.node?.id || "n1",
          floorId: "f-out",
        };

        setFromSelected(liveDest);
        setFromQuery("Your Location");
        setFromFocus(false);

        if (nearestResult.node) {
          setLivePos({ node: nearestResult.node, progress: 0 });
        }

        toast({
          type: "success",
          title: "Live Location On",
          description: `Acquired outdoor location near ${nearestResult.node?.name ?? "Campus node"}.`,
        });

        if (toSelected) {
          calculateRoute(liveDest, toSelected, stops, "f-out", null);
        }
      }
    } else {
      // GPS still acquiring — set up as "Your Location"
      toast({
        type: "info",
        title: "Requesting Location...",
        description: "Please allow location access. Your position will update automatically.",
      });
      setFromSelected(YOUR_LOCATION_DEST);
      setFromQuery("Your Location");
      setFromFocus(false);
    }
  }

  function pickFromDestination(d: Destination) {
    if (d.id === YOUR_LOCATION_ID) {
      handleSelectYourLocation();
      return;
    }
    setFromSelected(d);
    setFromQuery(d.name);
    setFromFocus(false);
    calculateRoute(d, toSelected, stops);
  }

  function pickToDestination(d: Destination, currentFrom = fromSelected) {
    setToSelected(d);
    setToQuery(d.name);
    setToFocus(false);
    calculateRoute(currentFrom, d, stops);
  }

  function addStop() {
    setStops((prev) => [...prev, { dest: null, query: "", focus: false }]);
  }

  function removeStop(index: number) {
    const updated = stops.filter((_, i) => i !== index);
    setStops(updated);
    calculateRoute(fromSelected, toSelected, updated);
  }

  function updateStop(index: number, patch: Partial<StopEntry>) {
    const updated = stops.map((s, i) => i === index ? { ...s, ...patch } : s);
    setStops(updated);
  }

  function pickStop(index: number, d: Destination) {
    const updated = stops.map((s, i) =>
      i === index ? { ...s, dest: d, query: d.name, focus: false } : s
    );
    setStops(updated);
    calculateRoute(fromSelected, toSelected, updated);
  }

  function reset() {
    setFromSelected(null);
    setFromQuery("");
    setToSelected(null);
    setToQuery("");
    setRoute(null);
    setLive(false);
    setStops([]);
    setShowFloorModal(false);
  }

  function startLive() {
    setLive(true);
    setMobileView("map");
    if (fromSelected && toSelected && route) {
      useNavigationStore.getState().startNavigationSession(fromSelected, toSelected, route);
    }
  }

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div
        className={cn(
          "z-10 w-full shrink-0 flex-col border-r bg-[rgb(var(--card))] md:flex md:w-80 lg:w-[320px]",
          mobileView === "panel" ? "flex" : "hidden",
        )}
      >
        <div ref={searchContainerRef} className="border-b p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg gradient-primary text-white">
                <Navigation2 className="h-3 w-3" />
              </div>
              <h1 className="text-xs font-bold text-[rgb(var(--fg))]">Plan a Route</h1>
            </div>
            {live && (
              <Badge variant="success" className="text-[10px]">
                <span className="mr-1 inline-flex h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))] pulse-dot" />
                Live
              </Badge>
            )}

          </div>

          {/* FROM Search Field */}
          <div className="relative">
            <label className="mb-0.5 block text-[10px] font-semibold text-[rgb(var(--muted-fg))]">
              From (Start Location)
            </label>
            <div className="flex h-8 items-center gap-2 rounded-lg border bg-[rgb(var(--bg))] px-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[rgb(var(--ring))]">
              <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))]" />
              </span>
              <Input
                value={fromQuery}
                onFocus={() => setFromFocus(true)}
                onChange={(e) => {
                  setFromQuery(e.target.value);
                  setFromSelected(null);
                  setFromFocus(true);
                }}
                placeholder="Search start building, entrance..."
                className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
              {fromQuery && (
                <button onClick={() => { setFromQuery(""); setFromSelected(null); }} aria-label="Clear From" className="shrink-0">
                  <X className="h-3 w-3 text-[rgb(var(--muted-fg))]" />
                </button>
              )}
            </div>

            {/* FROM Suggestions Dropdown */}
            <AnimatePresence>
              {fromFocus && fromSuggestions.length > 0 && !fromSelected && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="card absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto p-1 shadow-2xl border bg-[rgb(var(--card))]/98 backdrop-blur-md"
                >
                  {fromSuggestions.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => pickFromDestination(d)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-[rgb(var(--muted))]",
                        d.id === YOUR_LOCATION_ID && "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 mb-1"
                      )}
                    >
                      <div className={cn(
                        "rounded-md p-1 shrink-0",
                        d.id === YOUR_LOCATION_ID ? "bg-emerald-500 text-white" : "bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--primary))]"
                      )}>
                        {d.id === YOUR_LOCATION_ID ? <Navigation2 className="h-3 w-3 animate-pulse" /> : <MapPin className="h-3 w-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-xs font-medium", d.id === YOUR_LOCATION_ID && "font-bold text-emerald-600 dark:text-emerald-400")}>
                          {d.name}
                        </div>
                        <div className="truncate text-[10px] text-[rgb(var(--muted-fg))]">{d.category}</div>
                      </div>
                      {d.id === YOUR_LOCATION_ID && (
                        <Badge variant="success" className="shrink-0 text-[9px] px-1.5 py-0">
                          Live GPS
                        </Badge>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Contextual Live Location Info & Floor Switcher */}
            {fromSelected?.id === YOUR_LOCATION_ID && (
              <div className="mt-1.5 flex items-center justify-between rounded-lg border border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-500/40 px-2.5 py-1.5 text-xs shadow-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  {detectedBuilding ? (
                    <>
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-800 dark:text-emerald-300" />
                      <span className="truncate font-bold text-[11px] text-emerald-950 dark:text-emerald-100">
                        Inside {detectedBuilding.name} · {publishedData.floors.find((f) => f.id === selectedFloorId)?.name || "Ground Floor"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Navigation2 className="h-3.5 w-3.5 shrink-0 text-emerald-800 dark:text-emerald-300 animate-pulse" />
                      <span className="truncate font-bold text-[11px] text-emerald-950 dark:text-emerald-100">Outdoor Campus Location</span>
                    </>
                  )}
                </div>
                {detectedBuilding && publishedData.floors.filter((f) => f.buildingId === detectedBuilding.id).length > 1 && (
                  <button
                    onClick={() => setShowFloorModal(true)}
                    className="ml-2 shrink-0 rounded px-2 py-0.5 bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-[10px] font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    Change Floor
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Multi-Stop Fields */}
          {stops.map((stop, idx) => {
            const q = stop.query.trim().toLowerCase();
            const stopSuggestions = q
              ? allDestinations.filter((d) => {
                  const nameMatch = d.name.toLowerCase().includes(q);
                  const catMatch = (d.category ?? "").toLowerCase().includes(q);
                  const aliasMatch = (d.aliases ?? []).some((a) => a.toLowerCase().includes(q));
                  return nameMatch || catMatch || aliasMatch;
                })
              : allDestinations.slice(0, 10);

            return (
              <div key={idx} className="relative">
                <label className="mb-0.5 flex items-center justify-between text-[10px] font-semibold text-[rgb(var(--muted-fg))]">
                  <span>Stop {idx + 1}</span>
                  <button onClick={() => removeStop(idx)} className="text-red-400 hover:text-red-500" aria-label="Remove Stop">
                    <Minus className="h-3 w-3" />
                  </button>
                </label>
                <div className="flex h-8 items-center gap-2 rounded-lg border bg-[rgb(var(--bg))] px-2.5 transition-shadow focus-within:ring-2 focus-within:ring-amber-400">
                  <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  </span>
                  <input
                    value={stop.query}
                    onFocus={() => updateStop(idx, { focus: true })}
                    onChange={(e) => updateStop(idx, { query: e.target.value, dest: null, focus: true })}
                    placeholder="Search intermediate stop..."
                    className="h-7 flex-1 border-0 bg-transparent px-0 text-xs focus:outline-none"
                  />
                  {stop.query && (
                    <button onClick={() => updateStop(idx, { query: "", dest: null })} aria-label="Clear Stop" className="shrink-0">
                      <X className="h-3 w-3 text-[rgb(var(--muted-fg))]" />
                    </button>
                  )}
                </div>
                <AnimatePresence>
                  {stop.focus && stopSuggestions.length > 0 && !stop.dest && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="card absolute left-0 right-0 top-full z-40 mt-1 max-h-48 overflow-y-auto p-1 shadow-2xl border bg-[rgb(var(--card))]/98 backdrop-blur-md"
                    >
                      {stopSuggestions.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => pickStop(idx, d)}
                          className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-[rgb(var(--muted))]"
                        >
                          <div className="rounded-md bg-amber-500/10 p-1 text-amber-500 shrink-0">
                            <MapPin className="h-3 w-3" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium">{d.name}</div>
                            <div className="truncate text-[10px] text-[rgb(var(--muted-fg))]">{d.category}</div>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Add Stop button — shown between FROM and TO fields */}
          <button
            onClick={addStop}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-amber-400/60 bg-amber-400/5 py-1 text-[10px] font-medium text-amber-500 hover:bg-amber-400/10 transition-colors"
          >
            <Plus className="h-3 w-3" /> Add Stop
          </button>

          {/* TO Search Field */}
          <div className="relative">
            <label className="mb-0.5 block text-[10px] font-semibold text-[rgb(var(--muted-fg))]">
              To (End Destination)
            </label>
            <div className="flex h-8 items-center gap-2 rounded-lg border bg-[rgb(var(--bg))] px-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[rgb(var(--ring))]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--primary))]" />
              <Input
                value={toQuery}
                onFocus={() => setToFocus(true)}
                onChange={(e) => {
                  setToQuery(e.target.value);
                  setToSelected(null);
                  setToFocus(true);
                }}
                placeholder="Search destination building, room..."
                className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
              {toQuery && (
                <button onClick={() => { setToQuery(""); setToSelected(null); setRoute(null); }} aria-label="Clear To" className="shrink-0">
                  <X className="h-3 w-3 text-[rgb(var(--muted-fg))]" />
                </button>
              )}
            </div>

            {/* TO Suggestions Dropdown */}
            <AnimatePresence>
              {toFocus && toSuggestions.length > 0 && !toSelected && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="card absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto p-1 shadow-2xl border bg-[rgb(var(--card))]/98 backdrop-blur-md"
                >
                  {toSuggestions.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => pickToDestination(d)}
                      className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-[rgb(var(--muted))]"
                    >
                      <div className="rounded-md bg-[rgb(var(--primary)/0.1)] p-1 text-[rgb(var(--primary))] shrink-0">
                        <MapPin className="h-3 w-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{d.name}</div>
                        <div className="truncate text-[10px] text-[rgb(var(--muted-fg))]">{d.category}</div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(fromSelected || toSelected || route) && (
            <Button size="sm" variant="ghost" onClick={reset} className="h-7 w-full text-[11px] text-[rgb(var(--muted-fg))]">
              Clear route & inputs
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 pb-24 md:pb-4 scrollbar-thin [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
          {/* Only show PopularList when neither from nor to is chosen */}
          {!fromSelected && !toSelected && !route && (
            <PopularList onPick={(d) => pickToDestination(d)} allDestinations={allDestinations} mounted={mounted} />
          )}

          {/* If only one point is selected, guide the user to select the other without showing the route box */}
          {((fromSelected && !toSelected) || (!fromSelected && toSelected)) && !loading && (
            <div className="card p-4 text-center space-y-2 border bg-[rgb(var(--card))]">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--primary))]">
                <Navigation2 className="h-4 w-4" />
              </div>
              <div className="text-xs font-bold text-[rgb(var(--fg))]">
                {!fromSelected ? "Select a Start Location" : "Select an End Destination"}
              </div>
              <p className="text-[11px] text-[rgb(var(--muted-fg))] leading-relaxed">
                {!fromSelected
                  ? "Choose where you are starting from to calculate the optimal route."
                  : "Choose your destination point to display the complete navigation route."}
              </p>
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              <div className="shimmer h-16 rounded-lg" />
              <div className="shimmer h-16 rounded-lg" />
              <div className="shimmer h-16 rounded-lg" />
            </div>
          )}

          {/* Route unavailable state when both start and end are selected but no path exists */}
          {fromSelected && toSelected && !route && !loading && (
            <div className="card p-4 text-center space-y-2 border border-red-500/20 bg-red-500/5">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="text-xs font-bold text-red-600 dark:text-red-400">Route Unavailable</div>
              <p className="text-[11px] text-[rgb(var(--muted-fg))] leading-relaxed">
                No connected walkable path exists between <span className="font-semibold text-[rgb(var(--fg))]">{fromSelected.name}</span> and <span className="font-semibold text-[rgb(var(--fg))]">{toSelected.name}</span>.
              </p>
            </div>
          )}

          {/* Route Box: Only appears when BOTH Start and End are selected and a valid route exists */}
          {route && fromSelected && toSelected && (
            <div className="space-y-4">
              <div className="card gradient-border p-4 space-y-3">
                <div className="space-y-2 border-b pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Start</div>
                      <div className="text-xs font-bold truncate text-[rgb(var(--fg))]">{fromSelected.name}</div>
                    </div>
                  </div>

                  <div className="ml-1 pl-3 border-l-2 border-dashed border-[rgb(var(--border))] py-0.5 space-y-0.5">
                    <div className="text-[10px] font-semibold text-[rgb(var(--muted-fg))] flex items-center gap-1">
                      <ArrowDown className="h-3 w-3 text-[rgb(var(--primary))]" />
                      <span>{route.instructions?.length || 0} Route Waypoints ({Math.round(route.distance)}m)</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-[rgb(var(--primary))] ring-2 ring-[rgb(var(--primary)/0.2)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[rgb(var(--primary))]">Destination</div>
                      <div className="text-xs font-bold truncate text-[rgb(var(--fg))]">{toSelected.name}</div>
                    </div>
                    <Badge variant="primary" className="shrink-0 text-[10px]">{toSelected.category}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Stat icon={Ruler} label="Distance" value={`${Math.round(route.distance)} m`} />
                  <Stat icon={Timer} label="ETA" value={`${Math.round(route.durationSec / 60)} min`} />
                </div>

                {route.hasObstacles && (
                  <div className="mt-3 flex items-start gap-3 rounded-xl border border-[#fde047]/70 bg-[#fefce8] dark:border-[#78350f]/60 dark:bg-[#451a03]/40 p-3 shadow-xs">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#fef08a] text-[#b45309] dark:bg-[#78350f]/50 dark:text-[#fde047]">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <div className="font-bold text-[#451a03] dark:text-[#fef08a]">All Available Routes Have Obstacles</div>
                      <div className="text-[11px] text-[#78350f] dark:text-[#fde047] leading-relaxed font-medium">
                        Every path to this location is currently obstructed by hazards or construction zones. Navigation is routing through the path with minimal obstacles.
                      </div>
                    </div>
                  </div>
                )}
                <Button
                  onClick={startLive}
                  variant="gradient"
                  className="mt-3 w-full flex items-center justify-center gap-1.5"
                  disabled={live}
                >
                  <span>{live ? "Navigating live…" : "Start live navigation"}</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Turn-by-Turn Timeline Card */}
              {route.instructions && route.instructions.length > 0 && !live && (
                <div className="card space-y-3 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
                    Turn-by-Turn
                  </div>
                  <div className="relative space-y-4 pl-1 pt-1">
                    {route.instructions.map((inst, idx) => {
                      const isLast = idx === route.instructions.length - 1;
                      const stepNum = idx + 1;
                      return (
                        <div key={idx} className="relative flex items-start gap-3">
                          {!isLast && (
                            <span
                              className="absolute left-[13px] top-[26px] bottom-[-16px] w-[2px] bg-slate-200 dark:bg-slate-700"
                              aria-hidden="true"
                            />
                          )}
                          <div
                            className={cn(
                              "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm transition-all",
                              isLast
                                ? "bg-[rgb(var(--primary))] text-white ring-2 ring-[rgb(var(--primary)/0.3)]"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            )}
                          >
                            {stepNum}
                          </div>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="text-xs font-medium text-[rgb(var(--fg))]">
                              {inst.text}
                            </div>
                            {inst.distance > 0 ? (
                              <div className="mt-0.5 text-[11px] text-[rgb(var(--muted-fg))]">
                                {Math.round(inst.distance)} m
                                {inst.floor ? ` · ${inst.floor}` : inst.building ? ` · ${inst.building}` : " · Outdoor"}
                              </div>
                            ) : (
                              <div className="mt-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">
                                Destination reached
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {live && toSelected && (
                <LiveRoutePanel
                  destinationId={toSelected.id}
                  onPosition={(p) => setLivePos(p)}
                  onArrive={() => toast({ type: "success", title: "Arrived at destination!" })}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Map view area */}
      <div className="relative flex-1 bg-[rgb(var(--card))]/30">


        <CampusMap
          route={route}
          livePosition={livePos?.node}
          progress={livePos?.progress}
          gps={gps}
          fromSelected={fromSelected}
          toSelected={toSelected}
          onNavigateToDest={(dest) => pickToDestination(dest)}
        />

        {/* Turn-by-turn Guidance Banner */}
        {live && (navSession.status === "NAVIGATING" || navSession.status === "OFF_ROUTE" || navSession.status === "REROUTING" || navSession.status === "ARRIVED" || navSession.status === "GPS_SIGNAL_LOST") && (
          <TurnByTurnBar
            currentStep={
              navSession.currentInstruction
                ? {
                    text: navSession.currentInstruction.text,
                    distanceMeters: Math.round(navSession.currentInstruction.distance),
                    icon: navSession.currentInstruction.transition === "arrive" ? "arrive" : "straight",
                    targetNodeId: "",
                  }
                : (route?.instructions[0]
                    ? {
                        text: route.instructions[0].text,
                        distanceMeters: Math.round(route.instructions[0].distance),
                        icon: "straight",
                        targetNodeId: route.nodes[0]?.id ?? "",
                      }
                    : null)
            }
            nextStep={
              navSession.nextInstruction
                ? {
                    text: navSession.nextInstruction.text,
                    distanceMeters: Math.round(navSession.nextInstruction.distance),
                    icon: "straight",
                    targetNodeId: "",
                  }
                : (route?.instructions[1]
                    ? {
                        text: route.instructions[1].text,
                        distanceMeters: Math.round(route.instructions[1].distance),
                        icon: "straight",
                        targetNodeId: route.nodes[1]?.id ?? "",
                      }
                    : null)
            }
            totalDistanceMeters={Math.round(navSession.activeRoute?.distance ?? route?.distance ?? 0)}
            remainingDistanceMeters={navSession.distanceRemaining}
            currentStepIndex={navSession.currentSegmentIndex}
            totalStepsCount={navSession.activeRoute?.instructions.length ?? route?.instructions?.length ?? 1}
            isOffRoute={navSession.status === "OFF_ROUTE" || navSession.status === "REROUTING"}
            onEndNavigation={() => {
              setLive(false);
              navSession.cancelNavigationSession();
            }}
            onRecalculate={() => {
              if (fromSelected && toSelected) calculateRoute(fromSelected, toSelected);
            }}
            onNextStep={() => {
              navSession.advanceToNextStep();
            }}
            onPrevStep={() => {
              navSession.advanceToPrevStep();
            }}
          />
        )}
      </div>

      {/* Fixed Bottom Mobile Navigation Bar (Mobile Screens Only) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-[rgb(var(--card))]/95 p-1.5 backdrop-blur-md md:hidden shadow-lg">
        <button
          onClick={() => setMobileView("panel")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer",
            mobileView === "panel"
              ? "bg-[rgb(var(--primary))] text-white shadow-xs"
              : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
          )}
        >
          <Navigation2 className="h-3.5 w-3.5" />
          <span>Route Planner</span>
        </button>
        <button
          onClick={() => setMobileView("map")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer",
            mobileView === "map"
              ? "bg-[rgb(var(--primary))] text-white shadow-xs"
              : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
          )}
        >
          <MapPin className="h-3.5 w-3.5" />
          <span>Map Focus</span>
          {route && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </button>
      </div>

      {/* Indoor Floor Selection Modal (Feature 1) */}
      <AnimatePresence>
        {showFloorModal && detectedBuilding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-sm rounded-2xl border bg-[rgb(var(--card))] p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] shrink-0">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[rgb(var(--primary))]">
                      Indoor Floor Detection
                    </div>
                    <h2 className="text-sm font-bold text-[rgb(var(--fg))]">
                      You're inside {detectedBuilding.name}
                    </h2>
                  </div>
                </div>
                <button
                  onClick={() => setShowFloorModal(false)}
                  className="rounded-lg p-1.5 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))] transition-colors cursor-pointer"
                  aria-label="Close Floor Selection"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs text-[rgb(var(--muted-fg))] leading-relaxed">
                Which floor are you currently on?
              </p>

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {publishedData.floors
                  .filter((f) => f.buildingId === detectedBuilding.id)
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((f) => {
                    const isSelected = selectedFloorId === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => handleSelectFloor(f.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all text-xs font-semibold cursor-pointer",
                          isSelected
                            ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--primary))] ring-1 ring-[rgb(var(--primary))]"
                            : "border-[rgb(var(--border))] hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <Layers className="h-4 w-4 shrink-0 text-[rgb(var(--muted-fg))]" />
                          <span>{f.name}</span>
                        </div>
                        {isSelected ? (
                          <div className="flex items-center gap-1 text-[11px] text-[rgb(var(--primary))] font-bold">
                            <Check className="h-3.5 w-3.5" />
                            <span>Selected</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[rgb(var(--muted-fg))]">{f.code || `L${f.ordinal}`}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-[rgb(var(--bg))] p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-[rgb(var(--muted-fg))]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function PopularList({
  onPick,
  allDestinations,
  mounted,
}: {
  onPick: (d: Destination) => void;
  allDestinations: Destination[];
  mounted?: boolean;
}) {
  const items = useMemo(() => allDestinations.slice(0, 6), [allDestinations]);

  if (mounted !== undefined && !mounted) return null;
  if (items.length === 0) return null;

  return (
    <div suppressHydrationWarning>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted-fg))]">
        Popular destinations
      </div>
      <div className="space-y-2">
        {items.map((d) => (
          <button
            key={d.id}
            suppressHydrationWarning
            onClick={() => onPick(d)}
            className="group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--muted))] hover:shadow-[var(--shadow-sm)]"
          >
            <div className="rounded-lg bg-[rgb(var(--primary)/0.1)] p-2 text-[rgb(var(--primary))]">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.name}</div>
              <div className="text-xs text-[rgb(var(--muted-fg))]">
                {d.category}
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
