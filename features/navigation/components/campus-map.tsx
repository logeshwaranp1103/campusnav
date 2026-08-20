"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { cn } from "@/shared/lib/utils";
import { campusStore } from "@/shared/lib/campus-store";
import type { Node, Building, Floor, Edge, Destination } from "@/shared/data/campus";
import type { Route } from "@/features/navigation/services/graph";
import { getObstructedEdgeIds } from "@/lib/routing/graph";
import { Building2, Layers, Compass, Locate, AlertTriangle, ZoomIn, ZoomOut, Maximize2, ChevronDown, Navigation } from "lucide-react";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { PIXELS_PER_METER, gpsToCanvas } from "@/lib/geo/projection";
import { getBuildingCanvasPoints, getBuildingCenter, getPolygonSvgPath, isPointInsideBuilding, isPointOutsideAllBuildings } from "@/lib/geo/building-geometry";
import { DestinationDetailsDrawer } from "./destination-details-drawer";
import { isEventActive } from "@/shared/lib/event-utils";

type Props = {
  route: Route | null;
  livePosition?: Node | null;
  progress?: number;
  gps?: ReturnType<typeof useVisitorGps>;
  onNavigateToDest?: (dest: Destination) => void;
  fromSelected?: Destination | null;
  toSelected?: Destination | null;
};

export function CampusMap({ route, livePosition, progress, gps: passedGps, onNavigateToDest, fromSelected, toSelected }: Props) {
  const [mounted, setMounted] = useState(false);
  const [publishedData, setPublishedData] = useState(() => campusStore.getPublishedData());
  const [view, setView] = useState<string>("f-out");
  const [selectedDestForDetails, setSelectedDestForDetails] = useState<Destination | null>(null);
  const [showFloorMenuMobile, setShowFloorMenuMobile] = useState(false);

  // Map Zoom, Bearing & Pan state passed down to MapCanvas
  const [zoomLevel, setZoomLevel] = useState(1);
  const [bearing, setBearing] = useState(0); // 0 = True North Up
  const [resetTrigger, setResetTrigger] = useState(0);
  const [isFollowingUser, setIsFollowingUser] = useState(true);

  // User Layer Toggle for Obstacles
  const [showObstacles, setShowObstacles] = useState(true);

  // Avoid duplicate geolocation watcher by instantiating hook only when passedGps is missing
  const internalGps = useVisitorGps(undefined, { autoStart: !passedGps });
  const gps = passedGps ?? internalGps;

  useEffect(() => {
    setMounted(true);
    let isCancelled = false;
    setPublishedData(campusStore.getPublishedData());

    campusStore.fetchPublishedData().then((freshData) => {
      if (!isCancelled && freshData) {
        setPublishedData(freshData);
      }
    });

    const unsub = campusStore.subscribe(() => {
      if (!isCancelled) {
        setPublishedData(campusStore.getPublishedData());
      }
    });

    return () => {
      isCancelled = true;
      unsub();
    };
  }, []);

  // Auto-switch floor view when live position, real GPS location, or route floor changes
  useEffect(() => {
    if (livePosition?.floorId) {
      setView(livePosition.floorId);
    } else if (gps.isGpsActive && gps.canvasPos?.floorId) {
      setView(gps.canvasPos.floorId);
    } else if (route && route.nodes.length > 0 && route.nodes[0].floorId) {
      setView(route.nodes[0].floorId);
    }
  }, [livePosition?.floorId, gps.isGpsActive, gps.canvasPos?.floorId, route]);

  // Contextual Floor Filter
  const indoorFloors = useMemo(() => {
    const allFloors = publishedData.floors || [];
    const allBuildings = publishedData.buildings || [];
    const allNodes = publishedData.nodes || [];

    const getBuildingIdForNode = (node: Node | null | undefined): string | null => {
      if (!node) return null;
      if (node.floorId && node.floorId !== "f-out" && node.floorId !== "outdoor") {
        const fl = allFloors.find((f) => f.id === node.floorId);
        if (fl?.buildingId) return fl.buildingId;
      }
      const bld = allBuildings.find((b) => isPointInsideBuilding(node.x, node.y, b));
      return bld?.id || null;
    };

    const getBuildingIdForDest = (dest: Destination | null | undefined): string | null => {
      if (!dest) return null;
      if (dest.id === "dest-live-user-location") {
        if (gps.isGpsActive && gps.lat && gps.lng) {
          const bld = allBuildings.find((b) => isPointInsideBuilding(gps.lat, gps.lng, b));
          if (bld) return bld.id;
        }
        if (livePosition) {
          return getBuildingIdForNode(livePosition);
        }
        return null;
      }
      if (dest.buildingId) return dest.buildingId;
      if (dest.floorId && dest.floorId !== "f-out" && dest.floorId !== "outdoor") {
        const fl = allFloors.find((f) => f.id === dest.floorId);
        if (fl?.buildingId) return fl.buildingId;
      }
      if (dest.nodeId) {
        const node = allNodes.find((n) => n.id === dest.nodeId);
        if (node) {
          return getBuildingIdForNode(node);
        }
      }
      return null;
    };

    const targetBuildingIds = new Set<string>();

    if (fromSelected || toSelected || (route && route.nodes.length > 0)) {
      const fromBldId = getBuildingIdForDest(fromSelected);
      const toBldId = getBuildingIdForDest(toSelected);
      if (fromBldId) targetBuildingIds.add(fromBldId);
      if (toBldId) targetBuildingIds.add(toBldId);

      if (route && route.nodes.length > 0) {
        const startNode = route.nodes[0];
        const endNode = route.nodes[route.nodes.length - 1];
        [startNode, endNode].forEach((n) => {
          const bId = getBuildingIdForNode(n);
          if (bId) targetBuildingIds.add(bId);
        });
      }

      if (targetBuildingIds.size > 0) {
        return allFloors
          .filter((f) => targetBuildingIds.has(f.buildingId))
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((f) => f.id);
      }
      return [];
    }

    if (gps.isGpsActive && gps.lat && gps.lng) {
      const bld = allBuildings.find((b) => isPointInsideBuilding(gps.lat, gps.lng, b));
      if (bld) {
        return allFloors
          .filter((f) => f.buildingId === bld.id)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((f) => f.id);
      }
    }

    if (livePosition) {
      const bldId = getBuildingIdForNode(livePosition);
      if (bldId) {
        return allFloors
          .filter((f) => f.buildingId === bldId)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((f) => f.id);
      }
    }

    return [];
  }, [publishedData, fromSelected, toSelected, route, livePosition, gps.isGpsActive, gps.lat, gps.lng]);

  const validFloorIds = useMemo(() => {
    const ids = new Set(["f-out", ...indoorFloors]);
    return ids;
  }, [indoorFloors]);

  const activeView = validFloorIds.has(view) ? view : "f-out";

  const activeFloorLabel = useMemo(() => {
    if (activeView === "f-out") return "Outdoor";
    const f = publishedData.floors.find((x) => x.id === activeView);
    const b = f ? publishedData.buildings.find((x) => x.id === f.buildingId) : undefined;
    return `${b?.name ? `${b.name} · ` : ""}${f?.name ?? "Floor"}`;
  }, [activeView, publishedData.floors, publishedData.buildings]);

  const allBuildings = publishedData.buildings;
  const allFloors = publishedData.floors;

  // ── Smooth North-Up / Bearing Reset ──
  const resetBearingToNorth = useCallback(() => {
    setBearing((currentB) => {
      if (Math.abs(currentB) < 0.5) return 0;
      let diff = ((0 - currentB + 540) % 360) - 180;
      const start = Date.now();
      const duration = 280;
      const initial = currentB;

      const animate = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(1, elapsed / duration);
        const ease = 1 - Math.pow(1 - progress, 3);
        const nextB = (initial + diff * ease + 360) % 360;
        setBearing(progress >= 1 ? 0 : nextB);
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
      return currentB;
    });
  }, []);

  // ── Re-center Location Action ──
  const handleRecenter = useCallback(() => {
    if (gps && !gps.isTracking) {
      gps.startTracking();
    }
    setIsFollowingUser(true);
    setResetTrigger((t) => t + 1);
  }, [gps]);

  if (!mounted) {
    return (
      <div className="relative h-full w-full select-none overflow-hidden touch-none bg-[#f8fafc] flex items-center justify-center" suppressHydrationWarning>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <span>Loading map…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden touch-none" suppressHydrationWarning>
      <MapCanvas
        floorId={activeView === "f-out" ? "f-out" : activeView}
        route={route}
        livePosition={livePosition}
        progress={progress}
        publishedData={publishedData}
        gps={gps}
        bearing={bearing}
        onBearingChange={setBearing}
        showObstacles={showObstacles}
        externalZoom={zoomLevel}
        resetTrigger={resetTrigger}
        isFollowingUser={isFollowingUser}
        onUserPan={() => setIsFollowingUser(false)}
        onSelectDestination={(dest) => setSelectedDestForDetails(dest)}
        fromSelected={fromSelected}
      />

      {/* ── Top-Right Floor Selection Controls ── */}
      <div className="absolute right-3 top-3 z-20 pointer-events-auto flex flex-col items-end gap-1.5">
        {/* Mobile Floor Toggle Button */}
        <button
          onClick={() => setShowFloorMenuMobile((prev) => !prev)}
          className="flex h-11 min-w-11 items-center justify-center gap-1.5 px-3 rounded-2xl border bg-[rgb(var(--card))]/95 text-xs font-semibold shadow-lg backdrop-blur-md text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all cursor-pointer border-[rgb(var(--border))] md:hidden"
          title={`Select Floor Level (${activeFloorLabel})`}
          aria-label={`Select Floor (${activeFloorLabel})`}
        >
          <Layers className="h-4.5 w-4.5 text-[rgb(var(--primary))] shrink-0" />
          <span className="max-w-[110px] truncate text-xs font-bold">{activeFloorLabel}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-[rgb(var(--muted-fg))] transition-transform duration-200", showFloorMenuMobile && "rotate-180")} />
        </button>

        {/* Floor List (Always visible on desktop md:flex, expandable on mobile) */}
        <div
          className={cn(
            "flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/95 p-1.5 shadow-lg backdrop-blur-md w-fit max-h-60 overflow-y-auto transition-all",
            showFloorMenuMobile ? "flex" : "hidden md:flex"
          )}
        >
          <FloorButton
            active={activeView === "f-out"}
            onClick={() => {
              setView("f-out");
              setShowFloorMenuMobile(false);
            }}
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Outdoor"
          />
          {indoorFloors.map((fid) => {
            const f = allFloors.find((x) => x.id === fid);
            const b = f ? allBuildings.find((x) => x.id === f.buildingId) : undefined;
            return (
              <FloorButton
                key={fid}
                active={activeView === fid}
                onClick={() => {
                  setView(fid);
                  setShowFloorMenuMobile(false);
                }}
                icon={<Layers className="h-3.5 w-3.5" />}
                label={`${b?.shortCode || b?.name || "BLD"} · ${f?.name ?? "Floor"}`}
              />
            );
          })}
        </div>
      </div>

      {/* ── Right-Center Tools Stack (4-Direction Compass Rose, Zoom, Obstacles) ── */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 pointer-events-auto flex flex-col items-end gap-2.5">
        {/* 🧭 4-Direction Compass Rose & North-Up Button */}
        <button
          onClick={resetBearingToNorth}
          className={cn(
            "relative flex h-11 w-11 items-center justify-center rounded-2xl border bg-[rgb(var(--card))]/95 p-1 shadow-lg backdrop-blur-md transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]",
            Math.abs(bearing) > 2 ? "border-red-500/40 shadow-red-500/20" : "border-[rgb(var(--border))]"
          )}
          title={Math.abs(bearing) > 2 ? `Bearing ${Math.round(bearing)}° · Click to reset North-Up` : "North-Up Active"}
          aria-label={`Compass bearing ${Math.round(bearing)} degrees. Click to reset North-Up.`}
        >
          {/* Compass Rose SVG Dial */}
          <div
            className="relative h-9 w-9 flex items-center justify-center transition-transform duration-100 ease-out"
            style={{ transform: `rotate(${-bearing}deg)` }}
          >
            {/* Compass Outer Ring */}
            <svg viewBox="0 0 36 36" className="h-full w-full">
              {/* Cardinal Tick Marks */}
              <line x1="18" y1="2" x2="18" y2="5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              <line x1="18" y1="31" x2="18" y2="34" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="2" y1="18" x2="5" y2="18" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="31" y1="18" x2="34" y2="18" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />

              {/* Red North Needle */}
              <polygon points="18,4 22,18 14,18" fill="#ef4444" />
              {/* White/Muted South Needle */}
              <polygon points="18,32 22,18 14,18" fill="#94a3b8" opacity="0.65" />
              {/* Center Pivot Dot */}
              <circle cx="18" cy="18" r="2.5" fill="#ffffff" stroke="#475569" strokeWidth="1" />
            </svg>

            {/* Floating 'N' Label */}
            <span className="absolute -top-1 font-black text-[9px] text-red-500 tracking-tighter select-none">
              N
            </span>
          </div>
        </button>

        {/* Zoom & Fit Controls Stack */}
        <div className="flex flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/90 p-1 shadow-lg backdrop-blur-md w-fit">
          <button
            onClick={() => {
              setZoomLevel((z) => Math.min(4, z * 1.25));
              setIsFollowingUser(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn className="h-5 w-5 stroke-[2.25]" />
          </button>
          <button
            onClick={() => {
              setZoomLevel((z) => Math.max(0.4, z / 1.25));
              setIsFollowingUser(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut className="h-5 w-5 stroke-[2.25]" />
          </button>
          <button
            onClick={() => {
              setZoomLevel(1);
              setResetTrigger((t) => t + 1);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]"
            title="Fit / Reset View"
            aria-label="Reset View"
          >
            <Maximize2 className="h-4.5 w-4.5 stroke-[2.25]" />
          </button>
        </div>

        {/* Hazard Layer Toggle */}
        <div className="flex flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/90 p-1 shadow-lg backdrop-blur-md w-fit">
          <button
            onClick={() => setShowObstacles(!showObstacles)}
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-[11px] font-semibold active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 cursor-pointer ${
              showObstacles
                ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
            }`}
            title="Toggle Hazards & Obstacles"
            aria-label="Toggle Hazards"
          >
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 stroke-[2.25]" />
          </button>
        </div>
      </div>

      {/* ── Bottom-Right Recenter / Follow Location Floating Action Button (FAB) ── */}
      <div className="absolute right-3.5 bottom-20 md:bottom-6 z-25 pointer-events-auto flex items-center gap-2">
        {!isFollowingUser && (gps?.isGpsActive || fromSelected?.id === "dest-live-user-location" || livePosition) && (
          <button
            onClick={handleRecenter}
            className="flex h-11 items-center gap-1.5 rounded-full border border-blue-500/40 bg-[rgb(var(--card))]/95 px-3.5 text-xs font-bold text-blue-600 dark:text-blue-400 shadow-xl backdrop-blur-md hover:bg-blue-500/10 active:scale-95 transition-all cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <Locate className="h-4 w-4 animate-pulse stroke-[2.5]" />
            <span>Re-center</span>
          </button>
        )}

        <button
          onClick={handleRecenter}
          className={`flex h-12 w-12 items-center justify-center rounded-2xl border shadow-xl backdrop-blur-md active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${
            isFollowingUser && gps?.isGpsActive
              ? "bg-blue-600 text-white border-blue-500 shadow-blue-500/30"
              : "bg-[rgb(var(--card))]/95 text-[rgb(var(--fg))] border-[rgb(var(--border))] hover:bg-[rgb(var(--muted))]"
          }`}
          title="Center on My Location"
          aria-label="Center on My Location"
        >
          <Locate className={`h-5 w-5 stroke-[2.25] ${isFollowingUser && gps?.isGpsActive ? "animate-pulse" : ""}`} />
        </button>
      </div>

      {/* Destination Details Drawer */}
      <DestinationDetailsDrawer
        destination={selectedDestForDetails}
        building={allBuildings.find((b) => b.id === allFloors.find((f) => f.id === selectedDestForDetails?.floorId)?.buildingId)}
        floorName={allFloors.find((f) => f.id === selectedDestForDetails?.floorId)?.name}
        onClose={() => setSelectedDestForDetails(null)}
        onNavigate={(dest) => {
          setSelectedDestForDetails(null);
          if (onNavigateToDest) onNavigateToDest(dest);
        }}
      />
    </div>
  );
}

function FloorButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))] min-h-[38px] ${
        active ? "bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))] font-bold shadow-xs" : "hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MapCanvas({
  floorId,
  route,
  livePosition,
  progress,
  publishedData,
  gps,
  bearing = 0,
  onBearingChange,
  showObstacles = true,
  showEvents = true,
  externalZoom = 1,
  resetTrigger = 0,
  isFollowingUser = true,
  onUserPan,
  onSelectDestination,
  fromSelected,
}: {
  floorId: string;
  route: Route | null;
  livePosition?: Node | null;
  progress?: number;
  publishedData: ReturnType<typeof campusStore.getPublishedData>;
  gps?: ReturnType<typeof useVisitorGps>;
  bearing?: number;
  onBearingChange?: (bearing: number) => void;
  showObstacles?: boolean;
  showEvents?: boolean;
  externalZoom?: number;
  resetTrigger?: number;
  isFollowingUser?: boolean;
  onUserPan?: () => void;
  onSelectDestination?: (dest: Destination) => void;
  fromSelected?: Destination | null;
}) {
  const { buildings, nodes: allNodes, edges: allEdges, destinations: allDestinations, events: allEvents } = publishedData;
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Interactive Pan & Zoom State
  const [internalZoom, setInternalZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Camera Smooth Animation Refs
  const panRef = useRef(pan);
  panRef.current = pan;
  const internalZoomRef = useRef(internalZoom);
  internalZoomRef.current = internalZoom;
  const bearingRef = useRef(bearing);
  bearingRef.current = bearing;

  // Velocity tracking & Momentum Inertia Panning
  const velocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const lastTouchTimeRef = useRef<number>(0);
  const lastTouchPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  const currentZoom = externalZoom * internalZoom;
  const currentZoomRef = useRef(currentZoom);
  currentZoomRef.current = currentZoom;

  // ── Smooth Visual GPS Marker State (Interpolated Glide) ──
  const [visualGps, setVisualGps] = useState<{ x: number; y: number; heading: number }>({
    x: 400,
    y: 300,
    heading: 0,
  });
  const visualGpsRef = useRef(visualGps);
  visualGpsRef.current = visualGps;

  // Target GPS position
  const targetGpsPos = useMemo(() => {
    if (gps && gps.isGpsActive && gps.lat && gps.lng) {
      return gpsToCanvas(gps.lat, gps.lng);
    }
    if (gps?.canvasPos && (gps.isGpsActive || gps.isTracking)) {
      return gps.canvasPos;
    }
    if (livePosition) {
      return { x: livePosition.x, y: livePosition.y };
    }
    return null;
  }, [gps?.isGpsActive, gps?.isTracking, gps?.lat, gps?.lng, gps?.canvasPos, livePosition]);

  const targetHeading = gps?.heading ?? 0;

  // Dynamic SVG bounding box calculation
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    buildings.forEach((b) => {
      const bx = b.x ?? 100;
      const by = b.y ?? 100;
      const bw = b.width ?? 180;
      const bh = b.height ?? 120;
      minX = Math.min(minX, bx - 50);
      minY = Math.min(minY, by - 50);
      maxX = Math.max(maxX, bx + bw + 50);
      maxY = Math.max(maxY, by + bh + 50);
    });
    allNodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x - 60);
        minY = Math.min(minY, n.y - 60);
        maxX = Math.max(maxX, n.x + 60);
        maxY = Math.max(maxY, n.y + 60);
      }
    });
    if (!isFinite(minX) || !isFinite(minY)) {
      return { x: 0, y: 0, w: 1000, h: 700 };
    }
    const bX = Math.max(0, Math.floor(minX));
    const bY = Math.max(0, Math.floor(minY));
    return {
      x: bX,
      y: bY,
      w: Math.max(800, Math.ceil(maxX - bX)),
      h: Math.max(600, Math.ceil(maxY - bY)),
    };
  }, [buildings, allNodes]);

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // RAF loop for smooth marker gliding & continuous camera following
  useEffect(() => {
    let active = true;
    const animateMarkerAndCamera = () => {
      if (!active) return;

      if (targetGpsPos) {
        const cur = visualGpsRef.current;
        const dx = targetGpsPos.x - cur.x;
        const dy = targetGpsPos.y - cur.y;

        // Circular shortest angle interpolation for heading
        const dHeading = (((targetHeading - cur.heading + 540) % 360) - 180);

        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05 || Math.abs(dHeading) > 0.1) {
          const nextX = cur.x + dx * 0.18;
          const nextY = cur.y + dy * 0.18;
          const nextHeading = (cur.heading + dHeading * 0.15 + 360) % 360;

          setVisualGps({
            x: nextX,
            y: nextY,
            heading: nextHeading,
          });

          // Smoothly glide camera pan if auto-following
          if (isFollowingUser) {
            const centerX = boundsRef.current.x + boundsRef.current.w / 2;
            const centerY = boundsRef.current.y + boundsRef.current.h / 2;
            const targetPanX = centerX - nextX;
            const targetPanY = centerY - nextY;

            const curPan = panRef.current;
            const panDx = targetPanX - curPan.x;
            const panDy = targetPanY - curPan.y;

            if (Math.abs(panDx) > 0.1 || Math.abs(panDy) > 0.1) {
              setPan({
                x: curPan.x + panDx * 0.12,
                y: curPan.y + panDy * 0.12,
              });
            }
          }
        }
      }

      requestAnimationFrame(animateMarkerAndCamera);
    };

    const handle = requestAnimationFrame(animateMarkerAndCamera);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [targetGpsPos, targetHeading, isFollowingUser]);

  // Recenter / Reset Action Trigger
  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    const hasLiveGps = gps && (gps.isGpsActive || gps.isTracking) && (gps.lat !== 0 || (gps.canvasPos && (gps.canvasPos.x !== 400 || gps.canvasPos.y !== 300)));
    if (hasLiveGps) {
      const targetCanvas = (gps.lat && gps.lng) ? gpsToCanvas(gps.lat, gps.lng) : gps.canvasPos;
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      setPan({ x: centerX - targetCanvas.x, y: centerY - targetCanvas.y });
      setInternalZoom(0.85);
    } else if (livePosition) {
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      setPan({ x: centerX - livePosition.x, y: centerY - livePosition.y });
      setInternalZoom(0.85);
    } else if (fromSelected && fromSelected.nodeId) {
      const startNode = allNodes.find((n) => n.id === fromSelected.nodeId);
      if (startNode) {
        const centerX = bounds.x + bounds.w / 2;
        const centerY = bounds.y + bounds.h / 2;
        setPan({ x: centerX - startNode.x, y: centerY - startNode.y });
        setInternalZoom(0.85);
      }
    } else {
      setInternalZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [floorId, resetTrigger]);

  const nodeLookupMap = useMemo(() => {
    const map = new Map<string, Node>();
    allNodes.forEach((n) => map.set(n.id, n));
    if (route?.nodes) {
      route.nodes.forEach((n) => map.set(n.id, n));
    }
    return map;
  }, [allNodes, route]);

  const findNode = (id: string) => nodeLookupMap.get(id);
  const currentFloorObj = useMemo(
    () => publishedData.floors.find((f) => f.id === floorId),
    [publishedData.floors, floorId]
  );
  const isGroundFloor = floorId === "f-out" || currentFloorObj?.ordinal === 0;

  const connectedNodeIdsToActiveFloor = useMemo(() => {
    const activeNodes = new Set(
      allNodes.filter((n) => n.floorId === floorId).map((n) => n.id)
    );
    const connected = new Set<string>();
    allEdges.forEach((e) => {
      if (activeNodes.has(e.from)) connected.add(e.to);
      if (activeNodes.has(e.to)) connected.add(e.from);
    });
    return connected;
  }, [allNodes, allEdges, floorId]);

  const activeFloorStairGroupIds = useMemo(() => {
    const ids = new Set<string>();
    allNodes.forEach((n) => {
      if (n.floorId === floorId) {
        if (n.stairGroupId) ids.add(n.stairGroupId);
        if (n.liftGroupId) ids.add(n.liftGroupId);
      }
    });
    return ids;
  }, [allNodes, floorId]);

  const isNodeOnActiveFloor = useCallback(
    (n?: Node | null) => {
      if (!n) return false;
      if (n.floorId === floorId) return true;
      if (n.stairGroupId && activeFloorStairGroupIds.has(n.stairGroupId)) return false;
      if (n.liftGroupId && activeFloorStairGroupIds.has(n.liftGroupId)) return false;
      if (n.floorId === "f-out" || n.floorId === "outdoor") return true;
      if (
        n.type === "OUTDOOR" ||
        n.type === "OUTDOOR_PATH" ||
        n.type === "BUILDING_ENTRANCE" ||
        n.type === "ENTRANCE" ||
        n.type === "GATE" ||
        n.type === "ROAD_JUNCTION" ||
        n.isEntranceNode ||
        Boolean(n.outdoorNodeId) ||
        (n.name && /entrance|gate/i.test(n.name)) ||
        isPointOutsideAllBuildings(n.x, n.y, publishedData.buildings)
      ) {
        return true;
      }
      if (connectedNodeIdsToActiveFloor.has(n.id)) return true;
      if (isGroundFloor) {
        const nFloorObj = publishedData.floors.find((f) => f.id === n.floorId);
        return nFloorObj?.ordinal === 0;
      }
      return false;
    },
    [floorId, isGroundFloor, publishedData.floors, publishedData.buildings, connectedNodeIdsToActiveFloor, activeFloorStairGroupIds]
  );

  const scopeNodes = useMemo(() => {
    return allNodes.filter((n) => isNodeOnActiveFloor(n) && (n.visibleToUser === true || Boolean(n.photoUrl)));
  }, [allNodes, isNodeOnActiveFloor]);

  const scopeEdges = useMemo(() => {
    return allEdges.filter((e) => {
      const from = findNode(e.from);
      const to = findNode(e.to);
      if (!from || !to) return false;

      const fromOutdoor = isNodeOnActiveFloor(from);
      const toOutdoor = isNodeOnActiveFloor(to);

      return (
        (from.floorId === floorId && to.floorId === floorId) ||
        (fromOutdoor && toOutdoor)
      );
    });
  }, [allEdges, findNode, isNodeOnActiveFloor, floorId]);

  const routeNodes = useMemo(() => {
    return route?.nodes.filter((n) => isNodeOnActiveFloor(n)) ?? [];
  }, [route?.nodes, isNodeOnActiveFloor]);

  const routeEdges = useMemo(() => {
    return (
      route?.edges.filter((e) => {
        const from = findNode(e.from);
        const to = findNode(e.to);
        if (!from || !to) return false;
        return (
          from.floorId === floorId ||
          to.floorId === floorId ||
          (isNodeOnActiveFloor(from) && isNodeOnActiveFloor(to))
        );
      }) ?? []
    );
  }, [route?.edges, findNode, isNodeOnActiveFloor, floorId]);

  const blockedEdgeIds = useMemo(() => {
    return getObstructedEdgeIds(allNodes, allEdges, publishedData.obstacles);
  }, [allNodes, allEdges, publishedData.obstacles]);

  const destination = route?.nodes[route.nodes.length - 1];
  const showLiveHere = livePosition && isNodeOnActiveFloor(livePosition);

  // Viewbox coordinates with current pan and zoom
  const effectiveW = bounds.w / currentZoom;
  const effectiveH = bounds.h / currentZoom;
  const effectiveX = bounds.x + (bounds.w - effectiveW) / 2 - pan.x;
  const effectiveY = bounds.y + (bounds.h - effectiveH) / 2 - pan.y;
  const viewBoxStr = `${effectiveX} ${effectiveY} ${effectiveW} ${effectiveH}`;

  const stopInertia = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const startInertia = () => {
    stopInertia();
    const step = () => {
      const { vx, vy } = velocityRef.current;
      if (Math.hypot(vx, vy) < 0.05) {
        animFrameRef.current = null;
        return;
      }
      setPan((prev) => ({ x: prev.x + vx, y: prev.y + vy }));
      velocityRef.current.vx *= 0.92;
      velocityRef.current.vy *= 0.92;
      animFrameRef.current = requestAnimationFrame(step);
    };
    animFrameRef.current = requestAnimationFrame(step);
  };

  // Mouse Drag Handlers for Desktop
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    stopInertia();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    lastTouchPosRef.current = { x: e.clientX, y: e.clientY };
    lastTouchTimeRef.current = Date.now();
    velocityRef.current = { vx: 0, vy: 0 };
    onUserPan?.();
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = effectiveW / rect.width;
    const scaleY = effectiveH / rect.height;
    const now = Date.now();
    const dt = Math.max(1, now - (lastTouchTimeRef.current || now));

    const dx = (e.clientX - dragStart.x) * scaleX;
    const dy = (e.clientY - dragStart.y) * scaleY;

    const vx = ((e.clientX - lastTouchPosRef.current.x) * scaleX) / (dt / 16);
    const vy = ((e.clientY - lastTouchPosRef.current.y) * scaleY) / (dt / 16);
    velocityRef.current = { vx, vy };

    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    setDragStart({ x: e.clientX, y: e.clientY });
    lastTouchPosRef.current = { x: e.clientX, y: e.clientY };
    lastTouchTimeRef.current = now;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (Math.hypot(velocityRef.current.vx, velocityRef.current.vy) > 0.5) {
      startInertia();
    }
  };

  // ── Cursor-Anchored Wheel Zoom ──
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onUserPan?.();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const curInternal = internalZoomRef.current;
      const targetZoom = Math.min(5, Math.max(0.35, curInternal * zoomFactor));
      if (targetZoom === curInternal) return;

      const rect = svg.getBoundingClientRect();
      const mouseRatioX = (e.clientX - rect.left) / rect.width;
      const mouseRatioY = (e.clientY - rect.top) / rect.height;

      const bW = boundsRef.current.w;
      const bH = boundsRef.current.h;
      const extZ = externalZoom || 1;

      const oldEffW = bW / (extZ * curInternal);
      const oldEffH = bH / (extZ * curInternal);
      const newEffW = bW / (extZ * targetZoom);
      const newEffH = bH / (extZ * targetZoom);

      const dPanX = (oldEffW - newEffW) * (0.5 - mouseRatioX);
      const dPanY = (oldEffH - newEffH) * (0.5 - mouseRatioY);

      setPan((prev) => ({ x: prev.x + dPanX, y: prev.y + dPanY }));
      setInternalZoom(targetZoom);
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [externalZoom, onUserPan]);

  // Touch gesture state ref for Mobile (2-Finger Simultaneous Pinch-Zoom + Bearing Rotation + Pan)
  const touchGestureRef = useRef<{
    mode: "NONE" | "PAN" | "PINCH_ROTATE";
    initialDist: number;
    initialAngle: number;
    initialBearing: number;
    initialZoom: number;
    lastPos: { x: number; y: number };
    lastCenter: { x: number; y: number };
  }>({
    mode: "NONE",
    initialDist: 0,
    initialAngle: 0,
    initialBearing: 0,
    initialZoom: 1,
    lastPos: { x: 0, y: 0 },
    lastCenter: { x: 0, y: 0 },
  });

  // ── Native Non-Passive Touch Listeners for Pinch-to-Zoom, Two-Finger Rotation & Pan ──
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const getAngle = (t1: Touch, t2: Touch) =>
      (Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180) / Math.PI;

    const getCenter = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      stopInertia();
      onUserPan?.();
      const now = Date.now();

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        // Double-tap zoom detection (<300ms)
        if (now - lastTapTimeRef.current < 300) {
          e.preventDefault();
          const rect = svg.getBoundingClientRect();
          const mouseRatioX = (touch.clientX - rect.left) / rect.width;
          const mouseRatioY = (touch.clientY - rect.top) / rect.height;
          const curZ = internalZoomRef.current;
          const targetZ = Math.min(5, curZ * 1.5);
          const bW = boundsRef.current.w;
          const bH = boundsRef.current.h;
          const extZ = currentZoomRef.current / (curZ || 1);
          const oldW = bW / (extZ * curZ);
          const oldH = bH / (extZ * curZ);
          const newW = bW / (extZ * targetZ);
          const newH = bH / (extZ * targetZ);
          const dPanX = (oldW - newW) * (0.5 - mouseRatioX);
          const dPanY = (oldH - newH) * (0.5 - mouseRatioY);

          setPan((prev) => ({ x: prev.x + dPanX, y: prev.y + dPanY }));
          setInternalZoom(targetZ);
          lastTapTimeRef.current = 0;
          touchGestureRef.current.mode = "NONE";
          return;
        }
        lastTapTimeRef.current = now;

        touchGestureRef.current = {
          mode: "PAN",
          initialDist: 0,
          initialAngle: 0,
          initialBearing: bearingRef.current,
          initialZoom: internalZoomRef.current,
          lastPos: { x: touch.clientX, y: touch.clientY },
          lastCenter: { x: touch.clientX, y: touch.clientY },
        };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = now;
        velocityRef.current = { vx: 0, vy: 0 };
      } else if (e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = getDistance(t1, t2);
        const angle = getAngle(t1, t2);
        const center = getCenter(t1, t2);

        touchGestureRef.current = {
          mode: "PINCH_ROTATE",
          initialDist: dist || 1,
          initialAngle: angle,
          initialBearing: bearingRef.current,
          initialZoom: internalZoomRef.current,
          lastPos: center,
          lastCenter: center,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!svgRef.current) return;
      const gState = touchGestureRef.current;
      if (gState.mode === "NONE") return;

      const rect = svgRef.current.getBoundingClientRect();
      const bW = boundsRef.current.w;
      const bH = boundsRef.current.h;
      const cZoom = currentZoomRef.current;
      const effW = bW / (cZoom || 1);
      const effH = bH / (cZoom || 1);
      const scaleX = effW / (rect.width || 1);
      const scaleY = effH / (rect.height || 1);
      const now = Date.now();
      const dt = Math.max(1, now - (lastTouchTimeRef.current || now));

      if (e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = getDistance(t1, t2);
        const currentAngle = getAngle(t1, t2);
        const currentCenter = getCenter(t1, t2);

        if (gState.mode !== "PINCH_ROTATE" || !gState.initialDist) {
          touchGestureRef.current = {
            mode: "PINCH_ROTATE",
            initialDist: currentDist || 1,
            initialAngle: currentAngle,
            initialBearing: bearingRef.current,
            initialZoom: internalZoomRef.current,
            lastPos: currentCenter,
            lastCenter: currentCenter,
          };
          return;
        }

        // 1. Pinch Zoom Scaling
        const ratio = currentDist / gState.initialDist;
        const targetZoom = Math.min(5, Math.max(0.35, gState.initialZoom * ratio));
        setInternalZoom(targetZoom);

        // 2. Continuous Two-Finger Rotation
        const deltaAngle = currentAngle - gState.initialAngle;
        const newBearing = (gState.initialBearing + deltaAngle + 360) % 360;
        onBearingChange?.(newBearing);

        // 3. Two-Finger Pan Midpoint Tracking
        const dx = (currentCenter.x - gState.lastCenter.x) * scaleX;
        const dy = (currentCenter.y - gState.lastCenter.y) * scaleY;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        gState.lastCenter = currentCenter;
      } else if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        if (gState.mode === "PINCH_ROTATE") {
          touchGestureRef.current = {
            mode: "PAN",
            initialDist: 0,
            initialAngle: 0,
            initialBearing: bearingRef.current,
            initialZoom: internalZoomRef.current,
            lastPos: { x: touch.clientX, y: touch.clientY },
            lastCenter: { x: touch.clientX, y: touch.clientY },
          };
          lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
          lastTouchTimeRef.current = now;
          velocityRef.current = { vx: 0, vy: 0 };
          return;
        }

        const dx = (touch.clientX - gState.lastPos.x) * scaleX;
        const dy = (touch.clientY - gState.lastPos.y) * scaleY;

        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));

        const vx = ((touch.clientX - lastTouchPosRef.current.x) * scaleX) / (dt / 16);
        const vy = ((touch.clientY - lastTouchPosRef.current.y) * scaleY) / (dt / 16);
        velocityRef.current = { vx, vy };

        gState.lastPos = { x: touch.clientX, y: touch.clientY };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = now;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const gState = touchGestureRef.current;
      if (e.touches.length === 0) {
        if (gState.mode === "PAN" && Math.hypot(velocityRef.current.vx, velocityRef.current.vy) > 0.5) {
          startInertia();
        }
        touchGestureRef.current = {
          mode: "NONE",
          initialDist: 0,
          initialAngle: 0,
          initialBearing: 0,
          initialZoom: 1,
          lastPos: { x: 0, y: 0 },
          lastCenter: { x: 0, y: 0 },
        };
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchGestureRef.current = {
          mode: "PAN",
          initialDist: 0,
          initialAngle: 0,
          initialBearing: bearingRef.current,
          initialZoom: internalZoomRef.current,
          lastPos: { x: touch.clientX, y: touch.clientY },
          lastCenter: { x: touch.clientX, y: touch.clientY },
        };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = Date.now();
        velocityRef.current = { vx: 0, vy: 0 };
      }
    };

    const handleTouchCancel = () => {
      touchGestureRef.current = {
        mode: "NONE",
        initialDist: 0,
        initialAngle: 0,
        initialBearing: 0,
        initialZoom: 1,
        lastPos: { x: 0, y: 0 },
        lastCenter: { x: 0, y: 0 },
      };
      velocityRef.current = { vx: 0, vy: 0 };
    };

    svg.addEventListener("touchstart", handleTouchStart, { passive: false });
    svg.addEventListener("touchmove", handleTouchMove, { passive: false });
    svg.addEventListener("touchend", handleTouchEnd, { passive: false });
    svg.addEventListener("touchcancel", handleTouchCancel, { passive: false });

    return () => {
      svg.removeEventListener("touchstart", handleTouchStart);
      svg.removeEventListener("touchmove", handleTouchMove);
      svg.removeEventListener("touchend", handleTouchEnd);
      svg.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [onUserPan, onBearingChange]);

  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const boundsCenterX = bounds.x + bounds.w / 2;
  const boundsCenterY = bounds.y + bounds.h / 2;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBoxStr}
      suppressHydrationWarning
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ willChange: "transform", transform: "translateZ(0)" }}
      className={cn(
        "h-full w-full touch-none select-none transition-cursor bg-[#f8fafc]",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path
            d="M 28 0 L 0 0 0 28"
            fill="none"
            stroke="#cbd5e1"
            strokeOpacity="0.5"
            strokeWidth="0.8"
          />
        </pattern>
        <linearGradient id="bldFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      {/* Background grid covering all zoom levels */}
      <rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#grid)" />

      {/* ── Main Transform Group (Supports Bearing Rotation around Map Center) ── */}
      <g transform={bearing !== 0 ? `rotate(${bearing} ${boundsCenterX} ${boundsCenterY})` : undefined}>
        {buildings.length === 0 && (
          <g transform={`translate(${bounds.w / 2}, ${bounds.h / 2})`}>
            <text
              x="0"
              y="-10"
              textAnchor="middle"
              fill="#64748b"
              fontSize="14"
              fontWeight="600"
            >
              No published map available yet.
            </text>
            <text
              x="0"
              y="15"
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="12"
            >
              Create buildings in Admin panel and click "Publish Map".
            </text>
          </g>
        )}

        {/* Buildings Footprints & Outlines */}
        <g>
          {buildings.map((b) => {
            const canvasPts = getBuildingCanvasPoints(b);
            const svgPath = getPolygonSvgPath(canvasPts);
            const centerPos = getBuildingCenter(b);

            const buildingEvents = showEvents ? allEvents.filter((ev) => ev.buildingId === b.id) : [];
            const activeEvent = buildingEvents.find((ev) => isEventActive(ev, nowMs));

            const strokeColor = activeEvent?.color || b.color || "#4f46e5";
            const bName = b.name;
            const badgeWidth = Math.max(145, bName.length * 9.5 + 32);

            return (
              <g key={b.id}>
                {/* Outer Glow Polygon Outline */}
                <path
                  d={svgPath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="5"
                  strokeOpacity="0.2"
                  strokeLinejoin="round"
                />
                {/* Solid Light-Theme Building Polygon Footprint */}
                <path
                  d={svgPath}
                  fill="url(#bldFillGrad)"
                  stroke={strokeColor}
                  strokeWidth={activeEvent ? "3" : "2.5"}
                  strokeDasharray={floorId !== "f-out" && !isGroundFloor ? "6 4" : undefined}
                  strokeLinejoin="round"
                />
                {/* Inner Architectural Accent Line */}
                <path
                  d={svgPath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="1"
                  strokeOpacity="0.25"
                  strokeDasharray="4 4"
                  strokeLinejoin="round"
                  transform={`translate(${centerPos.x}, ${centerPos.y}) scale(0.92) translate(${-centerPos.x}, ${-centerPos.y})`}
                />

                {/* White Building Header Badge Centered on Centroid */}
                <g transform={`translate(${centerPos.x}, ${centerPos.y})`}>
                  <rect
                    x={-badgeWidth / 2}
                    y="-16"
                    width={badgeWidth}
                    height="32"
                    rx="16"
                    fill="#ffffff"
                    stroke={strokeColor}
                    strokeWidth="2"
                    className="shadow-md"
                  />
                  <text
                    x="0"
                    y="4.5"
                    textAnchor="middle"
                    fill="#1e1b4b"
                    fontSize="14"
                    fontWeight="900"
                    letterSpacing="0.02em"
                  >
                    <tspan fontSize="16">🏢 </tspan>
                    <tspan>{bName}</tspan>
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        {/* Published Obstacles / Hazards Layer */}
        {showObstacles && (
          <g>
            {publishedData.obstacles
              .filter((obs) => {
                const obsFloor = obs.floorId ?? "f-out";
                if (floorId === "f-out") {
                  return obsFloor === "f-out";
                }
                if (obsFloor === floorId) return true;
                const obsFloorObj = publishedData.floors.find((f) => f.id === obsFloor);
                const curFloorObj = publishedData.floors.find((f) => f.id === floorId);
                return Boolean(
                  obsFloorObj &&
                    curFloorObj &&
                  obsFloorObj.ordinal === curFloorObj.ordinal &&
                  obsFloorObj.buildingId === curFloorObj.buildingId
                );
              })
              .map((obs) => {
                const targetNode = obs.nodeId ? allNodes.find((n) => n.id === obs.nodeId) : null;
                const obsX = obs.x ?? targetNode?.x ?? 400;
                const obsY = obs.y ?? targetNode?.y ?? 300;
                const isRouteOnly = Boolean(obs.edgeIds && obs.edgeIds.length > 0);
                const hasRadius = !isRouteOnly && typeof obs.radius === "number" && obs.radius > 0;
                const radius = hasRadius ? obs.radius! : 0;
                const label = obs.reason || "Hazard / Blocked";
                const labelText = isRouteOnly ? `⚠ ${label}` : `⚠ ${label}${hasRadius ? ` (${radius}px)` : ""}`;
                const pillWidth = Math.max(75, labelText.length * 6 + 26);

                return (
                  <g key={`user-obs-${obs.id}`} transform={`translate(${obsX}, ${obsY})`}>
                    {hasRadius && (
                      <circle
                        r={radius}
                        fill="rgba(239, 68, 68, 0.18)"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        className="animate-pulse"
                      />
                    )}
                    <g transform={`translate(0, ${hasRadius ? -radius - 8 : -14})`}>
                      <rect
                        x={-pillWidth / 2}
                        y="-10"
                        width={pillWidth}
                        height="20"
                        rx="6"
                        fill="#ef4444"
                        fillOpacity="0.95"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        className="shadow-md"
                      />
                      <text
                        x="0"
                        y="3"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        {labelText}
                      </text>
                    </g>
                  </g>
                );
              })}
          </g>
        )}

        {/* Base Walkway Edges */}
        {scopeEdges.map((e) => {
          const from = allNodes.find((n) => n.id === e.from);
          const to = allNodes.find((n) => n.id === e.to);
          if (!from || !to) return null;

          const baseId = e.id.replace(/_rev$/, "");
          const isBlocked = showObstacles && (
            blockedEdgeIds.has(e.id) ||
            blockedEdgeIds.has(baseId) ||
            blockedEdgeIds.has(`${baseId}_rev`)
          );

          return (
            <line
              key={e.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={isBlocked ? "#ef4444" : "#64748b"}
              strokeWidth={isBlocked ? 3.5 : 2.5}
              strokeDasharray={isBlocked ? "6 4" : undefined}
              strokeOpacity={0.8}
            />
          );
        })}

        {/* Stable Vibrant Route Highlight Lines */}
        {routeEdges.map((e, i) => {
          const from = findNode(e.from);
          const to = findNode(e.to);
          if (!from || !to) return null;

          const baseId = e.id.replace(/_rev$/, "");
          const isSegmentBlocked =
            blockedEdgeIds.has(e.id) ||
            blockedEdgeIds.has(baseId) ||
            blockedEdgeIds.has(`${baseId}_rev`);

          return (
            <g key={`r-group-${e.id}-${i}`}>
              {/* Outer Glow Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={isSegmentBlocked ? "#ef4444" : "#2563eb"}
                strokeWidth={isSegmentBlocked ? 8 : 9}
                strokeOpacity={isSegmentBlocked ? 0.4 : 0.35}
                strokeDasharray={isSegmentBlocked ? "6 4" : undefined}
                strokeLinecap="round"
              />
              {/* Inner Solid High-Contrast Path Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={isSegmentBlocked ? "#ef4444" : "url(#routeGrad)"}
                strokeWidth={isSegmentBlocked ? 5 : 4.5}
                strokeDasharray={isSegmentBlocked ? "6 4" : undefined}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Nodes & Named Labels */}
        {scopeNodes.map((n) => {
          const onRoute = routeNodes.some((rn) => rn.id === n.id);
          const isDest = destination?.id === n.id;
          const isStair = n.type === "STAIR" || (n.name && n.name.toLowerCase().includes("stair"));
          const isLift = n.type === "LIFT" || (n.name && n.name.toLowerCase().includes("lift"));
          const isStairOrLift = isStair || isLift;

          const nodeColor = isDest
            ? "#10b981"
            : isStairOrLift
            ? "#f59e0b"
            : onRoute
            ? "#2563eb"
            : "#64748b";
          const nodeRadius = isDest ? 9 : isStairOrLift ? 7 : onRoute ? 6.5 : 4.5;

          const rawName = n.name || "";
          const displayName = (n.photoUrl ? "📷 " : "") + (isStair ? `𓊍 ${rawName}` : isLift ? `🛗 ${rawName}` : rawName);
          const labelWidth = Math.max(70, displayName.length * 7 + (isStair ? 20 : n.photoUrl ? 20 : 16));
          const badgeHeight = isStairOrLift ? 22 : 19;

          const labelY = isStairOrLift
            ? n.y - 20
            : n.y + (isDest ? 20 : onRoute ? 17 : 14);

          return (
            <g key={n.id}>
              {isStairOrLift && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={10}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeOpacity="0.4"
                  className="animate-pulse"
                />
              )}

              <circle
                cx={n.x}
                cy={n.y}
                r={nodeRadius}
                fill={nodeColor}
                stroke="#ffffff"
                strokeWidth={isDest ? 2.5 : isStairOrLift ? 2 : onRoute ? 2 : 1.5}
                opacity={onRoute || isDest || isStairOrLift ? 1 : 0.85}
                className={isDest ? "animate-pulse" : undefined}
              />

              {rawName.length > 0 && (
                <g transform={`translate(${n.x}, ${labelY})`}>
                  <rect
                    x={-labelWidth / 2}
                    y={-badgeHeight / 2}
                    width={labelWidth}
                    height={badgeHeight}
                    rx="5"
                    fill="#ffffff"
                    stroke={isDest ? "#10b981" : isStairOrLift ? "#f59e0b" : onRoute ? "#2563eb" : "#94a3b8"}
                    strokeWidth="1.5"
                    className="shadow-md"
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill={isDest ? "#065f46" : isStairOrLift ? "#b45309" : onRoute ? "#1e40af" : "#0f172a"}
                    fontSize={isDest ? 11 : isStairOrLift ? 11 : onRoute ? 10 : 9}
                    fontWeight="700"
                  >
                    {isStair ? (
                      <>
                        <tspan fontSize="25" fontWeight="bold">𓊍 </tspan>
                        <tspan>{rawName}</tspan>
                      </>
                    ) : isLift ? (
                      <>
                        <tspan fontSize="14">🛗 </tspan>
                        <tspan>{rawName}</tspan>
                      </>
                    ) : (
                      displayName
                    )}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Floor Transition Badges for Stair & Lift Nodes on Route */}
        {route &&
          routeNodes.map((n, idx) => {
            if (n.type !== "STAIR" && n.type !== "LIFT") return null;
            const nodeIdx = route.nodes.findIndex((rn) => rn.id === n.id);
            if (nodeIdx === -1) return null;

            const nextDifferentFloorNode = route.nodes.slice(nodeIdx + 1).find((rn) => rn.floorId !== n.floorId);
            if (!nextDifferentFloorNode) return null;

            const targetFloorObj = publishedData.floors.find((f) => f.id === nextDifferentFloorNode.floorId);
            const targetFloorName = targetFloorObj?.name || "Upper Floor";
            const badgeText = `${n.type === "LIFT" ? "Take Lift" : "Take Stairs"} to ${targetFloorName} ↗`;
            const badgeWidth = badgeText.length * 6.5 + 20;

            return (
              <g key={`stair-badge-${n.id}-${idx}`} transform={`translate(${n.x}, ${n.y - 45})`}>
                <rect
                  x={-badgeWidth / 2}
                  y="-12"
                  width={badgeWidth}
                  height="24"
                  rx="7"
                  fill="#0284c7"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="shadow-lg"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="800"
                >
                  {badgeText}
                </text>
              </g>
            );
          })}

        {/* Destinations Labels */}
        {allDestinations.map((d) => {
          const linkedNode = allNodes.find((n) => n.id === d.nodeId);
          if (!linkedNode || (linkedNode.floorId !== floorId && floorId !== "f-out")) return null;
          return (
            <g
              key={d.id}
              transform={`translate(${linkedNode.x + 8}, ${linkedNode.y - 6})`}
              onClick={() => onSelectDestination && onSelectDestination(d)}
              className="cursor-pointer hover:scale-110 transition-transform"
            >
              <text fill="currentColor" className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400">
                ★ {d.name}
              </text>
            </g>
          );
        })}

        {/* ── Smoothed Device GPS Live Marker with Directional Cone & Accuracy Ring ── */}
        {targetGpsPos && (
          <g transform={`translate(${visualGps.x}, ${visualGps.y})`}>
            {/* Accuracy Ring */}
            <circle
              r={Math.max(14, (gps?.accuracy || 8) * PIXELS_PER_METER)}
              fill="rgba(59, 130, 246, 0.15)"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              className="animate-pulse"
            />
            {/* Directional Cone Pointer with Smoothed Heading */}
            <path
              d="M 0 -18 L 8 4 L 0 0 L -8 4 Z"
              fill="#2563eb"
              transform={`rotate(${visualGps.heading || 0})`}
            />
            {/* Pulsing Outer Ring */}
            <circle r="13" fill="rgba(37, 99, 235, 0.25)" className="animate-ping" />
            {/* Solid Blue Core GPS Dot */}
            <circle r="8.5" fill="#2563eb" stroke="#ffffff" strokeWidth="2.5" className="shadow-lg" />
            <circle r="3.5" fill="#ffffff" />

            {/* YOU ARE HERE Badge */}
            <g transform="translate(0, 22)">
              <rect
                x="-44"
                y="-10"
                width="88"
                height="20"
                rx="10"
                fill="#1d4ed8"
                stroke="#ffffff"
                strokeWidth="1.5"
                className="shadow-lg"
              />
              <text
                x="0"
                y="3.5"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9"
                fontWeight="800"
                letterSpacing="0.03em"
              >
                YOU ARE HERE
              </text>
            </g>
          </g>
        )}

        {/* Dynamic Connector Line: Live GPS to Nearest Route Entry Node */}
        {targetGpsPos && fromSelected?.id === "dest-live-user-location" && route && route.nodes.length > 0 && (route.nodes[0].floorId === floorId || floorId === "f-out") && (
          <g pointerEvents="none">
            <line
              x1={visualGps.x}
              y1={visualGps.y}
              x2={route.nodes[0].x}
              y2={route.nodes[0].y}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="4 4"
              strokeOpacity="0.85"
              strokeLinecap="round"
            />
            <circle
              cx={route.nodes[0].x}
              cy={route.nodes[0].y}
              r="3.5"
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          </g>
        )}

        {/* Fallback Live Position marker */}
        {showLiveHere && livePosition && !gps?.isGpsActive && !targetGpsPos && (
          <g>
            <circle
              cx={livePosition.x}
              cy={livePosition.y}
              r={12}
              fill="rgb(var(--success))"
              opacity={0.3}
              className="pulse-dot"
            />
            <circle
              cx={livePosition.x}
              cy={livePosition.y}
              r={5}
              fill="rgb(var(--success))"
              stroke="white"
              strokeWidth={2}
            />
          </g>
        )}

        {progress !== undefined && route && (
          <g>
            <rect x="20" y="20" width="200" height="6" rx="3" fill="rgb(var(--muted))" />
            <rect
              x="20"
              y="20"
              width={200 * progress}
              height="6"
              rx="3"
              fill="rgb(var(--primary))"
              className="transition-all duration-300"
            />
          </g>
        )}
      </g>
    </svg>
  );
}
