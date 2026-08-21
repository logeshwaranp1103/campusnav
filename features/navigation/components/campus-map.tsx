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
import { detectBuildingAtGps } from "@/lib/geo/containment";
import { calculateShortestAngleDelta } from "@/lib/geo/haversine";
import { DestinationDetailsDrawer } from "./destination-details-drawer";
import { isEventActive } from "@/shared/lib/event-utils";
import { useNavigationStore } from "@/features/navigation/navigation-store";

/**
 * Computes roof elevated points for lightweight 3D isometric building extrusion.
 */
function getExtrudedRoofPoints(pts: { x: number; y: number }[], height = 12) {
  const extX = -height * 0.32;
  const extY = -height * 0.82;
  return pts.map((p) => ({ x: p.x + extX, y: p.y + extY }));
}

/**
 * Generates 3D quad wall facets with directional shading between base and elevated roof polygons.
 */
function getWallFacets(basePts: { x: number; y: number }[], roofPts: { x: number; y: number }[]) {
  const n = basePts.length;
  const facets: { path: string; isShaded: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const p1 = basePts[i];
    const p2 = basePts[nextIdx];
    const r1 = roofPts[i];
    const r2 = roofPts[nextIdx];

    const path = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${r2.x} ${r2.y} L ${r1.x} ${r1.y} Z`;
    const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
    const isShaded = angle > -45 && angle < 135;

    facets.push({ path, isShaded });
  }
  return facets;
}

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

  // Active navigation session state
  const navStatus = useNavigationStore((s) => s.status);
  const isNavigating = navStatus === "NAVIGATING" || navStatus === "OFF_ROUTE" || navStatus === "REROUTING";

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
          const containment = detectBuildingAtGps(gps.lat, gps.lng, gps.accuracy || 10, allBuildings);
          if (containment.isInside && containment.building) return containment.building.id;
          const canvasPos = gps.canvasPos || gpsToCanvas(gps.lat, gps.lng);
          const bld = allBuildings.find((b) => isPointInsideBuilding(canvasPos.x, canvasPos.y, b));
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
      const containment = detectBuildingAtGps(gps.lat, gps.lng, gps.accuracy || 10, allBuildings);
      if (containment.isInside && containment.building) {
        return allFloors
          .filter((f) => f.buildingId === containment.building!.id)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((f) => f.id);
      }
      const canvasPos = gps.canvasPos || gpsToCanvas(gps.lat, gps.lng);
      const bld = allBuildings.find((b) => isPointInsideBuilding(canvasPos.x, canvasPos.y, b));
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

  // ── Smooth North-Up / Bearing Reset via Controlled Single RAF ──
  const bearingAnimFrameRef = useRef<number | null>(null);

  const resetBearingToNorth = useCallback(() => {
    if (bearingAnimFrameRef.current !== null) {
      cancelAnimationFrame(bearingAnimFrameRef.current);
      bearingAnimFrameRef.current = null;
    }

    const currentB = bearing;
    if (Math.abs(currentB) < 0.5) {
      setBearing(0);
      return;
    }

    const diff = ((0 - currentB + 540) % 360) - 180;
    const start = performance.now();
    const duration = 280;
    const initial = currentB;

    const animate = (timestamp: number) => {
      const elapsed = timestamp - start;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      const nextB = (initial + diff * ease + 360) % 360;
      setBearing(progress >= 1 ? 0 : nextB);
      if (progress < 1) {
        bearingAnimFrameRef.current = requestAnimationFrame(animate);
      } else {
        bearingAnimFrameRef.current = null;
      }
    };
    bearingAnimFrameRef.current = requestAnimationFrame(animate);
  }, [bearing]);

  useEffect(() => {
    return () => {
      if (bearingAnimFrameRef.current !== null) {
        cancelAnimationFrame(bearingAnimFrameRef.current);
      }
    };
  }, []);

  // ── Smooth North-Up Reset when Navigation Session Ends/Exits ──
  const prevNavigatingRef = useRef(isNavigating);
  useEffect(() => {
    if (prevNavigatingRef.current && !isNavigating) {
      resetBearingToNorth();
    }
    prevNavigatingRef.current = isNavigating;
  }, [isNavigating, resetBearingToNorth]);

  // ── Auto-Resume Follow Mode Timer after Manual Interaction ──
  const autoResumeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleUserPan = useCallback(() => {
    setIsFollowingUser(false);
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current);
    }
    // Auto-resume camera follow after 5s of inactivity if live GPS is active or navigating
    if (isNavigating || gps?.isGpsActive) {
      autoResumeTimerRef.current = setTimeout(() => {
        setIsFollowingUser(true);
      }, 5000);
    }
  }, [isNavigating, gps?.isGpsActive]);

  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current);
      }
    };
  }, []);

  // ── Re-center Location Action (Google-Maps Style) ──
  const handleRecenter = useCallback(() => {
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current);
    }
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
        isNavigating={isNavigating}
        onUserPan={handleUserPan}
        onSelectDestination={(dest) => setSelectedDestForDetails(dest)}
        fromSelected={fromSelected}
        toSelected={toSelected}
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
        {/* 🧭 4-Cardinal Compass Rose & North-Up Button */}
        <button
          onClick={resetBearingToNorth}
          className={cn(
            "relative flex h-12 w-12 items-center justify-center rounded-2xl border bg-[rgb(var(--card))]/95 p-1 shadow-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]",
            Math.abs(bearing) > 2 ? "border-red-500/50 shadow-red-500/25 ring-1 ring-red-500/30" : "border-[rgb(var(--border))]"
          )}
          title={Math.abs(bearing) > 2 ? `Bearing ${Math.round(((bearing % 360) + 360) % 360)}° · Tap to reset North-Up` : "North-Up Active"}
          aria-label={`Compass bearing ${Math.round(bearing)} degrees. Tap to reset North-Up.`}
        >
          {/* Compass Rose SVG Dial */}
          <div
            className="relative h-10 w-10 flex items-center justify-center transition-transform duration-100 ease-out"
            style={{ transform: `rotate(${-bearing}deg)` }}
          >
            <svg viewBox="0 0 40 40" className="h-full w-full select-none pointer-events-none">
              {/* Outer Dial Circle */}
              <circle cx="20" cy="20" r="18" fill="none" stroke="#cbd5e1" strokeWidth="1" opacity="0.6" />

              {/* Cardinal Tick Marks */}
              <line x1="20" y1="3" x2="20" y2="7" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              <line x1="20" y1="33" x2="20" y2="37" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="3" y1="20" x2="7" y2="20" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="33" y1="20" x2="37" y2="20" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />

              {/* 4 Cardinal Letters (N, E, S, W) */}
              <text x="20" y="10" textAnchor="middle" fill="#ef4444" fontSize="6.5" fontWeight="900">N</text>
              <text x="31" y="22" textAnchor="middle" fill="#94a3b8" fontSize="5.5" fontWeight="800">E</text>
              <text x="20" y="32" textAnchor="middle" fill="#94a3b8" fontSize="5.5" fontWeight="800">S</text>
              <text x="9" y="22" textAnchor="middle" fill="#94a3b8" fontSize="5.5" fontWeight="800">W</text>

              {/* Red North Needle */}
              <polygon points="20,10 23,20 17,20" fill="#ef4444" />
              {/* Slate South Needle */}
              <polygon points="20,30 23,20 17,20" fill="#94a3b8" opacity="0.75" />
              {/* Center Pivot Dot */}
              <circle cx="20" cy="20" r="2.5" fill="#ffffff" stroke="#475569" strokeWidth="1.2" />
            </svg>
          </div>

          {/* Active Bearing Badge when rotated */}
          {Math.abs(bearing) > 2 && (
            <span className="absolute -bottom-2 px-1 py-0.2 rounded-md bg-red-600 text-[8px] font-black text-white shadow-xs leading-tight">
              {Math.round(((bearing % 360) + 360) % 360)}°
            </span>
          )}
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
      <div className="absolute right-3.5 bottom-28 md:bottom-28 z-25 pointer-events-auto flex items-center gap-2">
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
            isFollowingUser
              ? "bg-blue-600 text-white border-blue-500 shadow-blue-500/30"
              : "bg-[rgb(var(--card))]/95 text-[rgb(var(--fg))] border-[rgb(var(--border))] hover:bg-[rgb(var(--muted))]"
          }`}
          title="Center on My Location"
          aria-label="Center on My Location"
        >
          <Locate className={`h-5 w-5 stroke-[2.25] ${isFollowingUser ? "animate-pulse" : ""}`} />
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
  isNavigating = false,
  onUserPan,
  onSelectDestination,
  fromSelected,
  toSelected,
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
  isNavigating?: boolean;
  onUserPan?: () => void;
  onSelectDestination?: (dest: Destination) => void;
  fromSelected?: Destination | null;
  toSelected?: Destination | null;
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
  const isInteractingRef = useRef<boolean>(false);
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

  // Single Authoritative RAF loop for smooth marker gliding & continuous camera following using Delta-Time Exponential Smoothing
  const lastTimeRef = useRef<number>(0);
  const lastReportedBearingRef = useRef<number>(bearing);

  // ── Unified Master Camera & Marker Animation Controller (Single Authoritative RAF Loop) ──
  useEffect(() => {
    let active = true;
    lastTimeRef.current = performance.now();

    const animateMarkerAndCamera = (timestamp: number) => {
      if (!active) return;

      const now = timestamp || performance.now();
      const dt = Math.min(0.064, Math.max(0.001, (now - (lastTimeRef.current || now)) / 1000));
      lastTimeRef.current = now;

      // 1. Visual GPS Marker Smooth Gliding
      if (targetGpsPos) {
        const cur = visualGpsRef.current;
        const dx = targetGpsPos.x - cur.x;
        const dy = targetGpsPos.y - cur.y;

        // Circular shortest angle interpolation for heading
        const dHeading = (((targetHeading - cur.heading + 540) % 360) - 180);

        // Continuous Delta-Time Exponential Smoothing (60Hz / 90Hz / 120Hz invariant)
        const gpsAlpha = 1 - Math.exp(-10.0 * dt);
        const headingAlpha = 1 - Math.exp(-8.0 * dt);

        if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02 || Math.abs(dHeading) > 0.05) {
          const nextX = cur.x + dx * gpsAlpha;
          const nextY = cur.y + dy * gpsAlpha;
          const nextHeading = (cur.heading + dHeading * headingAlpha + 360) % 360;

          visualGpsRef.current = { x: nextX, y: nextY, heading: nextHeading };
          setVisualGps({
            x: nextX,
            y: nextY,
            heading: nextHeading,
          });
        }
      }

      // 2. Momentum Inertia Panning (when user released gesture)
      if (!isInteractingRef.current && (Math.abs(velocityRef.current.vx) > 0.04 || Math.abs(velocityRef.current.vy) > 0.04)) {
        const friction = Math.pow(0.92, dt / 0.016);
        velocityRef.current.vx *= friction;
        velocityRef.current.vy *= friction;

        if (Math.hypot(velocityRef.current.vx, velocityRef.current.vy) < 0.04) {
          velocityRef.current = { vx: 0, vy: 0 };
        } else {
          const curPan = panRef.current;
          const nextPanX = curPan.x + velocityRef.current.vx;
          const nextPanY = curPan.y + velocityRef.current.vy;
          panRef.current = { x: nextPanX, y: nextPanY };
          setPan({ x: nextPanX, y: nextPanY });
        }
      }

      // 3. Navigation Follow Mode (Glide camera pan & rotate map when user is not manually dragging)
      if (isFollowingUser && !isInteractingRef.current && Math.hypot(velocityRef.current.vx, velocityRef.current.vy) < 0.1) {
        const curMarker = visualGpsRef.current;
        const targetFollowX = targetGpsPos ? targetGpsPos.x : curMarker.x;
        const targetFollowY = targetGpsPos ? targetGpsPos.y : curMarker.y;

        const centerX = boundsRef.current.x + boundsRef.current.w / 2;
        const centerY = boundsRef.current.y + boundsRef.current.h / 2;
        const targetPanX = centerX - targetFollowX;
        const targetPanY = centerY - targetFollowY;

        const curPan = panRef.current;
        const panDx = targetPanX - curPan.x;
        const panDy = targetPanY - curPan.y;

        const panAlpha = 1 - Math.exp(-8.5 * dt);

        if (Math.abs(panDx) > 0.04 || Math.abs(panDy) > 0.04) {
          const nextPanX = curPan.x + panDx * panAlpha;
          const nextPanY = curPan.y + panDy * panAlpha;
          panRef.current = { x: nextPanX, y: nextPanY };
          setPan({
            x: nextPanX,
            y: nextPanY,
          });
        }

        // Automatic Google-Maps-Style Map Auto-Rotation (Aligns map smoothly with heading)
        if (targetHeading >= 0) {
          const isMoving = (gps?.speed !== null && gps?.speed !== undefined && gps.speed > 0.25) || (gps?.heading !== null && gps?.heading !== undefined && gps.heading >= 0) || isNavigating;
          if (isMoving) {
            const targetMapBearing = (360 - targetHeading + 360) % 360;
            const dMapBearing = calculateShortestAngleDelta(bearingRef.current, targetMapBearing);
            // Low-pass noise deadband filter: smooth rotation without compass jitter
            if (Math.abs(dMapBearing) > 0.5) {
              const rotateAlpha = 1 - Math.exp(-8.0 * dt);
              const nextBearing = (bearingRef.current + dMapBearing * rotateAlpha + 360) % 360;
              bearingRef.current = nextBearing;
              if (Math.abs(nextBearing - lastReportedBearingRef.current) > 0.3) {
                lastReportedBearingRef.current = nextBearing;
                onBearingChange?.(nextBearing);
              }
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
  }, [targetGpsPos, targetHeading, isFollowingUser, isNavigating, onBearingChange, gps?.speed, gps?.heading]);

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
      const isFromActive = activeNodes.has(e.fromNodeId ?? e.from);
      const isToActive = activeNodes.has(e.toNodeId ?? e.to);
      if (isFromActive || isToActive) {
        connected.add(e.fromNodeId ?? e.from);
        connected.add(e.toNodeId ?? e.to);
      }
    });
    return connected;
  }, [allNodes, allEdges, floorId]);

  const isNodeOnActiveFloor = useCallback(
    (n: Node) => {
      if (floorId === "f-out") {
        return (
          n.floorId === "f-out" ||
          n.floorId === "outdoor" ||
          n.floorId === undefined ||
          n.type === "BUILDING_ENTRANCE" ||
          n.isEntranceNode ||
          connectedNodeIdsToActiveFloor.has(n.id)
        );
      }
      return (
        n.floorId === floorId ||
        n.type === "BUILDING_ENTRANCE" ||
        n.isEntranceNode ||
        connectedNodeIdsToActiveFloor.has(n.id)
      );
    },
    [floorId, connectedNodeIdsToActiveFloor]
  );

  const scopeNodes = useMemo(() => {
    return allNodes.filter((n) => {
      if (floorId === "f-out") {
        return (
          n.floorId === "f-out" ||
          n.floorId === "outdoor" ||
          n.type === "BUILDING_ENTRANCE" ||
          n.isEntranceNode
        );
      }
      return n.floorId === floorId;
    });
  }, [allNodes, floorId]);

  const scopeEdges = useMemo(() => {
    const nodeSet = new Set(scopeNodes.map((n) => n.id));
    return allEdges.filter((e) => {
      const from = e.fromNodeId ?? e.from;
      const to = e.toNodeId ?? e.to;
      return nodeSet.has(from) && nodeSet.has(to);
    });
  }, [allEdges, scopeNodes]);

  const routeNodes = useMemo(() => {
    return (
      route?.nodes.filter((n) => {
        if (floorId === "f-out") return true;
        return isNodeOnActiveFloor(n);
      }) ?? []
    );
  }, [route?.nodes, isNodeOnActiveFloor, floorId]);

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
    velocityRef.current = { vx: 0, vy: 0 };
  };

  // Mouse Drag Handlers for Desktop with Rotation Matrix Compensation
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    stopInertia();
    isInteractingRef.current = true;
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
    const scaleX = effectiveW / (rect.width || 1);
    const scaleY = effectiveH / (rect.height || 1);
    const now = Date.now();
    const dt = Math.max(1, now - (lastTouchTimeRef.current || now));

    const rawDx = (e.clientX - dragStart.x) * scaleX;
    const rawDy = (e.clientY - dragStart.y) * scaleY;

    // Rotate screen gesture delta by -bearing so dragging on rotated canvas matches hand movement exactly
    const rad = (-bearingRef.current * Math.PI) / 180;
    const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
    const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);

    const rawVx = ((e.clientX - lastTouchPosRef.current.x) * scaleX) / (dt / 16);
    const rawVy = ((e.clientY - lastTouchPosRef.current.y) * scaleY) / (dt / 16);
    const vx = rawVx * Math.cos(rad) - rawVy * Math.sin(rad);
    const vy = rawVx * Math.sin(rad) + rawVy * Math.cos(rad);
    velocityRef.current = { vx, vy };

    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    setDragStart({ x: e.clientX, y: e.clientY });
    lastTouchPosRef.current = { x: e.clientX, y: e.clientY };
    lastTouchTimeRef.current = now;
  };

  const handleMouseUp = () => {
    isInteractingRef.current = false;
    setIsDragging(false);
  };

  // ── Cursor-Anchored Wheel Zoom with Rotation Compensation ──
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

      const rawDPanX = (oldEffW - newEffW) * (0.5 - mouseRatioX);
      const rawDPanY = (oldEffH - newEffH) * (0.5 - mouseRatioY);

      // Rotate focal offset by -bearing
      const rad = (-bearingRef.current * Math.PI) / 180;
      const dPanX = rawDPanX * Math.cos(rad) - rawDPanY * Math.sin(rad);
      const dPanY = rawDPanX * Math.sin(rad) + rawDPanY * Math.cos(rad);

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
      isInteractingRef.current = true;
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

          const rawDPanX = (oldW - newW) * (0.5 - mouseRatioX);
          const rawDPanY = (oldH - newH) * (0.5 - mouseRatioY);
          const rad = (-bearingRef.current * Math.PI) / 180;
          const dPanX = rawDPanX * Math.cos(rad) - rawDPanY * Math.sin(rad);
          const dPanY = rawDPanX * Math.sin(rad) + rawDPanY * Math.cos(rad);

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

        // 3. Two-Finger Pan Midpoint Tracking with Rotation Compensation
        const rawDx = (currentCenter.x - gState.lastCenter.x) * scaleX;
        const rawDy = (currentCenter.y - gState.lastCenter.y) * scaleY;
        const rad = (-bearingRef.current * Math.PI) / 180;
        const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
        const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);
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

        const rawDx = (touch.clientX - gState.lastPos.x) * scaleX;
        const rawDy = (touch.clientY - gState.lastPos.y) * scaleY;
        const rad = (-bearingRef.current * Math.PI) / 180;
        const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
        const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);

        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));

        const rawVx = ((touch.clientX - lastTouchPosRef.current.x) * scaleX) / (dt / 16);
        const rawVy = ((touch.clientY - lastTouchPosRef.current.y) * scaleY) / (dt / 16);
        const vx = rawVx * Math.cos(rad) - rawVy * Math.sin(rad);
        const vy = rawVx * Math.sin(rad) + rawVy * Math.cos(rad);
        velocityRef.current = { vx, vy };

        gState.lastPos = { x: touch.clientX, y: touch.clientY };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = now;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      isInteractingRef.current = false;
      const gState = touchGestureRef.current;
      if (e.touches.length === 0) {
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
      isInteractingRef.current = false;
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

  // ── Canonical Camera Rotation Pivot ──
  // During navigation follow mode, pivot directly around the user's world position (visualGps.x, visualGps.y).
  // This eliminates marker shifting across the screen when the map rotates!
  const rotationPivotX = isFollowingUser && targetGpsPos ? visualGps.x : boundsCenterX - pan.x;
  const rotationPivotY = isFollowingUser && targetGpsPos ? visualGps.y : boundsCenterY - pan.y;

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
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path
            d="M 32 0 L 0 0 0 32"
            fill="none"
            stroke="#e2e8f0"
            strokeOpacity="0.75"
            strokeWidth="0.75"
          />
        </pattern>
        <filter id="bldShadow" x="-20%" y="-20%" width="150%" height="150%">
          <feDropShadow dx="-4" dy="8" stdDeviation="6" floodColor="#0f172a" floodOpacity="0.18" />
        </filter>
        <linearGradient id="bldRoofGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      {/* Background terrain covering all zoom levels */}
      <rect x="-100000" y="-100000" width="200000" height="200000" fill="#f8fafc" />
      <rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#grid)" />

      {/* ── Main Transform Group (Supports Bearing Rotation around User Location / Camera Pivot) ── */}
      <g transform={bearing !== 0 ? `rotate(${bearing} ${rotationPivotX} ${rotationPivotY})` : undefined}>
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

        {/* ── 1. Parking Lots Layer ── */}
        {scopeNodes
          .filter((n) => n.type === "PARKING" || (n.name && n.name.toLowerCase().includes("parking")))
          .map((pn) => (
            <g key={`parking-bay-${pn.id}`} transform={`translate(${pn.x}, ${pn.y})`}>
              {/* Parking Pad Area */}
              <rect
                x="-36"
                y="-24"
                width="72"
                height="48"
                rx="6"
                fill="#1e293b"
                fillOpacity="0.08"
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              {/* Parking Stall Divider Markings */}
              <line x1="-18" y1="-22" x2="-18" y2="22" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <line x1="0" y1="-22" x2="0" y2="22" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <line x1="18" y1="-22" x2="18" y2="22" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              {/* Distinct Parking Badge */}
              <g transform="translate(0, -28)">
                <rect
                  x="-32"
                  y="-9"
                  width="64"
                  height="18"
                  rx="9"
                  fill="#0284c7"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  className="shadow-sm"
                />
                <text
                  x="0"
                  y="3"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="8.5"
                  fontWeight="800"
                  letterSpacing="0.02em"
                >
                  🅿️ Parking
                </text>
              </g>
            </g>
          ))}

        {/* ── 3. Roadway Network (Asphalt Roads with Dual Curbing & Centerline Markings) ── */}
        {scopeEdges
          .filter((e) => e.type === "ROAD" || e.pathType === "EV")
          .map((e) => {
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
              <g key={`road-${e.id}`}>
                {/* Outer Curb Casing */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#ef4444" : "#475569"}
                  strokeWidth={isBlocked ? 14 : 12}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
                {/* Asphalt Core Roadbed */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#fee2e2" : "#1e293b"}
                  strokeWidth={isBlocked ? 9 : 8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Road Lane Centerline Divider */}
                {!isBlocked && (
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="#f8fafc"
                    strokeWidth="1.2"
                    strokeDasharray="4 6"
                    strokeOpacity="0.75"
                    strokeLinecap="round"
                  />
                )}
              </g>
            );
          })}

        {/* ── 4. Pedestrian Walking Paths (Paved Walkways) ── */}
        {scopeEdges
          .filter((e) => e.type !== "ROAD" && e.pathType !== "EV")
          .map((e) => {
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
              <g key={`walk-${e.id}`}>
                {/* Outer Paver Casing */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#ef4444" : "#cbd5e1"}
                  strokeWidth={isBlocked ? 4.5 : 3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.9}
                />
                {/* Paved Stone Core */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#fee2e2" : "#f1f5f9"}
                  strokeWidth={isBlocked ? 2.5 : 2}
                  strokeDasharray={isBlocked ? "4 3" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

        {/* ── 5. Realistic 3D Extruded Buildings Geometry ── */}
        <g>
          {buildings.map((b) => {
            const canvasPts = getBuildingCanvasPoints(b);
            const centerPos = getBuildingCenter(b);
            const bHeight = Math.min(20, Math.max(10, (b.floorsCount || 3) * 3.5));

            const roofPts = getExtrudedRoofPoints(canvasPts, bHeight);
            const baseSvgPath = getPolygonSvgPath(canvasPts);
            const roofSvgPath = getPolygonSvgPath(roofPts);
            const wallFacets = getWallFacets(canvasPts, roofPts);

            const buildingEvents = showEvents ? allEvents.filter((ev) => ev.buildingId === b.id) : [];
            const activeEvent = buildingEvents.find((ev) => isEventActive(ev, nowMs));

            const strokeColor = activeEvent?.color || b.color || "#6366f1";
            const bName = b.name;
            const badgeWidth = Math.max(140, bName.length * 8.5 + 32);

            return (
              <g key={`bld-3d-${b.id}`} pointerEvents="none" className="select-none">
                {/* 1. Soft Ground Drop Shadow Under Base Footprint */}
                <path
                  d={baseSvgPath}
                  fill="#0f172a"
                  fillOpacity="0.12"
                  filter="url(#bldShadow)"
                  stroke="none"
                />

                {/* 2. 3D Architectural Wall Quad Facets with Directional Shading */}
                {wallFacets.map((facet, idx) => (
                  <path
                    key={`facet-${b.id}-${idx}`}
                    d={facet.path}
                    fill={facet.isShaded ? "#94a3b8" : "#cbd5e1"}
                    fillOpacity={facet.isShaded ? 0.95 : 0.85}
                    stroke={strokeColor}
                    strokeWidth="0.75"
                    strokeOpacity="0.4"
                    strokeLinejoin="round"
                  />
                ))}

                {/* 3. Elevated 3D Rooftop Slab */}
                <path
                  d={roofSvgPath}
                  fill="url(#bldRoofGrad)"
                  stroke={strokeColor}
                  strokeWidth={activeEvent ? "2.5" : "1.75"}
                  strokeDasharray={floorId !== "f-out" && !isGroundFloor ? "6 4" : undefined}
                  strokeLinejoin="round"
                  className="transition-all"
                />

                {/* 4. Rooftop Inner Parapet Border Accent */}
                <path
                  d={roofSvgPath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="0.8"
                  strokeOpacity="0.3"
                  strokeDasharray="3 3"
                  strokeLinejoin="round"
                  transform={`translate(${centerPos.x - bHeight * 0.32}, ${centerPos.y - bHeight * 0.82}) scale(0.92) translate(${-(centerPos.x - bHeight * 0.32)}, ${-(centerPos.y - bHeight * 0.82)})`}
                />

                {/* 5. Clean Floating Google-Maps-Style Building Header Badge */}
                <g transform={`translate(${centerPos.x - bHeight * 0.32}, ${centerPos.y - bHeight * 0.82})`}>
                  <rect
                    x={-badgeWidth / 2}
                    y="-15"
                    width={badgeWidth}
                    height="30"
                    rx="15"
                    fill="#ffffff"
                    stroke={strokeColor}
                    strokeWidth="1.75"
                    className="shadow-md"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fill="#1e1b4b"
                    fontSize="13"
                    fontWeight="800"
                    letterSpacing="0.01em"
                  >
                    <tspan fontSize="14">🏢 </tspan>
                    <tspan>{bName}</tspan>
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        {/* ── 6. Campus Gates Layer ── */}
        {scopeNodes
          .filter((n) => n.type === "GATE" || (n.name && n.name.toLowerCase().includes("gate")))
          .map((gn) => {
            const gateName = gn.name || "Campus Gate";
            const gateWidth = Math.max(90, gateName.length * 7 + 28);
            return (
              <g key={`gate-${gn.id}`} transform={`translate(${gn.x}, ${gn.y})`}>
                {/* Gate Security Barrier Indicator */}
                <line x1="-18" y1="0" x2="18" y2="0" stroke="#f59e0b" strokeWidth="3" strokeDasharray="4 2" strokeLinecap="round" />
                {/* Left & Right Security Pillars */}
                <rect x="-22" y="-5" width="6" height="10" rx="2" fill="#d97706" stroke="#ffffff" strokeWidth="1" />
                <rect x="16" y="-5" width="6" height="10" rx="2" fill="#d97706" stroke="#ffffff" strokeWidth="1" />
                {/* Gate Badge */}
                <g transform="translate(0, -18)">
                  <rect
                    x={-gateWidth / 2}
                    y="-10"
                    width={gateWidth}
                    height="20"
                    rx="10"
                    fill="#d97706"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="shadow-md"
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9.5"
                    fontWeight="900"
                    letterSpacing="0.02em"
                  >
                    ⛩️ {gateName}
                  </text>
                </g>
              </g>
            );
          })}

        {/* ── 7. Building Entrances Layer ── */}
        {scopeNodes
          .filter((n) => n.type === "BUILDING_ENTRANCE" || n.isEntranceNode || (n.type === "ENTRANCE" && floorId === "f-out"))
          .map((en) => {
            const entranceName = en.name || "Entrance";
            const badgeW = Math.max(75, entranceName.length * 6 + 22);
            return (
              <g key={`entrance-${en.id}`} transform={`translate(${en.x}, ${en.y})`}>
                {/* Entrance Canopy Pill Badge */}
                <rect
                  x={-badgeW / 2}
                  y="-9"
                  width={badgeW}
                  height="18"
                  rx="9"
                  fill="#059669"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  className="shadow-sm"
                />
                <text
                  x="0"
                  y="3"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="8.5"
                  fontWeight="800"
                >
                  🚪 {entranceName}
                </text>
              </g>
            );
          })}

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

          const isEvEdge = e.pathType === "EV";

          const strokeGlow = isSegmentBlocked
            ? "#ef4444"
            : isEvEdge
            ? "#059669"
            : "#2563eb";

          const strokeCore = isSegmentBlocked
            ? "#ef4444"
            : isEvEdge
            ? "#10b981"
            : "#3b82f6";

          return (
            <g key={`r-group-${e.id}-${i}`}>
              {/* Outer Glow Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={strokeGlow}
                strokeWidth={isSegmentBlocked ? 8 : isEvEdge ? 10 : 8}
                strokeOpacity={isSegmentBlocked ? 0.4 : isEvEdge ? 0.35 : 0.3}
                strokeDasharray={isSegmentBlocked ? "6 4" : (!isEvEdge && route?.travelMode === "MULTIMODAL" ? "5 4" : undefined)}
                strokeLinecap="round"
              />
              {/* Inner Solid High-Contrast Path Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={strokeCore}
                strokeWidth={isSegmentBlocked ? 5 : isEvEdge ? 5.5 : 4}
                strokeDasharray={isSegmentBlocked ? "6 4" : (!isEvEdge && route?.travelMode === "MULTIMODAL" ? "5 4" : undefined)}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Multimodal Transfer Node Badge */}
        {route?.transferNodeId && (() => {
          const transNode = allNodes.find((n) => n.id === route.transferNodeId);
          if (!transNode || (transNode.floorId !== floorId && floorId !== "f-out")) return null;
          return (
            <g transform={`translate(${transNode.x}, ${transNode.y - 18})`}>
              <rect
                x="-52"
                y="-10"
                width="104"
                height="20"
                rx="10"
                fill="#059669"
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
              >
                🅿️ Park & Walk
              </text>
            </g>
          );
        })()}

        {/* Nodes & Named Labels (Render only user-visible nodes on user map) */}
        {scopeNodes
          .filter((n) => n.visibleToUser !== false && !allDestinations.some((d) => d.nodeId === n.id) && n.type !== "GATE" && n.type !== "PARKING" && n.type !== "BUILDING_ENTRANCE")
          .map((n) => {
          const onRoute = routeNodes.some((rn) => rn.id === n.id);
          const isDest = destination?.id === n.id;
          const isStair = n.type === "STAIR" || (n.name && n.name.toLowerCase().includes("stair"));
          const isLift = n.type === "LIFT" || (n.name && n.name.toLowerCase().includes("lift"));
          const isRoom = n.type === "ROOM" || n.type === "LABORATORY" || n.type === "OFFICE" || n.type === "WASHROOM";
          const isStairOrLift = isStair || isLift;

          const nodeColor = isDest
            ? "#10b981"
            : isStairOrLift
            ? "#f59e0b"
            : onRoute
            ? "#2563eb"
            : isRoom
            ? "#8b5cf6"
            : "#64748b";
          const nodeRadius = isDest ? 9 : isStairOrLift ? 7 : isRoom ? 6 : onRoute ? 6.5 : 4.5;

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
                    fill={isDest ? "#065f46" : isStairOrLift ? "#92400e" : onRoute ? "#1e40af" : "#334155"}
                    fontSize="9.5"
                    fontWeight="bold"
                  >
                    {displayName}
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

        {/* Destinations Labels & Markers */}
        {allDestinations.map((d) => {
          const linkedNode = allNodes.find((n) => n.id === d.nodeId);
          if (!linkedNode || (!isNodeOnActiveFloor(linkedNode) && floorId !== "f-out")) return null;
          if (linkedNode.visibleToUser === false) return null;
          const isSelected = toSelected?.id === d.id || toSelected?.nodeId === linkedNode.id;
          const icon = (d.category || "").toLowerCase().includes("lab") ? "🧪" : "🚪";
          const nameStr = `${icon} ${d.name}${d.roomNumber ? ` (#${d.roomNumber})` : ""}`;
          const pillWidth = Math.max(50, nameStr.length * 6.2 + 18);
          return (
            <g
              key={d.id}
              transform={`translate(${linkedNode.x}, ${linkedNode.y})`}
              onClick={() => {
                onUserPan?.();
                const centerX = bounds.x + bounds.w / 2;
                const centerY = bounds.y + bounds.h / 2;
                setPan({ x: centerX - linkedNode.x, y: centerY - linkedNode.y });
                if (onSelectDestination) onSelectDestination(d);
              }}
              className="cursor-pointer select-none transition-transform active:scale-95"
            >
              <rect
                x={-pillWidth / 2}
                y="-10"
                width={pillWidth}
                height="20"
                rx="6"
                fill={isSelected ? "#10b981" : "#ffffff"}
                stroke={isSelected ? "#059669" : "#8b5cf6"}
                strokeWidth={isSelected ? "2" : "1.5"}
                className="shadow-md"
              />
              <text
                x="0"
                y="3.5"
                textAnchor="middle"
                fill={isSelected ? "#ffffff" : "#1e293b"}
                fontSize="10"
                fontWeight="700"
              >
                {nameStr}
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
              fill="rgba(37, 99, 235, 0.18)"
              stroke="#3b82f6"
              strokeWidth={1}
            />
            <circle
              cx={livePosition.x}
              cy={livePosition.y}
              r={5.5}
              fill="#2563eb"
              stroke="#ffffff"
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
