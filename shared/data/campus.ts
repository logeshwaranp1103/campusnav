export type NodeType =
  | "ENTRANCE"
  | "EXIT"
  | "RECEPTION"
  | "CORRIDOR"
  | "JUNCTION"
  | "ROOM"
  | "LABORATORY"
  | "OFFICE"
  | "LIFT"
  | "STAIR"
  | "OUTDOOR"
  | "PARKING"
  | "WASHROOM"
  | "ESCALATOR"
  | "FACILITY"
  | "BUILDING_ENTRANCE"
  | "ROOM_ENTRANCE"
  | "OUTDOOR_PATH"
  | "ROAD_JUNCTION"
  | "GATE"
  | "DESTINATION_NODE";

export type EdgeType = "WALK" | "ROAD" | "STAIRS" | "LIFT" | "RAMP" | "ESCALATOR";

export type PathType = "EV" | "WALK";

export type Node = {
  id: string;
  campusId?: string;
  type: NodeType;
  name?: string;
  floorId: string;
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  searchable?: boolean;
  stairGroupId?: string;
  liftGroupId?: string;
  isEntranceNode?: boolean;
  outdoorNodeId?: string;
  accessible?: boolean;
  visibleToUser?: boolean;
  photoUrl?: string;
  photoUploadedAt?: string;
  physicalVerified?: boolean;
};

export type Edge = {
  id: string;
  from: string;
  to: string;
  fromNodeId?: string;
  toNodeId?: string;
  type: EdgeType;
  pathType?: PathType;
  distance: number;
  bidirectional?: boolean;
  stairGroupId?: string;
  liftGroupId?: string;
};

export type Building = {
  id: string;
  campusId: string;
  name: string;
  shortCode?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  description?: string;
  floorsCount?: number;
  basementsCount?: number;
  corner1Lat?: number;
  corner1Lng?: number;
  corner2Lat?: number;
  corner2Lng?: number;
  corner3Lat?: number;
  corner3Lng?: number;
  corner4Lat?: number;
  corner4Lng?: number;
  centerLat?: number;
  centerLng?: number;
  footprint?: { lat: number; lng: number }[];
};

export type Floor = {
  id: string;
  buildingId: string;
  name: string;
  ordinal: number;
  code?: string;
  svgMapUrl?: string;
  blueprintUrl?: string;
};

export type StairGroup = {
  id: string;
  buildingId: string;
  name: string;
  connectedFloorIds: string[];
  notes?: string;
  width?: number;
};

export type LiftGroup = {
  id: string;
  buildingId: string;
  name: string;
  servedFloorIds: string[];
  isAccessible?: boolean;
  notes?: string;
};



export type DoorType = "ROOM_DOOR" | "BUILDING_ENTRANCE" | "EMERGENCY_DOOR";

export type Door = {
  id: string;
  floorId: string;
  type: DoorType;
  name?: string;
  x: number;
  y: number;
  roomId?: string;
  connectedNodeId?: string;
};

export type SuggestedNode = {
  id: string;
  floorId: string;
  type: NodeType;
  name?: string;
  x: number;
  y: number;
  sourceEntityId: string;
  reason: string;
};

export type SuggestedEdge = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  distance: number;
  sourceEntityId: string;
  reason: string;
};

export function getFloorCode(ordinal: number, name?: string): string {
  if (ordinal < 0) return `B${Math.abs(ordinal)}`;
  if (ordinal === 0) return "G";
  return `${ordinal}`;
}

export type Campus = {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
};

export type DestinationCategory =
  | "Classroom"
  | "Laboratory"
  | "Office"
  | "Staff Room"
  | "Seminar Hall"
  | "Library"
  | "Washroom"
  | "Store Room"
  | "Electrical Room"
  | "Custom"
  | "Academic";

export type Destination = {
  id: string;
  nodeId?: string;
  name: string;
  category: DestinationCategory | string;
  aliases: string[];
  roomNumber?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  floorId?: string;
  doorId?: string;
  buildingId?: string;
};

export type Obstacle = {
  id: string;
  campusId: string;
  floorId?: string;
  x: number;
  y: number;
  radius: number;
  edgeIds?: string[];
  nodeId?: string;
  reason?: string;
  expiresAt?: string | null;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export type Event = {
  id: string;
  campusId: string;
  title: string;
  nodeId?: string;
  buildingId?: string;
  startsAt: string;
  endsAt: string;
  description?: string;
  color?: string;
  x?: number;
  y?: number;
};

export type GeoCalibration = {
  id: string;
  campusId: string;
  floorId?: string;
  canvasX: number;
  canvasY: number;
  lat: number;
  lng: number;
};

export const campus: Campus = {
  id: "c1",
  name: "Main Campus",
  slug: "main",
  lat: 11.4965,
  lng: 77.2774,
};

// ── Clean & Fresh Campus Graph Dataset ──────────────────

export const buildings: Building[] = [];
export const floors: Floor[] = [];
export const stairGroups: StairGroup[] = [];
export const nodes: Node[] = [];
export const edges: Edge[] = [];
export const destinations: Destination[] = [];
export const obstacles: Obstacle[] = [];
