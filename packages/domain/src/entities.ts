/**
 * Canonical domain entities — the shared contract for the whole monorepo.
 *
 * Spec: 4.1 (core entities), 3.3 (shared engineering model), 9.1 (serialization).
 *
 * Rules baked into this file:
 * - Stored entities have stable identifiers; derived entities (resolved networks,
 *   rooms, intent topology status) live elsewhere and are never serialized (9.1).
 * - Identifiers are game-native where possible; display names are never keys (6.3).
 * - React Flow / PixiJS / Zustand objects never appear here (2.2).
 */

/** Stable identifier of a stored entity, unique within a project. */
export type EntityId = string;

/** Game-native identifier of a definition inside a data pack (6.3). */
export type DefinitionId = string;

/** Identifier of a versioned data pack (6.4). */
export type PackId = string;

/** Distribution channel of a pack (6.7). */
export type PackChannel = 'published' | 'user-generated';

/** Data-quality level of an extracted property (6.5). */
export type DataQuality =
  | 'extracted-and-validated'
  | 'extracted-unverified'
  | 'missing'
  | 'conflicting'
  | 'inferred';

/** Connection domains a port may belong to (4.3). Gas and liquid networks are distinct media. */
export type ConnectionMedium =
  | 'gas-pipe'
  | 'liquid-pipe'
  | 'electrical'
  | 'data'
  | 'chute'
  | 'room'
  | 'thermal';

/** Which game grid an element snaps to (4.2). Grid sizes are extracted per build, never hard-coded. */
export type GridKind = 'large' | 'small';

/** Integer cell on the element's grid (4.2). */
export interface GridCell {
  x: number;
  y: number;
  z: number;
}

/** Mounting surfaces an orientation set may contain (4.2). */
export type MountSurface = 'floor' | 'wall' | 'ceiling' | 'freestanding';

/**
 * Enumerated orientation (4.2). Each DeviceDefinition declares the exact set it allows,
 * sourced from extraction; instances must use a member of that set.
 */
export interface Orientation {
  surface: MountSurface;
  /** Yaw in 90° steps around the mount normal; meaning is per definition. */
  yaw: 0 | 1 | 2 | 3;
}

/** Local position/direction within a device footprint, transformed by orientation (4.2, 4.3). */
export interface LocalVector {
  x: number;
  y: number;
  z: number;
}

export interface PortDefinition {
  id: DefinitionId;
  medium: ConnectionMedium;
  /** Local position on the device footprint (4.3). */
  localPosition: LocalVector;
  /** Outward direction used for connector alignment validation (7.4). */
  direction: LocalVector;
  /** Compatible construction categories (4.3). */
  categories: string[];
  /** Passive = direct join; device = joins networks through device logic (4.4). */
  mediation: 'passive' | 'device';
  /** Port-specific capabilities (e.g. 'heat-exchange', 'power-input'). */
  capabilities: string[];
  sourceQuality: DataQuality;
}

export interface ConstructionRequirement {
  elementId: DefinitionId;
  quantity: number;
}

export interface FootprintCell {
  /** Local cell offset from the device origin, on the device's grid. */
  local: GridCell;
  /** True when the cell is solid and blocks incompatible equipment (4.2). */
  solid: boolean;
}

/**
 * Extracted device definition from a data pack. A device appears in the catalog
 * even when some of its capabilities are unsupported (6.5).
 */
export interface DeviceDefinition {
  id: DefinitionId;
  /** Display name from the pack; never used as a key (6.3). */
  displayName: string;
  category: string;
  grid: GridKind;
  allowedOrientations: Orientation[];
  footprint: FootprintCell[];
  ports: PortDefinition[];
  /** Boundary vs pass-through with respect to shared-volume networks (4.4). Verified property. */
  networkRole?: 'boundary' | 'passthrough';
  construction: ConstructionRequirement[];
  sourceQuality: DataQuality;
}

/** User-settable device value (extracted definitions declare the schema per setting). */
export type SettingValue = number | string | boolean;

export interface PortInstance {
  id: EntityId;
  definitionId: DefinitionId;
}

/** A placed-or-unplaced engineering component (3.3, SYNC-001). */
export interface DeviceInstance {
  id: EntityId;
  definitionId: DefinitionId;
  ports: PortInstance[];
  /** References PhysicalPlacement.id; absence means unplaced (3.3). */
  placementId?: EntityId;
  settings: Record<string, SettingValue>;
  /** Contained inventory for devices with storage state (4.5). */
  inventory?: InventoryState;
}

export interface PhysicalPlacement {
  id: EntityId;
  grid: GridKind;
  cell: GridCell;
  /** Floor/level index (3.2). */
  level: number;
  orientation: Orientation;
}

export type ConstructionKind =
  | 'pipe-segment'
  | 'pipe-junction'
  | 'pipe-bend'
  | 'cable'
  | 'cable-junction'
  | 'frame'
  | 'wall'
  | 'floor'
  | 'other';

/**
 * A build element (pipe segment, cable run, wall, …). Per-element internal volume
 * is populated only from verified extraction (4.7); absence forces Conceptual status.
 */
export interface ConstructionElement {
  id: EntityId;
  kind: ConstructionKind;
  definitionId: DefinitionId;
  grid: GridKind;
  cells: GridCell[];
  level: number;
  /** Internal volume in m³ when verified; optional until extracted (4.7). */
  volume?: number;
}

/** Endpoint reference for a connection or intent. */
export interface PortRef {
  instanceId: EntityId;
  portId: EntityId;
}

/**
 * A physical connection composed of actual build elements (3.3).
 * Elements are ConstructionElement ids; empty means directly adjacent ports.
 */
export interface PhysicalConnection {
  id: EntityId;
  medium: ConnectionMedium;
  elements: EntityId[];
  endpoints: [PortRef, PortRef];
}

/**
 * A user-declared logical connection, not yet (or no longer) realized physically (3.3).
 * Canonical stored entity; its topology status is derived, never stored (9.1).
 */
export interface ConnectionIntent {
  id: EntityId;
  medium: ConnectionMedium;
  from: PortRef;
  to: PortRef;
  label?: string;
}

export type Phase = 'gas' | 'liquid' | 'solid';

export interface SpeciesAmount {
  speciesId: string;
  phase: Phase;
  moles: number;
}

/**
 * Canonical inventory state (4.5): moles by species and phase, plus exactly one
 * canonical thermal variable for the pinned build. Everything else (pressure,
 * partial pressures, composition, the other thermal variable) is derived on read.
 */
export interface InventoryState {
  species: SpeciesAmount[];
  thermal: { kind: 'temperature' | 'internal-energy'; value: number; unit: string };
}

/**
 * A reproducible scenario (4.1). Inventories key on a stable network reference
 * (the intent or connection id it seeds). Assumed volumes are explicit user
 * assumptions for unrouted/unplaced networks and force Conceptual status (4.7).
 */
export interface Scenario {
  id: EntityId;
  name: string;
  inventories: Record<EntityId, InventoryState>;
  assumedVolumes: Record<EntityId, number>;
  /** Per-device overrides applied during the run; references DeviceInstance.id. */
  deviceSettings?: Record<EntityId, Record<string, SettingValue>>;
}

/** Model status vocabulary (5.2); weakest status wins in propagation (5.2.2). */
export type ModelStatus = 'verified' | 'unverified' | 'unsupported' | 'incompatible';

/** Input ranges the recorded fixtures cover (5.2.1). */
export interface ValidityEnvelope {
  /** Named inputs, e.g. `temperatureK: { min: 3, max: 1500 }`. */
  inputs: Record<string, { min?: number; max?: number }>;
  notes?: string;
}

/**
 * A versioned game-mechanics implementation (5.3). Declares the pack properties
 * and constants it consumes so pack diffs can invalidate it (6.6).
 */
export interface BehaviorModel {
  id: DefinitionId;
  version: string;
  domain: string;
  consumes: { properties: string[]; constants: string[] };
  envelope: ValidityEnvelope;
  status: ModelStatus;
  fixtureIds: string[];
}

/** Topology status vocabulary (3.5). */
export type TopologyStatus = 'buildable' | 'conceptual';

/** A calculation result with its two independent statuses (3.5, 5.2.2). */
export interface CalculationResult {
  id: EntityId;
  capabilityId: string;
  /** Network or subgraph reference the result describes. */
  networkRef: EntityId;
  modelStatus: ModelStatus;
  topologyStatus: TopologyStatus;
  /** Every contributing model and its status (5.2.2). */
  contributingModels: { modelId: string; status: ModelStatus }[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** Human-readable explanation: inputs, assumptions, sources, envelope (1.1 #7). */
  explanation: string[];
  computedWith: {
    packHash: string;
    behaviorEngineVersion: string;
    scenarioDigest: string;
  };
}

export type Severity = 'error' | 'warning' | 'info';

/** Diagnostic vocabulary and shape (8). */
export interface ValidationDiagnostic {
  /** Stable code, e.g. 'CONN-UNROUTED'. */
  code: string;
  severity: Severity;
  entityIds: EntityId[];
  message: string;
  packId?: PackId;
  rule: string;
  suggestion?: string;
}

export interface ProjectMeta {
  schemaVersion: number;
  id: EntityId;
  name: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  packId: PackId;
  packHash: string;
  gameBuild: string;
  channel: PackChannel;
}

export interface ProjectSettings {
  autoSave: boolean;
  /** Opt-in for experimental (Unverified) output (5.2). */
  showExperimental: boolean;
}

/** Presentation-only schematic layout metadata (9.1). */
export interface SchematicLayout {
  nodePositions: Record<EntityId, { x: number; y: number }>;
}

/**
 * The canonical project document (9.1). Derived entities are absent by design;
 * they are recomputed on load.
 */
export interface Project {
  meta: ProjectMeta;
  devices: DeviceInstance[];
  placements: PhysicalPlacement[];
  construction: ConstructionElement[];
  connections: PhysicalConnection[];
  intents: ConnectionIntent[];
  scenarios: Scenario[];
  settings: ProjectSettings;
  schematicLayout: SchematicLayout;
}
