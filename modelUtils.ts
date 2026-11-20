export type ModelSlotKind = 'kart' | 'driver';

export const SUPPORTED_MODEL_EXTENSIONS = ['.glb', '.gltf'] as const;
export const COMPANION_RESOURCE_EXTENSIONS = [
  '.bin',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ktx2',
] as const;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface ModelNormalizationResult {
  scale: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rotationY: number;
  normalizedWidth: number;
  normalizedHeight: number;
  normalizedDepth: number;
}

export interface CustomModelSummaryItem {
  id: string;
  name: string;
  kind: ModelSlotKind;
  yawSteps: number;
  scale: number;
  seatOffsetY: number;
}

export function validateModelFileName(
  fileName: string
): { ok: true; ext: '.glb' | '.gltf' } | { ok: false; error: string } {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.glb')) return { ok: true, ext: '.glb' };
  if (lower.endsWith('.gltf')) return { ok: true, ext: '.gltf' };
  return {
    ok: false,
    error:
      'Định dạng không hỗ trợ. Vui lòng chọn file .glb hoặc .gltf xuất từ Blender / Mixamo / Sketchfab.',
  };
}

export function isModelAssetFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return SUPPORTED_MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isCompanionResourceFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return COMPANION_RESOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const DRIVER_KEYWORDS = [
  'driver',
  'char',
  'character',
  'pilot',
  'avatar',
  'human',
  'person',
  'mixamo',
  'knight',
  'girl',
  'boy',
  'hero',
  'anime',
  'waifu',
  'nhanvat',
  'nhan',
  'nv',
  'taydua',
  'skin',
];

const KART_KEYWORDS = [
  'kart',
  'car',
  'vehicle',
  'chassis',
  'buggy',
  'f1',
  'formula',
  'supercar',
  'hypercar',
  'auto',
  'xe',
  'oto',
  'moto',
  'bike',
  'coupe',
  'sedan',
  'sport',
  'gt',
];

/**
 * Classifies a 3D model filename as 'kart' or 'driver' when batch-uploading mixed files.
 * Returns null if ambiguous so the caller can apply a fallback slot.
 */
export function classifyModelFileName(fileName: string): ModelSlotKind | null {
  const base = fileName
    .trim()
    .toLowerCase()
    .replace(/\.(glb|gltf)$/i, '');
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);

  let driverScore = 0;
  let kartScore = 0;

  for (const token of tokens) {
    if (DRIVER_KEYWORDS.includes(token)) driverScore += 2;
    if (KART_KEYWORDS.includes(token)) kartScore += 2;
  }

  // Fallback substring check for concatenated names like "nhanvat1" or "mykart"
  if (driverScore === 0 && kartScore === 0) {
    if (DRIVER_KEYWORDS.some((kw) => kw.length >= 4 && base.includes(kw))) {
      driverScore += 1;
    }
    if (KART_KEYWORDS.some((kw) => kw.length >= 3 && base.includes(kw))) {
      kartScore += 1;
    }
  }

  if (driverScore > kartScore) return 'driver';
  if (kartScore > driverScore) return 'kart';
  return null;
}

export function planBatchModelFiles<T extends { name: string }>(
  files: T[],
  explicitKind?: ModelSlotKind
): {
  items: Array<{ file: T; kind: ModelSlotKind }>;
  companionFiles: T[];
  rejectedNames: string[];
} {
  const items: Array<{ file: T; kind: ModelSlotKind }> = [];
  const companionFiles: T[] = [];
  const rejectedNames: string[] = [];

  for (const file of files) {
    if (isModelAssetFileName(file.name)) {
      const kind = explicitKind ?? classifyModelFileName(file.name) ?? 'kart';
      items.push({ file, kind });
    } else if (isCompanionResourceFileName(file.name)) {
      companionFiles.push(file);
    } else {
      rejectedNames.push(file.name);
    }
  }

  return { items, companionFiles, rejectedNames };
}

export function normalizeQuarterTurns(steps: number): number {
  const rounded = Math.round(steps);
  return ((rounded % 4) + 4) % 4;
}

export function clampModelScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(0.5, Math.min(1.8, Math.round(scale * 100) / 100));
}

export function clampSeatOffsetY(offsetY: number): number {
  if (!Number.isFinite(offsetY)) return 0;
  return Math.max(-0.5, Math.min(0.85, Math.round(offsetY * 100) / 100));
}

/**
 * Pure bounding-box normalization math so any external Blender/Mixamo/Sketchfab .GLB/.GLTF
 * asset fits the Zing Speed kart footprint (<= 3.25m x 1.9m) or driver cockpit seat (<= 1.15m)
 * with bottom-center anchored cleanly at (0, 0, 0).
 */
export function computeModelNormalizationTransform(
  boxMin: Vec3Like,
  boxMax: Vec3Like,
  kind: ModelSlotKind,
  yawQuarterTurns = 0,
  scaleMultiplier = 1
): ModelNormalizationResult {
  const rawW = Math.max(0.0001, boxMax.x - boxMin.x);
  const rawH = Math.max(0.0001, boxMax.y - boxMin.y);
  const rawD = Math.max(0.0001, boxMax.z - boxMin.z);

  let baseScale: number;
  if (kind === 'kart') {
    const footprintMax = Math.max(rawW, rawD);
    baseScale = Math.min(3.25 / footprintMax, 1.9 / rawH);
  } else {
    const maxDim = Math.max(rawW, rawH, rawD);
    baseScale = 1.15 / maxDim;
  }

  const finalScale = baseScale * clampModelScale(scaleMultiplier);
  const centerX = (boxMin.x + boxMax.x) * 0.5;
  const centerZ = (boxMin.z + boxMax.z) * 0.5;
  const turns = normalizeQuarterTurns(yawQuarterTurns);

  return {
    scale: finalScale,
    offsetX: -centerX * finalScale,
    offsetY: -boxMin.y * finalScale,
    offsetZ: -centerZ * finalScale,
    rotationY: turns * (Math.PI / 2),
    normalizedWidth: rawW * finalScale,
    normalizedHeight: rawH * finalScale,
    normalizedDepth: rawD * finalScale,
  };
}
