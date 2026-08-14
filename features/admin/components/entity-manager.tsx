"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import {
  Building2,
  Layers,
  DoorOpen,
  Waypoints,
  GitFork,
  Footprints,
  AlertTriangle,
  Compass,
  Search,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  ArrowRight,
  Split,
  MapPin,
  Eye,
  Sparkles,
  RefreshCw,
  Sliders,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
  X,
  CheckSquare,
  Square,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Copy,
  ClipboardPaste,
  Check,
  Download,
  Upload,
} from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import { gpsToCanvas, canvasToGps, getCenterFromCorners } from "@/lib/geo/projection";
import { getBuildingCorners, validatePolygonCorners, type BuildingCorner } from "@/lib/geo/building-geometry";
import { calculateHaversineDistance } from "@/lib/geo/haversine";
import { calculateEdgePathSplit } from "@/lib/geo/edge-splitting";
import { Card } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { useToast } from "@/shared/components/ui/toast";
import type {
  Building as BuildingType,
  Node,
  Destination,
  NodeType,
  EdgeType,
  PathType,
} from "@/shared/data/campus";
import { getEdgePathType, getPathTypeLabel } from "@/lib/routing/edge-accessibility";

export type EntityCategory =
  | "BUILDING"
  | "FLOOR"
  | "ROOM"
  | "NODE"
  | "EDGE"
  | "STAIR"
  | "LIFT"
  | "OBSTACLE";

const ENTITY_TYPES: { type: EntityCategory; label: string; icon: any; description: string; badgeColor: string }[] = [
  { type: "BUILDING", label: "Building", icon: Building2, description: "Campus building structure & 4-corner GPS boundary", badgeColor: "from-blue-500 to-indigo-600" },
  { type: "FLOOR", label: "Floor", icon: Layers, description: "Vertical building floor level & ordinal", badgeColor: "from-cyan-500 to-blue-600" },
  { type: "ROOM", label: "Room (Destination)", icon: DoorOpen, description: "Searchable classroom, lab, or office destination", badgeColor: "from-emerald-500 to-teal-600" },
  { type: "NODE", label: "Navigation Node", icon: Waypoints, description: "Path waypoint, junction, or entrance point", badgeColor: "from-violet-500 to-purple-600" },
  { type: "EDGE", label: "Connection Edge", icon: GitFork, description: "Path segment with auto distance & smart splitting", badgeColor: "from-amber-500 to-orange-600" },
  { type: "STAIR", label: "Staircase", icon: Footprints, description: "Multi-floor stair group connecting building floors", badgeColor: "from-pink-500 to-rose-600" },
  { type: "LIFT", label: "Lift / Elevator", icon: RefreshCw, description: "Vertical elevator serving selected building floors", badgeColor: "from-sky-500 to-blue-600" },
  { type: "OBSTACLE", label: "Obstacle / Hazard", icon: AlertTriangle, description: "Temporary hazard blocking routing paths", badgeColor: "from-red-500 to-orange-600" },
];

export function EntityManager() {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [storeData, setStoreData] = useState(() => campusStore.getWorkingData());
  const [selectedType, setSelectedType] = useState<EntityCategory>("BUILDING");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<EntityCategory | "ALL">("ALL");
  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("entity_manager_fullscreen_active") === "true";
    }
    return false;
  });
  const [showMobilePanel, setShowMobilePanel] = useState(false);

  // Directory Row Multi-Selection State for Bulk Actions
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadWholeData = () => {
    const data = campusStore.getWorkingData();
    const exportPayload = {
      appName: "CampusNav Digital Twin System",
      version: "2.0.0",
      exportedAt: new Date().toISOString(),
      exportedTimestamp: Date.now(),
      snapshot: {
        buildings: data.buildings || [],
        floors: data.floors || [],
        nodes: data.nodes || [],
        edges: data.edges || [],
        destinations: data.destinations || [],
        events: data.events || [],
        obstacles: data.obstacles || [],
        stairGroups: data.stairGroups || [],
        liftGroups: data.liftGroups || [],
        doors: data.doors || [],
      },
      meta: {
        totalBuildings: data.buildings?.length || 0,
        totalFloors: data.floors?.length || 0,
        totalNodes: data.nodes?.length || 0,
        totalEdges: data.edges?.length || 0,
        totalDestinations: data.destinations?.length || 0,
        totalObstacles: data.obstacles?.length || 0,
        totalDoors: data.doors?.length || 0,
      },
    };

    const jsonString = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campusnav_whole_data_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      type: "success",
      title: "Whole Data Downloaded!",
      description: `Exported complete dataset (${exportPayload.meta.totalBuildings} blds, ${exportPayload.meta.totalNodes} nodes, ${exportPayload.meta.totalEdges} edges).`,
    });
  };

  const handleTriggerWholeDataInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleWholeDataInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (!content) return;

        const parsed = JSON.parse(content);
        const ok = campusStore.importFullData(parsed);

        if (ok) {
          setStoreData(campusStore.getWorkingData());
          setSelectedRowIds(new Set());
          const snapshot = parsed.snapshot || parsed;
          const bldCount = snapshot.buildings?.length || 0;
          const nodeCount = snapshot.nodes?.length || 0;
          const edgeCount = snapshot.edges?.length || 0;

          toast({
            type: "success",
            title: "Whole Data Feed Successful!",
            description: `Imported full campus graph dataset (${bldCount} buildings, ${nodeCount} nodes, ${edgeCount} edges).`,
          });
        } else {
          toast({
            type: "error",
            title: "Data Feed Failed",
            description: "JSON file format is missing required campus snapshot data structure.",
          });
        }
      } catch (err) {
        toast({
          type: "error",
          title: "Invalid JSON File",
          description: err instanceof Error ? err.message : "Failed to parse JSON file.",
        });
      }
    };
    reader.readAsText(file);
  };

  // Copied Entity State for Copy / Paste Workflow
  const [copiedEntityPayload, setCopiedEntityPayload] = useState<{ category: EntityCategory; name: string; [key: string]: any } | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  // Edit Object Modal State
  const [editingItem, setEditingItem] = useState<{ id: string; category: EntityCategory; name: string; raw: any } | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    category: "",
    shortCode: "",
    roomNumber: "",
    nodeType: "CORRIDOR" as NodeType,
    description: "",
    floorsCount: 0,
    ordinal: 0,
    buildingId: "",
    floorId: "",
    selectedFloorIds: [] as string[],
    severity: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    radius: 10,
    lat: "11.",
    lng: "77.",
    corners: [] as Array<{ lat: string; lng: string }>,
    corner1Lat: "11.",
    corner1Lng: "77.",
    corner2Lat: "11.",
    corner2Lng: "77.",
    corner3Lat: "11.",
    corner3Lng: "77.",
    corner4Lat: "11.",
    corner4Lng: "77.",
    firstNodeId: "",
    secondNodeId: "",
    edgeType: "WALK" as EdgeType,
    pathType: "WALK" as PathType,
    distance: 0,
    accessible: true,
    expiresAt: "",
  });

  // Subscribe to live campus store updates
  useEffect(() => {
    const updateStoreState = () => setStoreData({ ...campusStore.getWorkingData() });
    updateStoreState();
    const unsubscribe = campusStore.subscribe(updateStoreState);
    return unsubscribe;
  }, []);

  // Keyboard Shortcuts for Undo (Ctrl+Z) & Redo (Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleUndo = () => {
    if (!campusStore.canUndo()) return;
    const res = campusStore.undo();
    if (res.success) {
      toast({ type: "info", title: "Undo Applied", description: res.description || "Reverted last change." });
    }
  };

  const handleRedo = () => {
    if (!campusStore.canRedo()) return;
    const res = campusStore.redo();
    if (res.success) {
      toast({ type: "info", title: "Redo Applied", description: res.description || "Re-applied change." });
    }
  };

  // Handle Fullscreen Toggle using Browser Native Fullscreen API to hide Chrome browser tabs & top address bar
  const toggleFullscreen = () => {
    const target = containerRef.current || document.documentElement;
    const nextState = !isFullscreen;
    setIsFullscreen(nextState);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("entity_manager_fullscreen_active", String(nextState));
    }

    if (nextState) {
      if (target.requestFullscreen) {
        target.requestFullscreen().catch(() => { });
      } else if ((target as any).webkitRequestFullscreen) {
        (target as any).webkitRequestFullscreen();
      } else if ((target as any).msRequestFullscreen) {
        (target as any).msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/admin/campus-graph/draft");
      if (res.ok) {
        const data = await res.json();
        if (data && data.draft && Array.isArray(data.draft.buildings) && data.draft.buildings.length > 0) {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(
              "campusnav_explicit_draft_v2",
              JSON.stringify({
                name: "Refreshed Server Draft",
                timestamp: Date.now(),
                snapshot: data.draft,
              })
            );
          }
        }
      }
    } catch (e) {
      console.warn("Soft refresh fallback to local store:", e);
    } finally {
      campusStore.loadSavedDraft();
      setStoreData(campusStore.getWorkingData());
      setSelectedRowIds(new Set());
      toast({
        type: "success",
        title: "Entities Refreshed",
        description: "Campus data re-synchronized without exiting Fullscreen view.",
      });
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  // Sync fullscreen state with native browser fullscreenchange events
  useEffect(() => {
    const handleFSChange = () => {
      const isNativeFS = !!document.fullscreenElement;
      if (!isNativeFS && sessionStorage.getItem("entity_manager_fullscreen_active") !== "true") {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFSChange);
    document.addEventListener("webkitfullscreenchange", handleFSChange);
    document.addEventListener("mozfullscreenchange", handleFSChange);
    document.addEventListener("MSFullscreenChange", handleFSChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFSChange);
      document.removeEventListener("webkitfullscreenchange", handleFSChange);
      document.removeEventListener("mozfullscreenchange", handleFSChange);
      document.removeEventListener("MSFullscreenChange", handleFSChange);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // DYNAMIC FORM STATES
  // ---------------------------------------------------------------------------

  const [buildingForm, setBuildingForm] = useState({
    name: "",
    category: "",
    description: "",
    floorsCount: 3,
    corners: [
      { lat: "11.4975", lng: "77.2765" },
      { lat: "11.4975", lng: "77.2780" },
      { lat: "11.4962", lng: "77.2780" },
      { lat: "11.4962", lng: "77.2765" },
    ],
  });

  const handleAddBuildingCorner = () => {
    setBuildingForm((prev) => ({
      ...prev,
      corners: [...prev.corners, { lat: "11.", lng: "77." }],
    }));
  };

  const handleRemoveBuildingCorner = (index: number) => {
    if (buildingForm.corners.length <= 3) return;
    setBuildingForm((prev) => ({
      ...prev,
      corners: prev.corners.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateBuildingCorner = (index: number, field: "lat" | "lng", val: string) => {
    setBuildingForm((prev) => {
      const nextCorners = [...prev.corners];
      nextCorners[index] = { ...nextCorners[index], [field]: val };
      return { ...prev, corners: nextCorners };
    });
  };

  const handleAddEditBuildingCorner = () => {
    setEditForm((prev: any) => ({
      ...prev,
      corners: [...(prev.corners || []), { lat: "11.", lng: "77." }],
    }));
  };

  const handleRemoveEditBuildingCorner = (index: number) => {
    setEditForm((prev: any) => {
      const corners = prev.corners || [];
      if (corners.length <= 3) return prev;
      return {
        ...prev,
        corners: corners.filter((_: any, i: number) => i !== index),
      };
    });
  };

  const handleUpdateEditBuildingCorner = (index: number, field: "lat" | "lng", val: string) => {
    setEditForm((prev: any) => {
      const nextCorners = [...(prev.corners || [])];
      nextCorners[index] = { ...nextCorners[index], [field]: val };
      return { ...prev, corners: nextCorners };
    });
  };

  const [nodeForm, setNodeForm] = useState({
    name: "",
    lat: "11.",
    lng: "77.",
    buildingId: "",
    floorId: "",
    type: "CORRIDOR" as NodeType,
    accessible: true,
    description: "",
  });

  const [roomForm, setRoomForm] = useState({
    name: "",
    roomNumber: "",
    buildingId: "",
    floorId: "",
    category: "Classroom",
    lat: "11.",
    lng: "77.",
    description: "",
  });

  const [stairForm, setStairForm] = useState({
    name: "",
    buildingId: "",
    selectedFloorIds: [] as string[],
    lat: "11.",
    lng: "77.",
  });

  const [liftForm, setLiftForm] = useState({
    name: "",
    buildingId: "",
    selectedFloorIds: [] as string[],
    lat: "11.",
    lng: "77.",
  });

  const [obstacleForm, setObstacleForm] = useState({
    name: "",
    obstacleType: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    lat: "11.",
    lng: "77.",
    radius: 10,
    startTime: "",
    endTime: "",
  });

  const [edgeForm, setEdgeForm] = useState({
    firstNodeId: "",
    secondNodeId: "",
    edgeType: "WALK" as EdgeType,
    pathType: "" as PathType | "",
    toleranceMeters: 5,
  });

  const [floorForm, setFloorForm] = useState({
    buildingId: "",
    name: "",
    ordinal: 1,
  });

  // Sync building floors selection for Stair and Lift forms
  useEffect(() => {
    if (storeData.buildings.length > 0) {
      const defaultBld = storeData.buildings[0].id;
      if (!stairForm.buildingId) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === defaultBld).map((f) => f.id);
        setStairForm((prev) => ({ ...prev, buildingId: defaultBld, selectedFloorIds: bldFloors }));
      }
      if (!liftForm.buildingId) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === defaultBld).map((f) => f.id);
        setLiftForm((prev) => ({ ...prev, buildingId: defaultBld, selectedFloorIds: bldFloors }));
      }
      if (!nodeForm.buildingId) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === defaultBld);
        setNodeForm((prev) => ({ ...prev, buildingId: defaultBld, floorId: bldFloors[0]?.id || "" }));
        setRoomForm((prev) => ({ ...prev, buildingId: defaultBld, floorId: bldFloors[0]?.id || "" }));
        setFloorForm((prev) => ({ ...prev, buildingId: defaultBld }));
      }
    }
  }, [storeData]);

  const handleStairBuildingChange = (bldId: string) => {
    const bldFloors = storeData.floors.filter((f) => f.buildingId === bldId).map((f) => f.id);
    setStairForm((prev) => ({ ...prev, buildingId: bldId, selectedFloorIds: bldFloors }));
  };

  const handleLiftBuildingChange = (bldId: string) => {
    const bldFloors = storeData.floors.filter((f) => f.buildingId === bldId).map((f) => f.id);
    setLiftForm((prev) => ({ ...prev, buildingId: bldId, selectedFloorIds: bldFloors }));
  };

  const entityCounts = useMemo(() => {
    return {
      BUILDING: storeData.buildings.length,
      FLOOR: storeData.floors.length,
      ROOM: storeData.destinations.length,
      NODE: storeData.nodes.length,
      EDGE: storeData.edges.length,
      STAIR: (storeData.stairGroups || []).length,
      LIFT: (storeData.liftGroups || []).length,
      OBSTACLE: (storeData.obstacles || []).length,
    };
  }, [storeData]);

  const edgeSplitInfo = useMemo(() => {
    if (!edgeForm.firstNodeId || !edgeForm.secondNodeId) return null;
    const nodeA = storeData.nodes.find((n) => n.id === edgeForm.firstNodeId);
    const nodeB = storeData.nodes.find((n) => n.id === edgeForm.secondNodeId);
    if (!nodeA || !nodeB || nodeA.id === nodeB.id) return null;

    return calculateEdgePathSplit(nodeA, nodeB, storeData.nodes, edgeForm.edgeType, edgeForm.toleranceMeters);
  }, [edgeForm.firstNodeId, edgeForm.secondNodeId, edgeForm.edgeType, edgeForm.toleranceMeters, storeData.nodes]);

  const buildingFootprintPoints = useMemo(() => {
    const corners = (buildingForm.corners || []).map((c) => ({
      lat: parseFloat(c.lat) || 11.4975,
      lng: parseFloat(c.lng) || 77.2765,
    }));

    const lats = corners.map((c) => c.lat);
    const lngs = corners.map((c) => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const width = Math.max(0.0001, maxLng - minLng);
    const height = Math.max(0.0001, maxLat - minLat);

    const svgPoints = corners
      .map((c) => {
        const x = 30 + ((c.lng - minLng) / width) * 240;
        const y = 30 + ((maxLat - c.lat) / height) * 120;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return { svgPoints, minLat, maxLat, minLng, maxLng };
  }, [buildingForm.corners]);

  // ---------------------------------------------------------------------------
  // CREATE & EDIT ACTIONS
  // ---------------------------------------------------------------------------

  // GPS Coordinate Range Clamping & Validation
  const validateGpsCoordinates = (latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
      toast({
        type: "error",
        title: "Invalid GPS Latitude",
        description: "Latitude must be between -90.0 and 90.0 degrees.",
      });
      return null;
    }
    if (isNaN(lng) || lng < -180.0 || lng > 180.0) {
      toast({
        type: "error",
        title: "Invalid GPS Longitude",
        description: "Longitude must be between -180.0 and 180.0 degrees.",
      });
      return null;
    }
    return { lat, lng };
  };

  const handleResetAllForms = () => {
    const defaultBld = storeData.buildings[0]?.id || "";
    const defaultFloors = storeData.floors.filter((f) => f.buildingId === defaultBld);

    setBuildingForm({
      name: "",
      category: "",
      description: "",
      floorsCount: 3,
      corners: [
        { lat: "11.4975", lng: "77.2765" },
        { lat: "11.4975", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2765" },
      ],
    });
  };

  const handleCreateEntity = () => {
    switch (selectedType) {
      case "BUILDING": {
        if (!buildingForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Building name is required." });
          return;
        }

        const parsedCorners: BuildingCorner[] = (buildingForm.corners || []).map((c) => ({
          lat: parseFloat(c.lat),
          lng: parseFloat(c.lng),
        }));

        const validation = validatePolygonCorners(parsedCorners);
        if (!validation.valid) {
          toast({
            type: "error",
            title: "Invalid Building Footprint",
            description: validation.error || "Building footprint requires at least 3 valid corners.",
          });
          return;
        }

        const bldId = `bld-${Date.now().toString(36)}`;
        const center = getCenterFromCorners(parsedCorners);
        const centerLat = center.lat;
        const centerLng = center.lng;
        const { x, y } = gpsToCanvas(centerLat, centerLng);

        const canvasCorners = parsedCorners.map((c) => gpsToCanvas(c.lat, c.lng));
        const xs = canvasCorners.map((c) => c.x);
        const ys = canvasCorners.map((c) => c.y);
        const calcWidth = Math.max(10, Math.max(...xs) - Math.min(...xs));
        const calcHeight = Math.max(10, Math.max(...ys) - Math.min(...ys));

        const newBuilding: BuildingType = {
          id: bldId,
          campusId: storeData.campus.id,
          name: buildingForm.name.trim(),
          shortCode: buildingForm.category ? buildingForm.category.toUpperCase().slice(0, 4) : "BLD",
          description: buildingForm.description,
          floorsCount: typeof buildingForm.floorsCount === "number" && !isNaN(buildingForm.floorsCount) ? Math.max(0, buildingForm.floorsCount) : 0,
          lat: centerLat,
          lng: centerLng,
          centerLat,
          centerLng,
          x,
          y,
          width: calcWidth,
          height: calcHeight,
          footprint: parsedCorners,
          ...(parsedCorners.length >= 4 ? {
            corner1Lat: parsedCorners[0].lat, corner1Lng: parsedCorners[0].lng,
            corner2Lat: parsedCorners[1].lat, corner2Lng: parsedCorners[1].lng,
            corner3Lat: parsedCorners[2].lat, corner3Lng: parsedCorners[2].lng,
            corner4Lat: parsedCorners[3].lat, corner4Lng: parsedCorners[3].lng,
          } : {}),
        };

        campusStore.addBuilding(newBuilding);
        toast({
          type: "success",
          title: "Building Created & Synced",
          description: `Building "${newBuilding.name}" (${parsedCorners.length}-corner polygon) added to Store & CAD Editor!`,
        });

        setBuildingForm({
          name: "",
          category: "",
          description: "",
          floorsCount: 3,
          corners: [
            { lat: "11.4975", lng: "77.2765" },
            { lat: "11.4975", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2765" },
          ],
        });
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "FLOOR": {
        if (!floorForm.buildingId) {
          toast({ type: "error", title: "Validation Error", description: "Please select a building." });
          return;
        }

        const newFloor = campusStore.addFloor(floorForm.buildingId, floorForm.name, Number(floorForm.ordinal));
        toast({ type: "success", title: "Floor Added & Synced", description: `Floor level "${newFloor.name}" added to Store & CAD Editor! (ID: ${newFloor.id})` });
        setFloorForm((prev) => ({ ...prev, name: "" }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "NODE": {
        if (!nodeForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Node name is required." });
          return;
        }

        const gps = validateGpsCoordinates(nodeForm.lat, nodeForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const { x, y } = gpsToCanvas(lat, lng);

        const newNode: Node = {
          id: `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          type: nodeForm.type,
          name: nodeForm.name.trim(),
          floorId: nodeForm.floorId || "f-out",
          x,
          y,
          lat,
          lng,
          searchable: true,
        };

        campusStore.addNode(newNode);
        toast({ type: "success", title: "Node Created & Synced", description: `Node "${newNode.name}" added to Store & CAD Editor!` });
        setNodeForm((prev) => ({ ...prev, name: "" }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "ROOM": {
        if (!roomForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Room name is required." });
          return;
        }

        const gps = validateGpsCoordinates(roomForm.lat, roomForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const { x, y } = gpsToCanvas(lat, lng);

        const linkedNodeId = `node-room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const roomNode: Node = {
          id: linkedNodeId,
          type: "ROOM",
          name: roomForm.name.trim(),
          floorId: roomForm.floorId || "f-out",
          x,
          y,
          lat,
          lng,
          searchable: true,
        };
        campusStore.addNode(roomNode);

        const newDest: Destination = {
          id: `dest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          nodeId: linkedNodeId,
          name: roomForm.name.trim(),
          category: roomForm.category,
          aliases: [roomForm.roomNumber, roomForm.name].filter(Boolean),
          roomNumber: roomForm.roomNumber,
          floorId: roomForm.floorId,
          x,
          y,
        };
        campusStore.addDestination(newDest);

        toast({ type: "success", title: "Room Destination Created", description: `Room "${newDest.name}" added to Store & CAD Editor!` });
        setRoomForm((prev) => ({ ...prev, name: "", roomNumber: "" }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "STAIR": {
        if (!stairForm.buildingId) {
          toast({ type: "error", title: "Validation Error", description: "Building selection is required." });
          return;
        }
        if (stairForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 connecting floor for the staircase." });
          return;
        }

        const gps = validateGpsCoordinates(stairForm.lat, stairForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const bld = storeData.buildings.find((b) => b.id === stairForm.buildingId);
        const nameStr = stairForm.name.trim() || `Staircase ${bld?.name || ""}`;
        const { x, y } = gpsToCanvas(lat, lng);

        const sg = campusStore.createStairGroup(stairForm.buildingId, nameStr, stairForm.selectedFloorIds, { x, y });
        toast({
          type: "success",
          title: "Staircase Created & Synced",
          description: `Stair group "${sg.name}" connected across ${stairForm.selectedFloorIds.length} floors! Visible in CAD Editor.`,
        });
        setStairForm((prev) => ({ ...prev, name: "", selectedFloorIds: [] }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "LIFT": {
        if (!liftForm.buildingId) {
          toast({ type: "error", title: "Validation Error", description: "Building selection is required." });
          return;
        }
        if (liftForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 served floor for the elevator." });
          return;
        }

        const gps = validateGpsCoordinates(liftForm.lat, liftForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const bld = storeData.buildings.find((b) => b.id === liftForm.buildingId);
        const nameStr = liftForm.name.trim() || `Elevator ${bld?.name || ""}`;
        const { x, y } = gpsToCanvas(lat, lng);

        const lg = campusStore.createLiftGroup(liftForm.buildingId, nameStr, liftForm.selectedFloorIds, { x, y });
        toast({
          type: "success",
          title: "Lift Created & Synced",
          description: `Elevator/Lift "${lg.name}" serving ${liftForm.selectedFloorIds.length} floors created! Visible in CAD Editor.`,
        });
        setLiftForm((prev) => ({ ...prev, name: "", selectedFloorIds: [] }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "OBSTACLE": {
        if (!obstacleForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Obstacle description/reason is required." });
          return;
        }
        const gps = validateGpsCoordinates(obstacleForm.lat, obstacleForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const { x, y } = gpsToCanvas(lat, lng);

        const newObs = {
          id: `obs-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          campusId: storeData.campus.id,
          x,
          y,
          radius: Number(obstacleForm.radius) || 10,
          reason: obstacleForm.name.trim(),
          severity: obstacleForm.obstacleType,
          expiresAt: obstacleForm.endTime || null,
        };
        campusStore.addObstacle(newObs);

        toast({ type: "success", title: "Obstacle Added & Synced", description: `Obstacle hazard recorded and visible in CAD Editor.` });
        setObstacleForm((prev) => ({ ...prev, name: "" }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "EDGE": {
        if (!edgeForm.firstNodeId || !edgeForm.secondNodeId) {
          toast({ type: "error", title: "Validation Error", description: "Please select both first and second nodes." });
          return;
        }
        if (!edgeForm.pathType) {
          toast({ type: "error", title: "Path Type Required", description: "Please select a Path Type (EV Path or Only Walk Path)." });
          return;
        }
        if (!edgeSplitInfo) {
          toast({ type: "error", title: "Validation Error", description: "Select two distinct valid nodes to connect." });
          return;
        }

        const chosenPathType = edgeForm.pathType as PathType;

        if (edgeSplitInfo.hasIntermediates) {
          campusStore.startBatching();
          edgeSplitInfo.edgesToCreate.forEach((edgeItem) => {
            campusStore.addEdge({
              id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              from: edgeItem.fromNode.id,
              to: edgeItem.toNode.id,
              type: edgeItem.type,
              pathType: chosenPathType,
              distance: edgeItem.distance,
              bidirectional: true,
            });
          });
          campusStore.endBatching();

          toast({
            type: "success",
            title: "Smart Path Edge Created",
            description: `Auto-split connection into ${edgeSplitInfo.edgesToCreate.length} segments via ${edgeSplitInfo.intermediates.length} intermediate node(s)!`,
          });
        } else {
          const single = edgeSplitInfo.edgesToCreate[0];
          const res = campusStore.addEdge({
            id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            from: single.fromNode.id,
            to: single.toNode.id,
            type: single.type,
            pathType: chosenPathType,
            distance: single.distance,
            bidirectional: true,
          });

          if (res.success) {
            toast({ type: "success", title: "Edge Connected", description: `Direct ${chosenPathType} edge connected (${single.distance}m)! Visible in CAD Editor.` });
          } else {
            toast({ type: "error", title: "Edge Exists", description: res.error || "Edge connection already exists." });
          }
          setStoreData({ ...campusStore.getWorkingData() });
        }

        setEdgeForm((prev) => ({ ...prev, secondNodeId: "", pathType: "" }));
        break;
      }
    }
    setStoreData({ ...campusStore.getWorkingData() });
  };

  // ---------------------------------------------------------------------------
  // COPY & PASTE & RESET WORKFLOW HANDLERS
  // ---------------------------------------------------------------------------

  const handleResetForm = () => {
    const defaultBld = storeData.buildings[0]?.id || "";
    const defaultFloors = storeData.floors.filter((f) => f.buildingId === defaultBld);

    setBuildingForm({
      name: "",
      category: "",
      description: "",
      floorsCount: 3,
      corners: [
        { lat: "11.4975", lng: "77.2765" },
        { lat: "11.4975", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2765" },
      ],
    });

    setNodeForm({
      name: "",
      lat: "11.",
      lng: "77.",
      buildingId: defaultBld,
      floorId: defaultFloors[0]?.id || "f-out",
      type: "CORRIDOR",
      accessible: true,
      description: "",
    });

    setRoomForm({
      name: "",
      roomNumber: "",
      buildingId: defaultBld,
      floorId: defaultFloors[0]?.id || "",
      category: "Classroom",
      lat: "11.",
      lng: "77.",
      description: "",
    });

    setStairForm({
      name: "",
      buildingId: defaultBld,
      selectedFloorIds: defaultFloors.map((f) => f.id),
      lat: "11.",
      lng: "77.",
    });

    setLiftForm({
      name: "",
      buildingId: defaultBld,
      selectedFloorIds: defaultFloors.map((f) => f.id),
      lat: "11.",
      lng: "77.",
    });

    setObstacleForm({
      name: "",
      obstacleType: "MEDIUM",
      lat: "11.",
      lng: "77.",
      radius: 10,
      startTime: "",
      endTime: "",
    });

    setEdgeForm({
      firstNodeId: "",
      secondNodeId: "",
      edgeType: "WALK",
      pathType: "",
      toleranceMeters: 5,
    });

    setFloorForm({
      buildingId: defaultBld,
      name: "",
      ordinal: 1,
    });

    toast({
      type: "info",
      title: "Form Reset",
      description: "Data entry form fields reset to default values.",
    });
  };

  // Helper to reliably extract or calculate all 4 corner GPS coordinates for a building object
  const extractBuildingCorners = (raw: any) => {
    let c1Lat = raw.corner1Lat;
    let c1Lng = raw.corner1Lng;
    let c2Lat = raw.corner2Lat;
    let c2Lng = raw.corner2Lng;
    let c3Lat = raw.corner3Lat;
    let c3Lng = raw.corner3Lng;
    let c4Lat = raw.corner4Lat;
    let c4Lng = raw.corner4Lng;

    const valid1 = c1Lat !== undefined && c1Lat !== null && c1Lat !== "" && !isNaN(Number(c1Lat));
    const valid2 = c2Lat !== undefined && c2Lat !== null && c2Lat !== "" && !isNaN(Number(c2Lat));
    const valid3 = c3Lat !== undefined && c3Lat !== null && c3Lat !== "" && !isNaN(Number(c3Lat));
    const valid4 = c4Lat !== undefined && c4Lat !== null && c4Lat !== "" && !isNaN(Number(c4Lat));

    if (!valid1 || !valid2 || !valid3 || !valid4) {
      let centerLat = Number(raw.lat ?? raw.centerLat);
      let centerLng = Number(raw.lng ?? raw.centerLng);

      if ((isNaN(centerLat) || isNaN(centerLng) || centerLat === 0) && raw.x !== undefined && raw.y !== undefined) {
        const gps = canvasToGps(raw.x, raw.y);
        centerLat = gps.lat;
        centerLng = gps.lng;
      }

      if (isNaN(centerLat) || centerLat === 0) centerLat = 11.4975;
      if (isNaN(centerLng) || centerLng === 0) centerLng = 77.2765;

      const latOffset = 0.0003;
      const lngOffset = 0.00035;

      c1Lat = Number((centerLat + latOffset).toFixed(9));
      c1Lng = Number((centerLng - lngOffset).toFixed(9));
      c2Lat = Number((centerLat + latOffset).toFixed(9));
      c2Lng = Number((centerLng + lngOffset).toFixed(9));
      c3Lat = Number((centerLat - latOffset).toFixed(9));
      c3Lng = Number((centerLng + lngOffset).toFixed(9));
      c4Lat = Number((centerLat - latOffset).toFixed(9));
      c4Lng = Number((centerLng - lngOffset).toFixed(9));
    }

    return {
      corner1Lat: String(c1Lat),
      corner1Lng: String(c1Lng),
      corner2Lat: String(c2Lat),
      corner2Lng: String(c2Lng),
      corner3Lat: String(c3Lat),
      corner3Lng: String(c3Lng),
      corner4Lat: String(c4Lat),
      corner4Lng: String(c4Lng),
    };
  };

  const handleCopyEntity = (item: { id: string; category: EntityCategory; name: string; raw: any }) => {
    let copyPayload: any = { category: item.category, name: item.name };

    switch (item.category) {
      case "BUILDING": {
        const corners = extractBuildingCorners(item.raw);
        copyPayload = {
          category: "BUILDING",
          name: item.raw.name || "",
          shortCode: item.raw.shortCode || "",
          buildingCategory: item.raw.category || item.raw.categoryType || "",
          description: item.raw.description || "",
          floorsCount: item.raw.floorsCount !== undefined ? item.raw.floorsCount : 0,
          lat: item.raw.lat !== undefined ? item.raw.lat : item.raw.centerLat,
          lng: item.raw.lng !== undefined ? item.raw.lng : item.raw.centerLng,
          corner1Lat: corners.corner1Lat,
          corner1Lng: corners.corner1Lng,
          corner2Lat: corners.corner2Lat,
          corner2Lng: corners.corner2Lng,
          corner3Lat: corners.corner3Lat,
          corner3Lng: corners.corner3Lng,
          corner4Lat: corners.corner4Lat,
          corner4Lng: corners.corner4Lng,
        };
        break;
      }
      case "FLOOR":
        copyPayload = {
          category: "FLOOR",
          name: item.raw.name || "",
          ordinal: item.raw.ordinal !== undefined ? item.raw.ordinal : 1,
          buildingId: item.raw.buildingId || "",
        };
        break;
      case "ROOM":
        copyPayload = {
          category: "ROOM",
          name: item.raw.name || "",
          roomNumber: item.raw.roomNumber || "",
          roomCategory: item.raw.category || "Classroom",
          buildingId: item.raw.buildingId || "",
          floorId: item.raw.floorId || "",
          lat: item.raw.lat !== undefined ? item.raw.lat : (storeData.nodes.find(n => n.id === item.raw.nodeId)?.lat || "11."),
          lng: item.raw.lng !== undefined ? item.raw.lng : (storeData.nodes.find(n => n.id === item.raw.nodeId)?.lng || "77."),
          description: item.raw.description || "",
        };
        break;
      case "NODE":
        copyPayload = {
          category: "NODE",
          name: item.raw.name || "",
          nodeType: item.raw.type || "CORRIDOR",
          buildingId: item.raw.buildingId || "",
          floorId: item.raw.floorId || "",
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
          accessible: item.raw.accessible !== undefined ? item.raw.accessible : true,
          description: item.raw.description || "",
        };
        break;
      case "EDGE":
        copyPayload = {
          category: "EDGE",
          firstNodeId: item.raw.from || "",
          secondNodeId: item.raw.to || "",
          edgeType: item.raw.type || "WALK",
          distance: item.raw.distance || 0,
        };
        break;
      case "STAIR":
        copyPayload = {
          category: "STAIR",
          name: item.raw.name || "",
          buildingId: item.raw.buildingId || "",
          selectedFloorIds: item.raw.connectedFloorIds || [],
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
        };
        break;
      case "LIFT":
        copyPayload = {
          category: "LIFT",
          name: item.raw.name || "",
          buildingId: item.raw.buildingId || "",
          selectedFloorIds: item.raw.servedFloorIds || [],
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
        };
        break;
      case "OBSTACLE":
        copyPayload = {
          category: "OBSTACLE",
          name: item.raw.reason || item.raw.name || "",
          obstacleType: item.raw.severity || "MEDIUM",
          radius: item.raw.radius || 10,
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
        };
        break;
    }

    setCopiedEntityPayload(copyPayload);
    setCopiedRowId(item.id);

    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(JSON.stringify(copyPayload, null, 2)).catch(() => {});
    }

    toast({
      type: "success",
      title: `${item.category} Details Copied`,
      description: `Copied "${item.name}" attributes (including 4 corner GPS coordinates). Use 'Paste Copied Object' in the Data Entry Form.`,
    });

    setTimeout(() => setCopiedRowId(null), 2500);
  };

  const handlePasteEntity = async () => {
    let payload = copiedEntityPayload;

    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().startsWith("{")) {
          const parsed = JSON.parse(text.trim());
          if (parsed && (parsed.category || parsed.corner1Lat || parsed.name)) {
            payload = parsed;
          }
        }
      } catch (e) {
        // Fallback to internal payload
      }
    }

    if (!payload) {
      toast({
        type: "error",
        title: "Nothing to Paste",
        description: "Please click 'Copy' on an object in the Live Object Directory table first.",
      });
      return;
    }

    if (selectedType !== payload.category) {
      setSelectedType(payload.category);
    }

    switch (payload.category) {
      case "BUILDING": {
        const corners = getBuildingCorners(payload).map((c) => ({ lat: String(c.lat), lng: String(c.lng) }));
        setBuildingForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          category: payload.buildingCategory !== undefined ? payload.buildingCategory : (payload.categoryType ?? ""),
          description: payload.description || "",
          floorsCount: payload.floorsCount !== undefined ? payload.floorsCount : 3,
          corners: corners.length >= 3 ? corners : [
            { lat: "11.4975", lng: "77.2765" },
            { lat: "11.4975", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2765" },
          ],
        });
        break;
      }
      case "FLOOR":
        setFloorForm({
          buildingId: payload.buildingId || floorForm.buildingId,
          name: payload.name ? `${payload.name} (Copy)` : "",
          ordinal: payload.ordinal !== undefined ? payload.ordinal : 1,
        });
        break;
      case "ROOM":
        setRoomForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          roomNumber: payload.roomNumber || "",
          buildingId: payload.buildingId || roomForm.buildingId,
          floorId: payload.floorId || roomForm.floorId,
          category: payload.roomCategory || (payload.category !== "ROOM" ? payload.category : "") || "Classroom",
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
          description: payload.description || "",
        });
        break;
      case "NODE":
        setNodeForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
          buildingId: payload.buildingId || nodeForm.buildingId,
          floorId: payload.floorId || nodeForm.floorId,
          type: payload.nodeType || "CORRIDOR",
          accessible: payload.accessible !== undefined ? payload.accessible : true,
          description: payload.description || "",
        });
        break;
      case "EDGE":
        setEdgeForm({
          firstNodeId: payload.firstNodeId || "",
          secondNodeId: payload.secondNodeId || "",
          edgeType: payload.edgeType || "WALK",
          pathType: payload.pathType || "WALK",
          toleranceMeters: 5,
        });
        break;
      case "STAIR":
        setStairForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          buildingId: payload.buildingId || stairForm.buildingId,
          selectedFloorIds: payload.selectedFloorIds || [],
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
        });
        break;
      case "LIFT":
        setLiftForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          buildingId: payload.buildingId || liftForm.buildingId,
          selectedFloorIds: payload.selectedFloorIds || [],
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
        });
        break;
      case "OBSTACLE":
        setObstacleForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          obstacleType: payload.obstacleType || "MEDIUM",
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
          radius: payload.radius || 10,
          startTime: "",
          endTime: "",
        });
        break;
    }

    toast({
      type: "success",
      title: "Data Pasted Successfully",
      description: `Pasted copied ${payload.category} attributes into the ${payload.category} form.`,
    });
  };

  const handleOpenEditModal = (item: { id: string; category: EntityCategory; name: string; raw: any }) => {
    setEditingItem(item);
    const existingCorners = getBuildingCorners(item.raw).map((c) => ({ lat: String(c.lat), lng: String(c.lng) }));
    setEditForm({
      name: item.name,
      category: item.raw.category || item.raw.shortCode || "Classroom",
      shortCode: item.raw.shortCode || "",
      roomNumber: item.raw.roomNumber || "",
      nodeType: item.raw.type || "CORRIDOR",
      description: item.raw.description || item.raw.reason || "",
      floorsCount: item.raw.floorsCount !== undefined ? item.raw.floorsCount : 0,
      ordinal: item.raw.ordinal !== undefined ? item.raw.ordinal : 0,
      buildingId: item.raw.buildingId || "",
      floorId: item.raw.floorId || "",
      selectedFloorIds: item.raw.connectedFloorIds || item.raw.servedFloorIds || [],
      severity: item.raw.severity || "MEDIUM",
      radius: item.raw.radius || 10,
      lat: item.raw.lat !== undefined ? String(item.raw.lat) : item.raw.centerLat !== undefined ? String(item.raw.centerLat) : (item.raw.x !== undefined && item.raw.y !== undefined ? String(canvasToGps(item.raw.x, item.raw.y).lat.toFixed(6)) : "11."),
      lng: item.raw.lng !== undefined ? String(item.raw.lng) : item.raw.centerLng !== undefined ? String(item.raw.centerLng) : (item.raw.x !== undefined && item.raw.y !== undefined ? String(canvasToGps(item.raw.x, item.raw.y).lng.toFixed(6)) : "77."),
      corners: existingCorners,
      corner1Lat: item.raw.corner1Lat !== undefined ? String(item.raw.corner1Lat) : "",
      corner1Lng: item.raw.corner1Lng !== undefined ? String(item.raw.corner1Lng) : "",
      corner2Lat: item.raw.corner2Lat !== undefined ? String(item.raw.corner2Lat) : "",
      corner2Lng: item.raw.corner2Lng !== undefined ? String(item.raw.corner2Lng) : "",
      corner3Lat: item.raw.corner3Lat !== undefined ? String(item.raw.corner3Lat) : "",
      corner3Lng: item.raw.corner3Lng !== undefined ? String(item.raw.corner3Lng) : "",
      corner4Lat: item.raw.corner4Lat !== undefined ? String(item.raw.corner4Lat) : "",
      corner4Lng: item.raw.corner4Lng !== undefined ? String(item.raw.corner4Lng) : "",
      firstNodeId: item.raw.from || "",
      secondNodeId: item.raw.to || "",
      edgeType: item.raw.type || "WALK",
      pathType: getEdgePathType(item.raw),
      distance: item.raw.distance !== undefined ? item.raw.distance : 0,
      accessible: item.raw.accessible !== undefined ? item.raw.accessible : true,
      expiresAt: item.raw.expiresAt || "",
    });
  };

  const handleSaveEditModal = () => {
    if (!editingItem) return;
    const newName = editForm.name.trim();
    if (!newName) {
      toast({ type: "error", title: "Validation Error", description: "Name cannot be empty." });
      return;
    }

    switch (editingItem.category) {
      case "BUILDING": {
        const parsedCorners: BuildingCorner[] = (editForm.corners || []).map((c: any) => ({
          lat: parseFloat(c.lat),
          lng: parseFloat(c.lng),
        }));

        const validation = validatePolygonCorners(parsedCorners);
        if (!validation.valid) {
          toast({
            type: "error",
            title: "Invalid Building Footprint",
            description: validation.error || "Building footprint requires at least 3 valid corners.",
          });
          return;
        }

        const center = getCenterFromCorners(parsedCorners);
        const centerLat = center.lat;
        const centerLng = center.lng;
        const { x, y } = gpsToCanvas(centerLat, centerLng);

        const canvasCorners = parsedCorners.map((c) => gpsToCanvas(c.lat, c.lng));
        const xs = canvasCorners.map((c) => c.x);
        const ys = canvasCorners.map((c) => c.y);
        const calcWidth = Math.max(10, Math.max(...xs) - Math.min(...xs));
        const calcHeight = Math.max(10, Math.max(...ys) - Math.min(...ys));

        campusStore.updateBuilding(editingItem.id, {
          name: newName,
          shortCode: editForm.category ? editForm.category.toUpperCase().slice(0, 4) : editingItem.raw.shortCode,
          description: editForm.description,
          floorsCount: editForm.floorsCount,
          lat: centerLat,
          lng: centerLng,
          centerLat,
          centerLng,
          x,
          y,
          width: calcWidth,
          height: calcHeight,
          footprint: parsedCorners,
          ...(parsedCorners.length >= 4 ? {
            corner1Lat: parsedCorners[0].lat, corner1Lng: parsedCorners[0].lng,
            corner2Lat: parsedCorners[1].lat, corner2Lng: parsedCorners[1].lng,
            corner3Lat: parsedCorners[2].lat, corner3Lng: parsedCorners[2].lng,
            corner4Lat: parsedCorners[3].lat, corner4Lng: parsedCorners[3].lng,
          } : {}),
        });
        break;
      }

      case "FLOOR":
        campusStore.updateFloor(editingItem.id, {
          name: newName,
          ordinal: editForm.ordinal,
          ...(editForm.buildingId ? { buildingId: editForm.buildingId } : {}),
        });
        break;

      case "ROOM": {
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const { x, y } = (!isNaN(latNum) && !isNaN(lngNum))
          ? gpsToCanvas(latNum, lngNum)
          : { x: editingItem.raw.x, y: editingItem.raw.y };

        campusStore.updateDestination(editingItem.id, {
          name: newName,
          roomNumber: editForm.roomNumber,
          category: editForm.category,
          floorId: editForm.floorId || editingItem.raw.floorId,
          x,
          y,
        });

        if (editingItem.raw.nodeId) {
          campusStore.updateNode(editingItem.raw.nodeId, {
            name: newName,
            floorId: editForm.floorId || editingItem.raw.floorId,
            ...(!isNaN(latNum) && !isNaN(lngNum) ? { lat: latNum, lng: lngNum, x, y } : {}),
          });
        }
        break;
      }

      case "NODE": {
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const { x, y } = (!isNaN(latNum) && !isNaN(lngNum))
          ? gpsToCanvas(latNum, lngNum)
          : { x: editingItem.raw.x, y: editingItem.raw.y };

        campusStore.updateNode(editingItem.id, {
          name: newName,
          type: editForm.nodeType,
          floorId: editForm.floorId || editingItem.raw.floorId,
          accessible: editForm.accessible,
          ...(!isNaN(latNum) && !isNaN(lngNum) ? { lat: latNum, lng: lngNum, x, y } : {}),
        });
        break;
      }

      case "EDGE": {
        campusStore.updateEdge(editingItem.id, {
          from: editForm.firstNodeId || editingItem.raw.from,
          to: editForm.secondNodeId || editingItem.raw.to,
          type: editForm.edgeType,
          pathType: editForm.pathType as PathType,
          distance: editForm.distance || editingItem.raw.distance,
        });
        break;
      }

      case "STAIR": {
        if (editForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 connecting floor for the staircase." });
          return;
        }
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const pos = (!isNaN(latNum) && !isNaN(lngNum)) ? gpsToCanvas(latNum, lngNum) : undefined;

        campusStore.updateStairGroup(editingItem.id, {
          name: newName,
          buildingId: editForm.buildingId || editingItem.raw.buildingId,
          connectedFloorIds: editForm.selectedFloorIds,
        }, pos);
        break;
      }

      case "LIFT": {
        if (editForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 served floor for the elevator/lift." });
          return;
        }
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const pos = (!isNaN(latNum) && !isNaN(lngNum)) ? gpsToCanvas(latNum, lngNum) : undefined;

        campusStore.updateLiftGroup(editingItem.id, {
          name: newName,
          buildingId: editForm.buildingId || editingItem.raw.buildingId,
          servedFloorIds: editForm.selectedFloorIds,
        }, pos);
        break;
      }

      case "OBSTACLE": {
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const { x, y } = (!isNaN(latNum) && !isNaN(lngNum))
          ? gpsToCanvas(latNum, lngNum)
          : { x: editingItem.raw.x, y: editingItem.raw.y };

        campusStore.updateObstacle(editingItem.id, {
          reason: newName,
          severity: editForm.severity,
          radius: editForm.radius,
          expiresAt: editForm.expiresAt || null,
          ...(!isNaN(latNum) && !isNaN(lngNum) ? { x, y } : {}),
        });
        break;
      }
    }

    toast({
      type: "success",
      title: "Object Updated",
      description: `Updated ${editingItem.category} "${newName}" with live CAD sync!`,
    });
    setEditingItem(null);
    setStoreData({ ...campusStore.getWorkingData() });
  };

  // ---------------------------------------------------------------------------
  // FILTERED OBJECTS DIRECTORY & BULK DELETION
  // ---------------------------------------------------------------------------

  const filteredEntities = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const items: Array<{
      id: string;
      name: string;
      category: EntityCategory;
      buildingName?: string;
      floorName?: string;
      details: string;
      raw: any;
    }> = [];

    if (activeTab === "ALL" || activeTab === "BUILDING") {
      storeData.buildings.forEach((b) => {
        const matches = !q || b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: b.id,
            name: b.name,
            category: "BUILDING",
            details: `${(b.floorsCount ?? 0) === 0 ? "Ground Floor Only" : `${(b.floorsCount ?? 0) + 1} Floors (${b.floorsCount} Upper)`} · GPS: ${b.lat?.toFixed(9)}, ${b.lng?.toFixed(9)}`,
            raw: b,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "FLOOR") {
      storeData.floors.forEach((f) => {
        const bld = storeData.buildings.find((b) => b.id === f.buildingId);
        const matches = !q || f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (bld && bld.name.toLowerCase().includes(q));
        if (matches) {
          items.push({
            id: f.id,
            name: f.name,
            category: "FLOOR",
            buildingName: bld?.name || "Campus",
            details: `Ordinal: ${f.ordinal} · Building: ${bld?.name || f.buildingId}`,
            raw: f,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "ROOM") {
      storeData.destinations.forEach((d) => {
        const fl = storeData.floors.find((f) => f.id === d.floorId);
        const bld = fl ? storeData.buildings.find((b) => b.id === fl.buildingId) : undefined;
        const matches = !q || d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q) || (d.roomNumber && d.roomNumber.toLowerCase().includes(q)) || (d.category && d.category.toLowerCase().includes(q));
        if (matches) {
          items.push({
            id: d.id,
            name: d.name,
            category: "ROOM",
            buildingName: bld?.name,
            floorName: fl?.name,
            details: `Room ${d.roomNumber || "N/A"} · Category: ${d.category}`,
            raw: d,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "NODE") {
      storeData.nodes.forEach((n) => {
        const fl = storeData.floors.find((f) => f.id === n.floorId);
        const matches = !q || (n.name && n.name.toLowerCase().includes(q)) || n.id.toLowerCase().includes(q) || n.type.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: n.id,
            name: n.name || `Node ${n.id.slice(0, 8)}`,
            category: "NODE",
            floorName: fl?.name || (n.floorId === "f-out" ? "Outdoor" : n.floorId),
            details: `Type: ${n.type} · GPS: ${n.lat?.toFixed(9) || "Canvas"}, ${n.lng?.toFixed(9) || ""}`,
            raw: n,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "EDGE") {
      storeData.edges.forEach((e) => {
        const nFrom = storeData.nodes.find((n) => n.id === e.from);
        const nTo = storeData.nodes.find((n) => n.id === e.to);
        const nameStr = `${nFrom?.name || e.from} ↔ ${nTo?.name || e.to}`;
        const pType = getEdgePathType(e);
        const pInfo = getPathTypeLabel(pType, e.type);
        const matches = !q || nameStr.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || pType.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: e.id,
            name: nameStr,
            category: "EDGE",
            details: `${pInfo.label} (${pInfo.shortLabel}) · Type: ${e.type} · Distance: ${e.distance}m`,
            raw: e,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "STAIR") {
      (storeData.stairGroups || []).forEach((sg) => {
        const bld = storeData.buildings.find((b) => b.id === sg.buildingId);
        const matches = !q || sg.name.toLowerCase().includes(q) || sg.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: sg.id,
            name: sg.name,
            category: "STAIR",
            buildingName: bld?.name,
            details: `Connects ${sg.connectedFloorIds.length} floors in ${bld?.name || "Building"}`,
            raw: sg,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "LIFT") {
      (storeData.liftGroups || []).forEach((lg) => {
        const bld = storeData.buildings.find((b) => b.id === lg.buildingId);
        const matches = !q || lg.name.toLowerCase().includes(q) || lg.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: lg.id,
            name: lg.name,
            category: "LIFT",
            buildingName: bld?.name,
            details: `Serves ${lg.servedFloorIds.length} floors in ${bld?.name || "Building"}`,
            raw: lg,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "OBSTACLE") {
      (storeData.obstacles || []).forEach((obs) => {
        const matches = !q || (obs.reason && obs.reason.toLowerCase().includes(q)) || obs.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: obs.id,
            name: obs.reason || `Obstacle ${obs.id.slice(0, 8)}`,
            category: "OBSTACLE",
            details: `Radius: ${obs.radius}m · Severity: ${obs.severity || "MEDIUM"}`,
            raw: obs,
          });
        }
      });
    }

    return items.reverse();
  }, [storeData, activeTab, searchQuery]);

  // High-Performance Table Pagination & Control
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, pageSize]);

  const totalPages = useMemo(() => {
    if (pageSize === 0 || filteredEntities.length === 0) return 1;
    return Math.ceil(filteredEntities.length / pageSize);
  }, [filteredEntities.length, pageSize]);

  const paginatedEntities = useMemo(() => {
    if (pageSize === 0) return filteredEntities;
    const startIdx = (currentPage - 1) * pageSize;
    return filteredEntities.slice(startIdx, startIdx + pageSize);
  }, [filteredEntities, currentPage, pageSize]);

  const toggleSelectRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRows = () => {
    if (selectedRowIds.size === filteredEntities.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filteredEntities.map((e) => e.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedRowIds.size === 0) return;
    const idsToDelete = Array.from(selectedRowIds);
    campusStore.deleteSelectedEntities(idsToDelete);
    toast({
      type: "success",
      title: "Bulk Deletion Completed",
      description: `Deleted ${idsToDelete.length} campus objects with live CAD sync!`,
    });
    setSelectedRowIds(new Set());
    setStoreData({ ...campusStore.getWorkingData() });
  };

  const handleDeleteEntity = (item: { id: string; category: EntityCategory; name: string }) => {
    switch (item.category) {
      case "BUILDING":
        campusStore.deleteBuilding(item.id);
        break;
      case "FLOOR":
        campusStore.deleteFloor(item.id);
        break;
      case "NODE":
        campusStore.deleteNode(item.id);
        break;
      case "ROOM":
        campusStore.deleteDestination(item.id);
        break;
      case "EDGE":
        campusStore.deleteEdge(item.id);
        break;
      case "STAIR":
        campusStore.deleteStairGroup(item.id);
        break;
      case "LIFT":
        campusStore.deleteLiftGroup(item.id);
        break;
      case "OBSTACLE":
        campusStore.deleteObstacle(item.id);
        break;
      default:
        campusStore.deleteSelectedEntities([item.id]);
    }

    toast({ type: "success", title: "Entity Deleted", description: `Deleted ${item.category} "${item.name}" with live CAD sync!` });
    setStoreData({ ...campusStore.getWorkingData() });
  };

  return (
    <div
      ref={containerRef}
      className={`${isFullscreen
          ? "fixed inset-0 z-[99999] h-screen w-screen overflow-y-auto bg-[rgb(var(--bg))] p-6 space-y-6"
          : "space-y-8 pb-12"
        }`}
    >
      {/* HEADER BANNER WITH GRADIENT ACCENTS, UNDO/REDO & FULLSCREEN TOGGLE */}
      <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--primary)/0.25)] bg-gradient-to-r from-[rgb(var(--primary)/0.12)] via-[rgb(var(--card))] to-[rgb(var(--primary)/0.06)] p-5 shadow-md backdrop-blur-md">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-[rgb(var(--primary)/0.1)] to-transparent pointer-events-none" />

        <div className="space-y-4 relative z-10">
          {/* Top Row: Title, Badge & Description */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl gradient-primary text-white shadow-lg shadow-[rgb(var(--primary)/0.3)]">
              <Sliders className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight text-[rgb(var(--fg))]">
                  Campus Objects Manager
                </h2>
                <Badge variant="primary" className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                  Central Hub
                </Badge>
              </div>
              <p className="text-xs text-[rgb(var(--muted-fg))] mt-0.5 leading-relaxed">
                Dedicated panel for creating, configuring, and managing all digital twin campus entities. Positions and attributes automatically synchronize with CAD Canvas in real-time.
              </p>
            </div>
          </div>

          {/* Action Toolbar Row: Aligned in a single clean row */}
          <div className="flex flex-wrap items-center justify-start gap-2 pt-3 border-t border-[rgb(var(--border))/0.4]">
            {/* UNDO / REDO CONTROLS */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleUndo}
              disabled={!campusStore.canUndo()}
              title="Undo (Ctrl+Z)"
              className="gap-1 shadow-xs"
            >
              <Undo2 className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span className="font-semibold text-xs">Undo</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleRedo}
              disabled={!campusStore.canRedo()}
              title="Redo (Ctrl+Y)"
              className="gap-1 shadow-xs"
            >
              <Redo2 className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span className="font-semibold text-xs">Redo</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowMobilePanel((prev) => !prev)}
              className="gap-1.5 shadow-xs lg:hidden border-[rgb(var(--border))]"
              title={showMobilePanel ? "Hide Object Creator Panel" : "Show Object Creator Panel"}
            >
              <Layers className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span className="font-semibold text-xs">{showMobilePanel ? "Hide Panel" : "Show Panel"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={toggleFullscreen}
              className="gap-1.5 shadow-xs"
              title={isFullscreen ? "Exit Full Screen" : "Full Screen View"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4 text-[rgb(var(--primary))]" /> : <Maximize2 className="h-4 w-4 text-[rgb(var(--primary))]" />}
              <span className="font-semibold text-xs">{isFullscreen ? "Exit Fullscreen" : "Full Screen"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5 shadow-xs"
              title="Soft Refresh Campus Data (Preserves Fullscreen)"
            >
              <RefreshCw className={cn("h-4 w-4 text-[rgb(var(--primary))]", isRefreshing && "animate-spin")} />
              <span className="font-semibold text-xs">{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </Button>

            {/* Whole Data Import/Export Engine */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleWholeDataInputChange}
              className="hidden"
            />

            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadWholeData}
              className="gap-1.5 shadow-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
              title="Download Complete Whole Graph Dataset JSON File"
            >
              <Download className="h-4 w-4" />
              <span className="font-semibold text-xs">Download Whole Data</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleTriggerWholeDataInput}
              className="gap-1.5 shadow-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              title="Upload & Feed Whole Data JSON File"
            >
              <Upload className="h-4 w-4" />
              <span className="font-semibold text-xs">Feed Whole Data</span>
            </Button>

            <Link href="/admin/editor">
              <Button size="sm" variant="gradient" className="gap-2 shadow-xs">
                <Compass className="h-4 w-4" /> <span className="text-xs font-semibold">Open CAD Canvas</span> <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* 2-STEP WORKFLOW CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* STEP 1: ENTITY TYPE SELECTOR (4 COLS - Hidden by default on mobile unless toggled) */}
        <div className={cn("lg:col-span-4 space-y-3 transition-all duration-300", !showMobilePanel ? "hidden lg:block" : "block")}>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-white text-xs font-extrabold shadow-sm">1</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[rgb(var(--fg))]">Select Object Type</h3>
            </div>
            <span className="text-xs font-semibold text-[rgb(var(--muted-fg))] font-mono bg-[rgb(var(--muted))] px-2 py-0.5 rounded-md">
              {Object.values(entityCounts).reduce((a, b) => a + b, 0)} Items
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 max-h-[640px] overflow-y-auto pr-1 scrollbar-thin">
            {ENTITY_TYPES.map((item) => {
              const Icon = item.icon;
              const isSelected = selectedType === item.type;
              const count = entityCounts[item.type] || 0;

              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setSelectedType(item.type)}
                  className={`group relative flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all duration-200 ${isSelected
                      ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.08)] shadow-md ring-2 ring-[rgb(var(--primary)/0.3)]"
                      : "border-[rgb(var(--border))] bg-[rgb(var(--card))] hover:bg-[rgb(var(--muted)/0.6)] hover:border-[rgb(var(--border-strong))]"
                    }`}
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105 ${isSelected
                        ? "bg-[rgb(var(--primary))] text-white shadow-md"
                        : "bg-[rgb(var(--muted))] text-[rgb(var(--muted-fg))]"
                      }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${isSelected ? "text-[rgb(var(--primary))]" : "text-[rgb(var(--fg))]"}`}>
                        {item.label}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${isSelected ? "bg-[rgb(var(--primary))] text-white" : "bg-[rgb(var(--muted))] text-[rgb(var(--muted-fg))]"}`}>
                          {count}
                        </span>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-[rgb(var(--primary))]" />}
                      </div>
                    </div>
                    <p className="text-[11px] text-[rgb(var(--muted-fg))] line-clamp-1 mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* STEP 2: DYNAMIC FORM CONTAINER (8 COLS) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-white text-xs font-extrabold shadow-sm">2</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[rgb(var(--fg))]">
                {ENTITY_TYPES.find((t) => t.type === selectedType)?.label} Data Entry Form
              </h3>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePasteEntity}
              className="h-8 text-xs gap-1.5 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 shadow-sm"
              title="Paste copied object data into form"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              <span>Paste {copiedEntityPayload ? `Copied ${copiedEntityPayload.category}` : "Copied Data"}</span>
            </Button>
          </div>

          <Card className="p-6 space-y-6 border-[rgb(var(--border))] shadow-md bg-[rgb(var(--card))]">

            {/* BUILDING FORM */}
            {selectedType === "BUILDING" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building Name *</label>
                    <Input
                      placeholder="e.g. Science & Tech Block A"
                      value={buildingForm.name}
                      onChange={(e) => setBuildingForm({ ...buildingForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Category</label>
                    <Input
                      placeholder="e.g. Academic / Administration"
                      value={buildingForm.category}
                      onChange={(e) => setBuildingForm({ ...buildingForm, category: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Number of Upper Floors (0 = Ground Floor only)</label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={buildingForm.floorsCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setBuildingForm({ ...buildingForm, floorsCount: isNaN(val) ? 0 : Math.max(0, val) });
                      }}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building Description</label>
                    <Input
                      placeholder="e.g. Main academic building with laboratories"
                      value={buildingForm.description}
                      onChange={(e) => setBuildingForm({ ...buildingForm, description: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                {/* Dynamic Building GPS Footprint Corners */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[rgb(var(--primary))]" />
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-[rgb(var(--fg))]">
                          Building Geographic Footprint Corners (Latitude + Longitude)
                        </h4>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                          Polygon vertices in sequence: 1 → 2 → ... → N → 1 (automatically closed). Minimum 3 corners required.
                        </p>
                      </div>
                    </div>
                    <Badge variant="primary" className="text-[10px] font-bold shrink-0">
                      {buildingForm.corners.length} Corners Footprint
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {buildingForm.corners.map((c, idx) => (
                      <div key={`corner-${idx}`} className="space-y-1.5 bg-[rgb(var(--card))] p-3 rounded-lg border shadow-xs relative">
                        <div className="flex items-center justify-between mb-1 border-b pb-1">
                          <span className="font-bold text-[rgb(var(--primary))] text-[11px]">
                            Corner {idx + 1}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[11px] text-red-500 hover:text-red-600 hover:bg-red-500/10 disabled:opacity-30"
                            disabled={buildingForm.corners.length <= 3}
                            onClick={() => handleRemoveBuildingCorner(idx)}
                            title={buildingForm.corners.length <= 3 ? "Minimum 3 corners required for a polygon" : "Remove corner"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div>
                          <label className="text-[10px] text-[rgb(var(--muted-fg))] font-semibold">Latitude</label>
                          <Input
                            placeholder="Lat"
                            value={c.lat}
                            onChange={(e) => handleUpdateBuildingCorner(idx, "lat", e.target.value)}
                            className="text-xs h-8 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[rgb(var(--muted-fg))] font-semibold">Longitude</label>
                          <Input
                            placeholder="Lng"
                            value={c.lng}
                            onChange={(e) => handleUpdateBuildingCorner(idx, "lng", e.target.value)}
                            className="text-xs h-8 font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[rgb(var(--border))/0.4]">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAddBuildingCorner}
                      className="gap-1.5 border-dashed border-[rgb(var(--primary)/0.5)] text-[rgb(var(--primary))] hover:bg-[rgb(var(--primary)/0.08)] font-semibold text-xs"
                    >
                      <Plus className="h-4 w-4" /> + Add Corner
                    </Button>
                    <span className="text-[11px] text-[rgb(var(--muted-fg))] font-medium">
                      Vertex Order: {buildingForm.corners.map((_, i) => i + 1).join(" → ")} → 1
                    </span>
                  </div>
                </div>

                {/* Footprint Live Preview */}
                <div className="rounded-xl border bg-black/90 p-4 space-y-2 text-white shadow-inner">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold flex items-center gap-1.5 text-emerald-400">
                      <Eye className="h-3.5 w-3.5" /> Building Footprint Live Preview
                    </span>
                    <span className="text-[10px] text-zinc-400 font-mono">SVG Footprint Render</span>
                  </div>

                  <div className="relative h-44 w-full rounded-lg bg-zinc-950/90 border border-zinc-800 flex items-center justify-center overflow-hidden">
                    <svg className="h-full w-full" viewBox="0 0 300 180">
                      <defs>
                        <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#27272a" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#gridPattern)" />

                      <polygon
                        points={buildingFootprintPoints.svgPoints}
                        fill="rgba(59, 130, 246, 0.3)"
                        stroke="#3b82f6"
                        strokeWidth="2.5"
                        strokeDasharray="4 2"
                      />



                      <text x="10" y="170" fill="#a1a1aa" fontSize="9">
                        Bounds: Lat [{buildingFootprintPoints.minLat.toFixed(9)} .. {buildingFootprintPoints.maxLat.toFixed(9)}], Lng [{buildingFootprintPoints.minLng.toFixed(9)} .. {buildingFootprintPoints.maxLng.toFixed(9)}]
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* STAIR FORM (WITH CONNECTING FLOORS CHECKBOXES) */}
            {selectedType === "STAIR" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Staircase Name *</label>
                    <Input
                      placeholder="e.g. West Wing Staircase A"
                      value={stairForm.name}
                      onChange={(e) => setStairForm({ ...stairForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Selected Building *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={stairForm.buildingId}
                      onChange={(e) => handleStairBuildingChange(e.target.value)}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({storeData.floors.filter((f) => f.buildingId === b.id).length} Floors)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Connecting Floors Checkbox Selector */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-[rgb(var(--primary))]" /> Connecting Floors of Selected Building *
                    </span>
                    <span className="text-xs font-semibold text-[rgb(var(--primary))] font-mono">
                      {stairForm.selectedFloorIds.length} Floors Selected
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {storeData.floors
                      .filter((f) => f.buildingId === stairForm.buildingId)
                      .map((fl) => {
                        const isChecked = stairForm.selectedFloorIds.includes(fl.id);
                        return (
                          <label
                            key={fl.id}
                            className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${isChecked
                                ? "border-[rgb(var(--primary))] bg-[rgb(var(--card))] text-[rgb(var(--primary))] shadow-sm"
                                : "border-[rgb(var(--border))] bg-[rgb(var(--card))]/60 text-[rgb(var(--muted-fg))]"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setStairForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: [...prev.selectedFloorIds, fl.id],
                                  }));
                                } else {
                                  setStairForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: prev.selectedFloorIds.filter((id) => id !== fl.id),
                                  }));
                                }
                              }}
                              className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))] focus:ring-[rgb(var(--primary))]"
                            />
                            <span>{fl.name} (Level {fl.ordinal})</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude</label>
                    <Input
                      value={stairForm.lat}
                      onChange={(e) => setStairForm({ ...stairForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude</label>
                    <Input
                      value={stairForm.lng}
                      onChange={(e) => setStairForm({ ...stairForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* LIFT FORM (WITH CONNECTING FLOORS CHECKBOXES) */}
            {selectedType === "LIFT" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Lift / Elevator Name *</label>
                    <Input
                      placeholder="e.g. Central Elevator 1"
                      value={liftForm.name}
                      onChange={(e) => setLiftForm({ ...liftForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))] font-medium">Selected Building *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={liftForm.buildingId}
                      onChange={(e) => handleLiftBuildingChange(e.target.value)}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({storeData.floors.filter((f) => f.buildingId === b.id).length} Floors)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Served Floors Checkbox Selector */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <RefreshCw className="h-4 w-4 text-[rgb(var(--primary))]" /> Served Floors of Selected Building *
                    </span>
                    <span className="text-xs font-semibold text-[rgb(var(--primary))] font-mono">
                      {liftForm.selectedFloorIds.length} Floors Served
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {storeData.floors
                      .filter((f) => f.buildingId === liftForm.buildingId)
                      .map((fl) => {
                        const isChecked = liftForm.selectedFloorIds.includes(fl.id);
                        return (
                          <label
                            key={fl.id}
                            className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${isChecked
                                ? "border-[rgb(var(--primary))] bg-[rgb(var(--card))] text-[rgb(var(--primary))] shadow-sm"
                                : "border-[rgb(var(--border))] bg-[rgb(var(--card))]/60 text-[rgb(var(--muted-fg))]"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setLiftForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: [...prev.selectedFloorIds, fl.id],
                                  }));
                                } else {
                                  setLiftForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: prev.selectedFloorIds.filter((id) => id !== fl.id),
                                  }));
                                }
                              }}
                              className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))] focus:ring-[rgb(var(--primary))]"
                            />
                            <span>{fl.name} (Level {fl.ordinal})</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude</label>
                    <Input
                      value={liftForm.lat}
                      onChange={(e) => setLiftForm({ ...liftForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude</label>
                    <Input
                      value={liftForm.lng}
                      onChange={(e) => setLiftForm({ ...liftForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* EDGE CREATION FORM (WITH SMART PATH SPLITTING) */}
            {selectedType === "EDGE" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">First Node *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={edgeForm.firstNodeId}
                      onChange={(e) => setEdgeForm({ ...edgeForm, firstNodeId: e.target.value })}
                    >
                      <option value="">-- Select First Node --</option>
                      {storeData.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name || n.id} ({n.type} · Floor: {n.floorId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Second Node *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={edgeForm.secondNodeId}
                      onChange={(e) => setEdgeForm({ ...edgeForm, secondNodeId: e.target.value })}
                    >
                      <option value="">-- Select Second Node --</option>
                      {storeData.nodes
                        .filter((n) => n.id !== edgeForm.firstNodeId)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name || n.id} ({n.type} · Floor: {n.floorId})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Edge Type</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={edgeForm.edgeType}
                      onChange={(e) => setEdgeForm({ ...edgeForm, edgeType: e.target.value as EdgeType })}
                    >
                      <option value="WALK">Pedestrian Walkway</option>
                      <option value="ROAD">Outdoor Street / Road</option>
                      <option value="STAIRS">Staircase Connection</option>
                      <option value="LIFT">Elevator / Lift Connection</option>
                      <option value="RAMP">Accessible Ramp</option>
                      <option value="ESCALATOR">Escalator</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))] font-mono">
                      Distance: <span className="text-[rgb(var(--primary))]">AUTO CALCULATED FROM GPS</span>
                    </label>
                    <Input
                      disabled
                      value={edgeSplitInfo ? `${edgeSplitInfo.edgesToCreate[0]?.distance || 10} meters (Calculated)` : "Select nodes"}
                      className="mt-1.5 bg-[rgb(var(--muted))] text-xs font-semibold"
                    />
                  </div>
                </div>

                {/* REQUIRED Path Type Selection */}
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))] block mb-1.5">
                    Path Type <span className="text-red-500">* (Required)</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label
                      className={cn(
                        "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all",
                        edgeForm.pathType === "EV"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500 shadow-xs"
                          : "border-[rgb(var(--border))] bg-[rgb(var(--bg))] hover:bg-[rgb(var(--muted)/0.5)]"
                      )}
                    >
                      <input
                        type="radio"
                        name="edgePathTypeRadio"
                        value="EV"
                        checked={edgeForm.pathType === "EV"}
                        onChange={() => setEdgeForm({ ...edgeForm, pathType: "EV" })}
                        className="mt-0.5 h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <div className="font-bold text-xs flex items-center gap-1.5 text-[rgb(var(--fg))]">
                          ⚡ EV Path
                        </div>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                          Electric vehicle + walking
                        </p>
                      </div>
                    </label>

                    <label
                      className={cn(
                        "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all",
                        edgeForm.pathType === "WALK"
                          ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500 shadow-xs"
                          : "border-[rgb(var(--border))] bg-[rgb(var(--bg))] hover:bg-[rgb(var(--muted)/0.5)]"
                      )}
                    >
                      <input
                        type="radio"
                        name="edgePathTypeRadio"
                        value="WALK"
                        checked={edgeForm.pathType === "WALK"}
                        onChange={() => setEdgeForm({ ...edgeForm, pathType: "WALK" })}
                        className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <div className="font-bold text-xs flex items-center gap-1.5 text-[rgb(var(--fg))]">
                          🚶 Only Walk Path
                        </div>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                          Walking only — EV prohibited
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {edgeSplitInfo && (
                  <div className="rounded-xl border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--primary)/0.05)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[rgb(var(--primary))] flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4" /> Live Automatic Distance & Path Inspection
                      </span>
                      <Badge variant="primary">Distance Auto-Calculated</Badge>
                    </div>

                    {edgeSplitInfo.hasIntermediates ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 text-xs text-[rgb(var(--fg))]">
                          <Split className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              Intermediate Node(s) Detected! Connection will be automatically split:
                            </span>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-medium">
                              {edgeSplitInfo.edgesToCreate.map((item, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1 bg-[rgb(var(--card))] px-2 py-1 rounded border text-[11px]">
                                  <span>{item.fromNode.name || item.fromNode.id.slice(0, 6)}</span>
                                  <ArrowRight className="h-3 w-3 text-emerald-500" />
                                  <span>{item.toNode.name || item.toNode.id.slice(0, 6)}</span>
                                  <span className="text-[10px] text-[rgb(var(--muted-fg))]">({item.distance}m)</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[rgb(var(--fg))] flex items-center justify-between">
                        <span>Direct Edge Connection (No intermediate nodes detected on straight line segment).</span>
                        <span className="font-bold text-[rgb(var(--primary))]">
                          Calculated Distance: {edgeSplitInfo.edgesToCreate[0]?.distance || 10}m
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* NODE FORM */}
            {selectedType === "NODE" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Node Name *</label>
                    <Input
                      placeholder="e.g. Corridor Junction 1"
                      value={nodeForm.name}
                      onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Node Type</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.type}
                      onChange={(e) => setNodeForm({ ...nodeForm, type: e.target.value as NodeType })}
                    >
                      <option value="CORRIDOR">Corridor Waypoint</option>
                      <option value="JUNCTION">Junction</option>
                      <option value="ROOM">Room Entry</option>
                      <option value="ENTRANCE">Building Entrance</option>
                      <option value="OUTDOOR">Outdoor Path</option>
                      <option value="STAIR">Stairway Landing</option>
                      <option value="LIFT">Elevator Landing</option>
                      <option value="WASHROOM">Washroom Node</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.buildingId}
                      onChange={(e) => setNodeForm({ ...nodeForm, buildingId: e.target.value })}
                    >
                      <option value="">Outdoor / Unassigned</option>
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.floorId}
                      onChange={(e) => setNodeForm({ ...nodeForm, floorId: e.target.value })}
                    >
                      <option value="f-out">Outdoor Area</option>
                      {storeData.floors
                        .filter((f) => !nodeForm.buildingId || f.buildingId === nodeForm.buildingId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude Coordinate</label>
                    <Input
                      value={nodeForm.lat}
                      onChange={(e) => setNodeForm({ ...nodeForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude Coordinate</label>
                    <Input
                      value={nodeForm.lng}
                      onChange={(e) => setNodeForm({ ...nodeForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ROOM (DESTINATION) FORM */}
            {selectedType === "ROOM" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Room Name *</label>
                    <Input
                      placeholder="e.g. Advanced Physics Lab"
                      value={roomForm.name}
                      onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Room Number</label>
                    <Input
                      placeholder="e.g. LH-302"
                      value={roomForm.roomNumber}
                      onChange={(e) => setRoomForm({ ...roomForm, roomNumber: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Category</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={roomForm.category}
                      onChange={(e) => setRoomForm({ ...roomForm, category: e.target.value })}
                    >
                      <option value="Classroom">Classroom / Lecture Hall</option>
                      <option value="Laboratory">Laboratory</option>
                      <option value="Office">Faculty Office</option>
                      <option value="Staff Room">Staff Room</option>
                      <option value="Seminar Hall">Seminar Hall</option>
                      <option value="Library">Library</option>
                      <option value="Washroom">Washroom</option>
                      <option value="Store Room">Store Room</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={roomForm.buildingId}
                      onChange={(e) => setRoomForm({ ...roomForm, buildingId: e.target.value })}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={roomForm.floorId}
                      onChange={(e) => setRoomForm({ ...roomForm, floorId: e.target.value })}
                    >
                      {storeData.floors
                        .filter((f) => !roomForm.buildingId || f.buildingId === roomForm.buildingId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude</label>
                    <Input
                      value={roomForm.lat}
                      onChange={(e) => setRoomForm({ ...roomForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude</label>
                    <Input
                      value={roomForm.lng}
                      onChange={(e) => setRoomForm({ ...roomForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OBSTACLE FORM */}
            {selectedType === "OBSTACLE" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Obstacle Reason / Title *</label>
                    <Input
                      placeholder="e.g. Floor maintenance / Spill zone"
                      value={obstacleForm.name}
                      onChange={(e) => setObstacleForm({ ...obstacleForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Obstacle Severity</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={obstacleForm.obstacleType}
                      onChange={(e) => setObstacleForm({ ...obstacleForm, obstacleType: e.target.value as any })}
                    >
                      <option value="LOW">Low (Caution)</option>
                      <option value="MEDIUM">Medium (Avoid if possible)</option>
                      <option value="HIGH">High (Blocked)</option>
                      <option value="CRITICAL">Critical (Danger Hazard)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Blocked Radius (Meters)</label>
                    <Input
                      type="number"
                      value={obstacleForm.radius}
                      onChange={(e) => setObstacleForm({ ...obstacleForm, radius: parseFloat(e.target.value) || 10 })}
                      className="mt-1.5"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude *</label>
                      <Input
                        placeholder="e.g. 11.012345"
                        value={obstacleForm.lat}
                        onChange={(e) => setObstacleForm({ ...obstacleForm, lat: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude *</label>
                      <Input
                        placeholder="e.g. 77.012345"
                        value={obstacleForm.lng}
                        onChange={(e) => setObstacleForm({ ...obstacleForm, lng: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FLOOR FORM */}
            {selectedType === "FLOOR" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))]">Building *</label>
                  <select
                    className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                    value={floorForm.buildingId}
                    onChange={(e) => setFloorForm({ ...floorForm, buildingId: e.target.value })}
                  >
                    {storeData.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor Name</label>
                  <Input
                    placeholder="e.g. 2nd Floor Exhibition"
                    value={floorForm.name}
                    onChange={(e) => setFloorForm({ ...floorForm, name: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor Ordinal</label>
                  <Input
                    type="number"
                    value={floorForm.ordinal}
                    onChange={(e) => setFloorForm({ ...floorForm, ordinal: parseInt(e.target.value) || 0 })}
                    className="mt-1.5"
                  />
                </div>
              </div>
            )}

            {/* Submit Action */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handlePasteEntity}
                className="gap-1.5 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
              >
                <ClipboardPaste className="h-4 w-4" /> Paste Copied Data
              </Button>
              <Button type="button" variant="outline" onClick={handleResetForm}>
                Reset Form
              </Button>
              <Button type="button" variant="gradient" onClick={handleCreateEntity} className="gap-2 shadow-md">
                <Plus className="h-4 w-4" /> Add Entity to Store
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* SEARCH BAR & LIVE OBJECTS DIRECTORY TABLE */}
      <div className="space-y-4 pt-6 border-t">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-extrabold text-[rgb(var(--fg))]">Live Campus Objects Directory</h3>
            <p className="text-xs text-[rgb(var(--muted-fg))]">
              {filteredEntities.length} active objects found in working graph.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {selectedRowIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeleteSelected}
                className="text-xs h-9 px-3 gap-1.5 shadow-sm text-red-600 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Selected ({selectedRowIds.size})
              </Button>
            )}

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgb(var(--muted-fg))]" />
              <Input
                placeholder="Search Name, ID, Building, Floor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
          <Button
            size="sm"
            variant={activeTab === "ALL" ? "primary" : "outline"}
            onClick={() => setActiveTab("ALL")}
            className="text-xs h-7 px-3 rounded-full shrink-0"
          >
            All Objects ({filteredEntities.length})
          </Button>
          {ENTITY_TYPES.map((t) => (
            <Button
              key={t.type}
              size="sm"
              variant={activeTab === t.type ? "primary" : "outline"}
              onClick={() => setActiveTab(t.type)}
              className="text-xs h-7 px-3 rounded-full shrink-0 gap-1"
            >
              <span>{t.label}</span>
            </Button>
          ))}
        </div>

        {/* Directory Table */}
        <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] overflow-hidden shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[rgb(var(--muted)/0.6)] border-b text-[rgb(var(--muted-fg))] font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAllRows}
                      className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                      title="Select All"
                    >
                      {selectedRowIds.size === filteredEntities.length && filteredEntities.length > 0 ? (
                        <CheckSquare className="h-4 w-4 text-[rgb(var(--primary))]" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">Entity Name / Identifier</th>
                  <th className="p-3.5">Building / Floor</th>
                  <th className="p-3.5">Metadata / Details</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border))]">
                {paginatedEntities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[rgb(var(--muted-fg))]">
                      No campus objects matching your search query or active filter tab.
                    </td>
                  </tr>
                ) : (
                  paginatedEntities.map((item) => {
                    const isSelected = selectedRowIds.has(item.id);
                    return (
                      <tr
                        key={`${item.category}-${item.id}`}
                        className={`transition-colors ${isSelected ? "bg-[rgb(var(--primary)/0.06)]" : "hover:bg-[rgb(var(--muted)/0.3)]"
                          }`}
                      >
                        <td className="p-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleSelectRow(item.id)}
                            className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-[rgb(var(--primary))]" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <Badge variant="default" className="text-[10px] uppercase font-bold px-2 py-0.5">
                            {item.category}
                          </Badge>
                        </td>
                        <td className="p-3.5 font-bold text-[rgb(var(--fg))]">
                          {item.name}
                          <div className="text-[10px] text-[rgb(var(--muted-fg))] font-mono font-normal">ID: {item.id}</div>
                        </td>
                        <td className="p-3.5 text-[rgb(var(--muted-fg))] font-medium">
                          {item.buildingName || item.floorName ? (
                            <span>
                              {item.buildingName} {item.floorName ? `· ${item.floorName}` : ""}
                            </span>
                          ) : (
                            <span className="italic">Campus Ground / Outdoor</span>
                          )}
                        </td>
                        <td className="p-3.5 text-[rgb(var(--muted-fg))] font-medium">{item.details}</td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/admin/editor?focus=${item.id}`}>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10"
                                title="Locate on CAD Editor"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </Link>

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleCopyEntity(item)}
                              className="h-7 w-7 text-indigo-500 hover:bg-indigo-500/10"
                              title={`Copy ${item.category} details (${item.name})`}
                            >
                              {copiedRowId === item.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500 animate-in zoom-in-50" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleOpenEditModal(item)}
                              className="h-7 w-7 text-[rgb(var(--primary))] hover:bg-[rgb(var(--primary)/0.1)]"
                              title="Edit Object Attributes"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteEntity(item)}
                              className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                              title="Delete Object"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* HIGH-PERFORMANCE PAGINATION & CONTROL TOOLBAR */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-[rgb(var(--border))] bg-[rgb(var(--card)/0.5)]">
            <div className="flex items-center gap-3 text-xs text-[rgb(var(--muted-fg))] font-medium">
              <span>
                Showing{" "}
                <strong className="text-[rgb(var(--fg))]">
                  {filteredEntities.length === 0 ? 0 : pageSize === 0 ? 1 : (currentPage - 1) * pageSize + 1}
                </strong>{" "}
                to{" "}
                <strong className="text-[rgb(var(--fg))]">
                  {pageSize === 0 ? filteredEntities.length : Math.min(currentPage * pageSize, filteredEntities.length)}
                </strong>{" "}
                of <strong className="text-[rgb(var(--fg))]">{filteredEntities.length}</strong> campus objects
              </span>

              <div className="flex items-center gap-1.5 ml-2">
                <span>Per Page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2 py-1 text-xs font-semibold text-[rgb(var(--fg))]"
                >
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={0}>All (No Limit)</option>
                </select>
              </div>
            </div>

            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="h-8 px-2.5 text-xs gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </Button>

                <div className="flex items-center gap-1 px-2 text-xs font-bold text-[rgb(var(--fg))]">
                  Page {currentPage} of {totalPages}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="h-8 px-2.5 text-xs gap-1"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* COMPREHENSIVE EDIT OBJECT MODAL DIALOG */}
      {editingItem && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 scrollbar-thin">
            <div className="flex items-center justify-between border-b pb-3 sticky top-0 bg-[rgb(var(--card))] z-10">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] font-bold">
                  <Edit3 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[rgb(var(--fg))]">Edit {editingItem.category} Attributes</h3>
                  <p className="text-[11px] text-[rgb(var(--muted-fg))] font-mono">ID: {editingItem.id}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[rgb(var(--fg))]">Name / Identifier *</label>
                <Input
                  autoFocus
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 text-sm font-semibold"
                />
              </div>

              {/* BUILDING EDIT FIELDS */}
              {editingItem.category === "BUILDING" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Category / Short Code</label>
                      <Input
                        placeholder="e.g. Academic"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Number of Upper Floors</label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={editForm.floorsCount}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setEditForm({ ...editForm, floorsCount: isNaN(val) ? 0 : Math.max(0, val) });
                        }}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Center Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Center Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  {/* Dynamic Building GPS Footprint Corners */}
                  <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-[rgb(var(--fg))] text-[11px] flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-[rgb(var(--primary))]" /> Geographic Footprint Corners ({editForm.corners?.length || 0} Points)
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddEditBuildingCorner}
                        className="h-6 text-[10px] gap-1 px-2 border-dashed border-[rgb(var(--primary)/0.5)] text-[rgb(var(--primary))]"
                      >
                        <Plus className="h-3 w-3" /> + Add Corner
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {(editForm.corners || []).map((c: any, idx: number) => (
                        <div key={`edit-corner-${idx}`} className="bg-[rgb(var(--card))] p-2 rounded border space-y-1 relative">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[rgb(var(--primary))] text-[10px]">Corner {idx + 1}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px] text-red-500 hover:bg-red-500/10 disabled:opacity-30"
                              disabled={(editForm.corners || []).length <= 3}
                              onClick={() => handleRemoveEditBuildingCorner(idx)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <Input
                            placeholder="Lat"
                            value={c.lat}
                            onChange={(e) => handleUpdateEditBuildingCorner(idx, "lat", e.target.value)}
                            className="text-[11px] h-7 font-mono"
                          />
                          <Input
                            placeholder="Lng"
                            value={c.lng}
                            onChange={(e) => handleUpdateEditBuildingCorner(idx, "lng", e.target.value)}
                            className="text-[11px] h-7 font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* FLOOR EDIT FIELDS */}
              {editingItem.category === "FLOOR" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                      value={editForm.buildingId}
                      onChange={(e) => setEditForm({ ...editForm, buildingId: e.target.value })}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Floor Ordinal Level</label>
                    <Input
                      type="number"
                      value={editForm.ordinal}
                      onChange={(e) => setEditForm({ ...editForm, ordinal: parseInt(e.target.value) || 0 })}
                      className="mt-1 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* ROOM EDIT FIELDS */}
              {editingItem.category === "ROOM" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Room Number</label>
                      <Input
                        value={editForm.roomNumber}
                        onChange={(e) => setEditForm({ ...editForm, roomNumber: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Category</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      >
                        <option value="Classroom">Classroom</option>
                        <option value="Laboratory">Laboratory</option>
                        <option value="Office">Faculty Office</option>
                        <option value="Seminar Hall">Seminar Hall</option>
                        <option value="Library">Library</option>
                        <option value="Washroom">Washroom</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Building</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.buildingId}
                        onChange={(e) => setEditForm({ ...editForm, buildingId: e.target.value })}
                      >
                        {storeData.buildings.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Floor</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.floorId}
                        onChange={(e) => setEditForm({ ...editForm, floorId: e.target.value })}
                      >
                        {storeData.floors
                          .filter((f) => !editForm.buildingId || f.buildingId === editForm.buildingId)
                          .map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* NODE EDIT FIELDS */}
              {editingItem.category === "NODE" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Node Type</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.nodeType}
                        onChange={(e) => setEditForm({ ...editForm, nodeType: e.target.value as NodeType })}
                      >
                        <option value="CORRIDOR">Corridor Waypoint</option>
                        <option value="JUNCTION">Junction</option>
                        <option value="ROOM">Room Entry</option>
                        <option value="ENTRANCE">Building Entrance</option>
                        <option value="STAIR">Stair Landing</option>
                        <option value="LIFT">Elevator Landing</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Floor</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.floorId}
                        onChange={(e) => setEditForm({ ...editForm, floorId: e.target.value })}
                      >
                        <option value="f-out">Outdoor Area</option>
                        {storeData.floors.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 font-bold text-[rgb(var(--fg))] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.accessible}
                      onChange={(e) => setEditForm({ ...editForm, accessible: e.target.checked })}
                      className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))]"
                    />
                    <span>Wheelchair Accessible Node</span>
                  </label>
                </div>
              )}

              {/* EDGE EDIT FIELDS */}
              {editingItem.category === "EDGE" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">From Node</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.firstNodeId}
                        onChange={(e) => setEditForm({ ...editForm, firstNodeId: e.target.value })}
                      >
                        {storeData.nodes.map((n) => (
                          <option key={n.id} value={n.id}>{n.name || n.id}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">To Node</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.secondNodeId}
                        onChange={(e) => setEditForm({ ...editForm, secondNodeId: e.target.value })}
                      >
                        {storeData.nodes.map((n) => (
                          <option key={n.id} value={n.id}>{n.name || n.id}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Edge Type</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.edgeType}
                        onChange={(e) => setEditForm({ ...editForm, edgeType: e.target.value as EdgeType })}
                      >
                        <option value="WALK">Pedestrian Walkway</option>
                        <option value="ROAD">Outdoor Street / Road</option>
                        <option value="STAIRS">Staircase Connection</option>
                        <option value="LIFT">Elevator Connection</option>
                        <option value="RAMP">Accessible Ramp</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Path Type (Vehicle / Walk Access)</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.pathType || "WALK"}
                        onChange={(e) => setEditForm({ ...editForm, pathType: e.target.value as PathType })}
                      >
                        <option value="EV">⚡ EV Path (Electric vehicle + walking)</option>
                        <option value="WALK">🚶 Only Walk Path (Walking only — EV prohibited)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Distance (Meters)</label>
                    <Input
                      type="number"
                      value={editForm.distance}
                      onChange={(e) => setEditForm({ ...editForm, distance: parseFloat(e.target.value) || 0 })}
                      className="mt-1 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* STAIR / LIFT EDIT FIELDS */}
              {(editingItem.category === "STAIR" || editingItem.category === "LIFT") && (
                <div className="space-y-3">
                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                      value={editForm.buildingId}
                      onChange={(e) => setEditForm({ ...editForm, buildingId: e.target.value })}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl border p-3 bg-[rgb(var(--primary)/0.04)] space-y-2">
                    <span className="font-bold text-[rgb(var(--fg))] text-[11px]">Connecting / Served Floors</span>
                    <div className="grid grid-cols-2 gap-2">
                      {storeData.floors
                        .filter((f) => !editForm.buildingId || f.buildingId === editForm.buildingId)
                        .map((fl) => {
                          const checked = editForm.selectedFloorIds.includes(fl.id);
                          return (
                            <label key={fl.id} className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditForm((prev) => ({ ...prev, selectedFloorIds: [...prev.selectedFloorIds, fl.id] }));
                                  } else {
                                    setEditForm((prev) => ({ ...prev, selectedFloorIds: prev.selectedFloorIds.filter((id) => id !== fl.id) }));
                                  }
                                }}
                                className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))]"
                              />
                              <span>{fl.name} (Level {fl.ordinal})</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* OBSTACLE EDIT FIELDS */}
              {editingItem.category === "OBSTACLE" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Severity</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.severity}
                        onChange={(e) => setEditForm({ ...editForm, severity: e.target.value as any })}
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Blocked Radius (m)</label>
                      <Input
                        type="number"
                        value={editForm.radius}
                        onChange={(e) => setEditForm({ ...editForm, radius: parseFloat(e.target.value) || 10 })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t">
              <Button size="sm" variant="outline" onClick={() => setEditingItem(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="gradient" onClick={handleSaveEditModal} className="gap-1.5 shadow-md">
                <CheckCircle2 className="h-4 w-4" /> Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
