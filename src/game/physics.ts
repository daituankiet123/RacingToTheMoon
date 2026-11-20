import {
  CityTheme,
  InputState,
  KartState,
  RacerPreset,
  TrackData,
  TrackSample,
  Vec3,
} from './types';

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function evaluateClosedSpline(waypoints: Vec3[], t: number): Vec3 {
  const n = waypoints.length;
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * n;
  const i1 = Math.floor(scaled) % n;
  const localT = scaled - Math.floor(scaled);
  const i0 = (i1 - 1 + n) % n;
  const i2 = (i1 + 1) % n;
  const i3 = (i1 + 2) % n;

  return {
    x: catmullRom(waypoints[i0].x, waypoints[i1].x, waypoints[i2].x, waypoints[i3].x, localT),
    y: catmullRom(waypoints[i0].y, waypoints[i1].y, waypoints[i2].y, waypoints[i3].y, localT),
    z: catmullRom(waypoints[i0].z, waypoints[i1].z, waypoints[i2].z, waypoints[i3].z, localT),
  };
}

export function buildTrackData(city: CityTheme, sampleCount = 320): TrackData {
  const rawPoints: Vec3[] = [];
  for (let i = 0; i < sampleCount; i++) {
    rawPoints.push(evaluateClosedSpline(city.waypoints, i / sampleCount));
  }

  let totalLength = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const samples: TrackSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const prev = rawPoints[(i - 1 + sampleCount) % sampleCount];
    const curr = rawPoints[i];
    const next = rawPoints[(i + 1) % sampleCount];

    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const dz = next.z - curr.z;
    totalLength += Math.hypot(dx, dy, dz);

    minX = Math.min(minX, curr.x);
    maxX = Math.max(maxX, curr.x);
    minZ = Math.min(minZ, curr.z);
    maxZ = Math.max(maxZ, curr.z);

    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    let tz = next.z - prev.z;
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;

    // Right vector = tangent x up(0,1,0) -> (-tz, 0, tx) normalized
    let rx = -tz;
    let rz = tx;
    const rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen;
    rz /= rLen;

    samples.push({
      point: curr,
      tangent: { x: tx, y: ty, z: tz },
      right: { x: rx, y: 0, z: rz },
      t: i / sampleCount,
    });
  }

  return {
    city,
    samples,
    totalLength,
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

export function sampleTrackAt(track: TrackData, t: number): TrackSample {
  const n = track.samples.length;
  const wrapped = ((t % 1) + 1) % 1;
  const exact = wrapped * n;
  const i0 = Math.floor(exact) % n;
  const i1 = (i0 + 1) % n;
  const alpha = exact - Math.floor(exact);
  const s0 = track.samples[i0];
  const s1 = track.samples[i1];

  const tx = s0.tangent.x + (s1.tangent.x - s0.tangent.x) * alpha;
  const ty = s0.tangent.y + (s1.tangent.y - s0.tangent.y) * alpha;
  const tz = s0.tangent.z + (s1.tangent.z - s0.tangent.z) * alpha;
  const tLen = Math.hypot(tx, ty, tz) || 1;

  const rx = -tz / tLen;
  const rz = tx / tLen;
  const rLen = Math.hypot(rx, rz) || 1;

  return {
    point: {
      x: s0.point.x + (s1.point.x - s0.point.x) * alpha,
      y: s0.point.y + (s1.point.y - s0.point.y) * alpha,
      z: s0.point.z + (s1.point.z - s0.point.z) * alpha,
    },
    tangent: { x: tx / tLen, y: ty / tLen, z: tz / tLen },
    right: { x: rx / rLen, y: 0, z: rz / rLen },
    t: wrapped,
  };
}

export function projectPointOntoTrack(
  track: TrackData,
  x: number,
  z: number,
  hintT?: number
): { sample: TrackSample; lateralOffset: number; distSq: number } {
  const n = track.samples.length;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  if (hintT !== undefined) {
    const center = Math.floor((((hintT % 1) + 1) % 1) * n);
    const window = 36;
    for (let offset = -window; offset <= window; offset++) {
      const idx = (center + offset + n) % n;
      const p = track.samples[idx].point;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
  }

  // Fallback global search if kart jumped far from hint
  if (bestDistSq > 1200) {
    for (let i = 0; i < n; i++) {
      const p = track.samples[i].point;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
  }

  const base = track.samples[bestIdx];
  const relX = x - base.point.x;
  const relZ = z - base.point.z;
  const along = relX * base.tangent.x + relZ * base.tangent.z;
  const segLen = track.totalLength / n;
  const fineT = (((base.t + along / (track.totalLength || 1)) % 1) + 1) % 1;
  const sample = Math.abs(along) <= segLen * 1.5 ? sampleTrackAt(track, fineT) : base;

  const dx = x - sample.point.x;
  const dz = z - sample.point.z;
  const lateralOffset = dx * sample.right.x + dz * sample.right.z;

  return {
    sample,
    lateralOffset,
    distSq: dx * dx + dz * dz,
  };
}

export function createGridKartState(params: {
  id: string;
  name: string;
  racerId: string;
  isPlayer: boolean;
  isRemote: boolean;
  gridSlot: number;
  track: TrackData;
}): KartState {
  const { track, gridSlot } = params;
  // Place karts cleanly just behind the start line facing straight down the track!
  const row = Math.floor(gridSlot / 2);
  const col = gridSlot % 2 === 0 ? -1 : 1;
  const tOffset = -((row * 6.5 + 4) / track.totalLength);
  const startT = ((tOffset % 1) + 1) % 1;
  const sample = sampleTrackAt(track, startT);
  const lateral = col * Math.min(3.4, track.city.roadWidth * 0.22);

  // Heading yaw where forward vector is (sin(yaw), 0, cos(yaw))
  const yaw = Math.atan2(sample.tangent.x, sample.tangent.z);

  return {
    id: params.id,
    name: params.name,
    racerId: params.racerId,
    isPlayer: params.isPlayer,
    isRemote: params.isRemote,
    x: sample.point.x + sample.right.x * lateral,
    y: sample.point.y,
    z: sample.point.z + sample.right.z * lateral,
    yaw,
    speed: 0,
    steerAngle: 0,
    drifting: false,
    driftDir: 0,
    driftDuration: 0,
    driftTier: 0,
    driftSlipAngle: 0,
    miniBoostWindow: 0,
    miniBoostTimer: 0,
    nitroGauge: 35, // Give partial initial gauge for fast early action
    nitroCharges: 0,
    nitroTimer: 0,
    cwwActive: false,
    padBoostTimer: 0,
    hitWallTimer: 0,
    trackT: startT,
    lateralOffset: lateral,
    lap: 1,
    checkpoint: 0,
    totalProgress: startT > 0.85 ? startT - 1 : startT,
    finished: false,
    finishTimeMs: null,
    bestLapMs: null,
    lapStartMs: 0,
    maxDriftCombo: 0,
    aiLaneOffset: col * 2.2,
    aiSkill: 0.86 + (gridSlot % 4) * 0.045,
  };
}

export interface StepResult {
  hitWall: boolean;
  triggeredMiniBoost: boolean;
  triggeredNitro: boolean;
  triggeredCww: boolean;
  hitBoostPad: boolean;
  completedLap: boolean;
  finishedRace: boolean;
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function stepKartPhysics(
  kart: KartState,
  input: InputState,
  preset: RacerPreset,
  track: TrackData,
  dt: number,
  totalLaps: number,
  raceTimeMs: number
): StepResult {
  const result: StepResult = {
    hitWall: false,
    triggeredMiniBoost: false,
    triggeredNitro: false,
    triggeredCww: false,
    hitBoostPad: false,
    completedLap: false,
    finishedRace: false,
  };

  const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);

  // Decrement timers
  if (kart.miniBoostWindow > 0) kart.miniBoostWindow = Math.max(0, kart.miniBoostWindow - clampedDt);
  if (kart.miniBoostTimer > 0) kart.miniBoostTimer = Math.max(0, kart.miniBoostTimer - clampedDt);
  if (kart.nitroTimer > 0) kart.nitroTimer = Math.max(0, kart.nitroTimer - clampedDt);
  if (kart.padBoostTimer > 0) kart.padBoostTimer = Math.max(0, kart.padBoostTimer - clampedDt);
  if (kart.hitWallTimer > 0) kart.hitWallTimer = Math.max(0, kart.hitWallTimer - clampedDt);

  // Trigger Mini-Boost manually or auto on forward tap when window is open
  if (input.miniBoostJustPressed && kart.miniBoostWindow > 0) {
    kart.miniBoostTimer = 0.85;
    kart.miniBoostWindow = 0;
    result.triggeredMiniBoost = true;
  }

  // Trigger N2O Nitro canister
  if (input.nitroJustPressed && kart.nitroCharges > 0) {
    kart.nitroCharges -= 1;
    kart.nitroTimer = 3.2;
    result.triggeredNitro = true;
    // If Mini-Boost is active or available right now -> CWW Combo!
    if (kart.miniBoostTimer > 0 || kart.miniBoostWindow > 0) {
      kart.miniBoostTimer = Math.max(kart.miniBoostTimer, 1.0);
      kart.miniBoostWindow = 0;
      kart.cwwActive = true;
      result.triggeredCww = true;
    }
  }

  if (kart.nitroTimer <= 0) {
    kart.cwwActive = false;
  }

  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);

  // Drift initiation & sustain (authentic Zing Speed feel)
  const minDriftSpeed = 16;
  if (input.drift && kart.speed >= minDriftSpeed) {
    if (!kart.drifting && steerInput !== 0) {
      kart.drifting = true;
      kart.driftDir = steerInput > 0 ? 1 : -1;
      kart.driftDuration = 0;
      kart.driftTier = 0;
    }
  } else if (kart.drifting) {
    // Release drift -> grant mini-boost if charged!
    if (kart.driftDuration >= 0.42) {
      kart.miniBoostWindow = 1.1;
      // Auto-fire mini-boost if holding gas for silky Zing Speed responsiveness
      if (input.forward) {
        kart.miniBoostTimer = 0.7 + kart.driftTier * 0.2;
        kart.miniBoostWindow = 0;
        result.triggeredMiniBoost = true;
        if (kart.nitroTimer > 0) {
          kart.cwwActive = true;
          result.triggeredCww = true;
        }
      }
      if (kart.driftTier > kart.maxDriftCombo) {
        kart.maxDriftCombo = kart.driftTier;
      }
    }
    kart.drifting = false;
    kart.driftDir = 0;
    kart.driftDuration = 0;
    kart.driftTier = 0;
  }

  // Update active drift charge & nitro canister filling
  if (kart.drifting) {
    kart.driftDuration += clampedDt;
    if (kart.driftDuration >= 1.7) kart.driftTier = 3;
    else if (kart.driftDuration >= 0.95) kart.driftTier = 2;
    else if (kart.driftDuration >= 0.42) kart.driftTier = 1;

    const gaugeGain = 38 * preset.driftChargeMult * clampedDt;
    kart.nitroGauge += gaugeGain;
    while (kart.nitroGauge >= 100) {
      if (kart.nitroCharges < 2) {
        kart.nitroCharges += 1;
        kart.nitroGauge -= 100;
      } else {
        kart.nitroGauge = 100;
        break;
      }
    }
  } else {
    // Gentle passive nitro drip while driving fast
    if (kart.speed > 25 && kart.nitroCharges < 2) {
      kart.nitroGauge = Math.min(100, kart.nitroGauge + 2.2 * clampedDt);
      if (kart.nitroGauge >= 100 && kart.nitroCharges < 2) {
        kart.nitroCharges += 1;
        kart.nitroGauge = 0;
      }
    }
  }

  // Compute top speed & acceleration with boost stacks
  let topSpeed = preset.maxSpeed;
  let accel = preset.accelRate;

  if (kart.drifting) {
    topSpeed *= 0.89;
  }
  if (kart.miniBoostTimer > 0) {
    topSpeed += 9.5;
    accel *= 1.45;
  }
  if (kart.nitroTimer > 0) {
    topSpeed += 17.5;
    accel *= 1.75;
  }
  if (kart.cwwActive) {
    topSpeed += 7.0;
    accel *= 1.25;
  }
  if (kart.padBoostTimer > 0) {
    topSpeed += 16.0;
    accel *= 1.85;
  }

  if (input.forward) {
    kart.speed += accel * clampedDt;
  } else if (input.backward) {
    if (kart.speed > 2) {
      kart.speed -= 42 * clampedDt;
    } else {
      kart.speed -= 16 * clampedDt;
    }
  } else {
    // Natural rolling drag
    const drag = 14 * clampedDt;
    if (Math.abs(kart.speed) <= drag) kart.speed = 0;
    else kart.speed -= Math.sign(kart.speed) * drag;
  }

  // Smoothly cap speed when boost ends rather than abrupt wall
  if (kart.speed > topSpeed) {
    kart.speed = Math.max(topSpeed, kart.speed - 28 * clampedDt);
  }
  kart.speed = Math.max(-18, kart.speed);

  // Steering & Drift slip
  const speedRatio = Math.min(1, Math.abs(kart.speed) / 22);
  const reverseSign = kart.speed >= -0.1 ? 1 : -1;

  if (kart.drifting) {
    const baseDriftTurn = kart.driftDir * preset.turnRate * 0.78;
    const fineControl = steerInput * preset.turnRate * 0.52;
    kart.yaw += (baseDriftTurn + fineControl) * speedRatio * clampedDt;
    const targetSlip = kart.driftDir * 0.44 + steerInput * 0.12;
    kart.driftSlipAngle += (targetSlip - kart.driftSlipAngle) * Math.min(1, 10 * clampedDt);
    kart.steerAngle += (steerInput * 0.55 - kart.steerAngle) * Math.min(1, 12 * clampedDt);
  } else {
    kart.yaw += steerInput * preset.turnRate * speedRatio * reverseSign * clampedDt;
    kart.driftSlipAngle += (0 - kart.driftSlipAngle) * Math.min(1, 10 * clampedDt);
    kart.steerAngle += (steerInput * 0.45 - kart.steerAngle) * Math.min(1, 12 * clampedDt);
  }
  kart.yaw = normalizeAngle(kart.yaw);

  // Move along travel heading (slightly offset from visual yaw during drift)
  const travelYaw = kart.yaw - kart.driftSlipAngle * 0.35;
  kart.x += Math.sin(travelYaw) * kart.speed * clampedDt;
  kart.z += Math.cos(travelYaw) * kart.speed * clampedDt;

  // Project onto track spline for road elevation, guardrail bounce, boost pads & lap progress
  const prevT = kart.trackT;
  const proj = projectPointOntoTrack(track, kart.x, kart.z, prevT);
  const halfRoad = track.city.roadWidth * 0.5 - 1.35;

  kart.y = proj.sample.point.y;
  kart.trackT = proj.sample.t;
  kart.lateralOffset = proj.lateralOffset;

  // Guardrail containment & soft Zing Speed wall slide/bounce
  if (Math.abs(proj.lateralOffset) > halfRoad) {
    const clampedLat = Math.sign(proj.lateralOffset) * halfRoad;
    kart.x = proj.sample.point.x + proj.sample.right.x * clampedLat;
    kart.z = proj.sample.point.z + proj.sample.right.z * clampedLat;
    kart.lateralOffset = clampedLat;

    // Redirect heading slightly toward track tangent so karts never stick in walls
    const trackYaw = Math.atan2(proj.sample.tangent.x, proj.sample.tangent.z);
    const diff = normalizeAngle(trackYaw - kart.yaw);
    kart.yaw = normalizeAngle(kart.yaw + diff * 0.35);

    if (Math.abs(kart.speed) > 14 && kart.hitWallTimer <= 0) {
      kart.speed *= 0.76;
      kart.hitWallTimer = 0.25;
      result.hitWall = true;
    }
  }

  // Boost pad detection
  for (const padT of track.city.boostPads) {
    let distT = Math.abs(kart.trackT - padT);
    if (distT > 0.5) distT = 1 - distT;
    if (distT < 0.012 && Math.abs(kart.lateralOffset) < track.city.roadWidth * 0.36) {
      if (kart.padBoostTimer < 0.4) {
        kart.padBoostTimer = 1.25;
        kart.speed = Math.max(kart.speed + 12, preset.maxSpeed * 1.15);
        result.hitBoostPad = true;
      }
    }
  }

  // Checkpoint & Lap progression (4 sectors: 0.25, 0.50, 0.75, wrap 0.9 -> 0.1)
  if (!kart.finished) {
    if (kart.checkpoint === 0 && kart.trackT >= 0.22 && kart.trackT <= 0.45) {
      kart.checkpoint = 1;
    } else if (kart.checkpoint === 1 && kart.trackT >= 0.47 && kart.trackT <= 0.70) {
      kart.checkpoint = 2;
    } else if (kart.checkpoint === 2 && kart.trackT >= 0.72 && kart.trackT <= 0.95) {
      kart.checkpoint = 3;
    }

    // Crossing start/finish line forward after hitting all checkpoints
    if (kart.checkpoint === 3 && prevT > 0.8 && kart.trackT < 0.2) {
      const lapTime = raceTimeMs - kart.lapStartMs;
      if (lapTime > 1000 && (kart.bestLapMs === null || lapTime < kart.bestLapMs)) {
        kart.bestLapMs = lapTime;
      }
      kart.lapStartMs = raceTimeMs;
      kart.checkpoint = 0;
      result.completedLap = true;

      if (kart.lap >= totalLaps) {
        kart.finished = true;
        kart.finishTimeMs = raceTimeMs;
        result.finishedRace = true;
      } else {
        kart.lap += 1;
      }
    }

    // Compute monotonic race progress
    const effectiveT = kart.checkpoint === 0 && kart.trackT > 0.85 ? kart.trackT - 1 : kart.trackT;
    kart.totalProgress = kart.finished ? totalLaps + 1 : kart.lap - 1 + effectiveT;
  }

  return result;
}

export function computeAiInput(kart: KartState, track: TrackData, elapsedSec: number): InputState {
  // Look ahead along spline
  const lookAheadT = (kart.trackT + 0.045) % 1;
  const targetSample = sampleTrackAt(track, lookAheadT);
  const laneWave = Math.sin(elapsedSec * 0.4 + kart.aiLaneOffset) * 2.0;
  const targetLat = Math.max(
    -track.city.roadWidth * 0.32,
    Math.min(track.city.roadWidth * 0.32, kart.aiLaneOffset + laneWave)
  );
  const tx = targetSample.point.x + targetSample.right.x * targetLat;
  const tz = targetSample.point.z + targetSample.right.z * targetLat;

  const desiredYaw = Math.atan2(tx - kart.x, tz - kart.z);
  const diff = normalizeAngle(desiredYaw - kart.yaw);

  // Also check sharper corner further ahead to decide when to drift
  const farSample = sampleTrackAt(track, (kart.trackT + 0.08) % 1);
  const farYaw = Math.atan2(farSample.tangent.x, farSample.tangent.z);
  const curveAngle = Math.abs(normalizeAngle(farYaw - kart.yaw));

  const shouldDrift = curveAngle > 0.32 && kart.speed > 24 && Math.abs(diff) > 0.09;
  const shouldUseNitro = kart.nitroCharges > 0 && curveAngle < 0.28 && kart.speed > 38;

  return {
    forward: !kart.finished,
    backward: false,
    left: diff > 0.06,
    right: diff < -0.06,
    drift: shouldDrift,
    nitroJustPressed: shouldUseNitro,
    miniBoostJustPressed: kart.miniBoostWindow > 0,
  };
}

export function computeRaceStandings(karts: KartState[]): KartState[] {
  return [...karts].sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTimeMs ?? Infinity) - (b.finishTimeMs ?? Infinity);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.totalProgress - a.totalProgress;
  });
}

export function isKartWrongWay(kart: KartState, track: TrackData): boolean {
  if (kart.speed < 8) return false;
  const sample = sampleTrackAt(track, kart.trackT);
  const forwardX = Math.sin(kart.yaw);
  const forwardZ = Math.cos(kart.yaw);
  const dot = forwardX * sample.tangent.x + forwardZ * sample.tangent.z;
  return dot < -0.45;
}

export interface SkidMarkSegment {
  active: boolean;
  age: number;
  maxLife: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  width: number;
  tier: 0 | 1 | 2 | 3;
  opacity: number;
}

export interface KartTireTracker {
  hasPrev: boolean;
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
}

export interface SkidMarkPool {
  capacity: number;
  cursor: number;
  activeCount: number;
  defaultMaxLife: number;
  segments: SkidMarkSegment[];
  trackers: Map<string, KartTireTracker>;
}

export function createSkidMarkPool(capacity = 520, defaultMaxLife = 7.5): SkidMarkPool {
  const segments: SkidMarkSegment[] = [];
  for (let i = 0; i < capacity; i++) {
    segments.push({
      active: false,
      age: 0,
      maxLife: defaultMaxLife,
      x0: 0,
      y0: -100,
      z0: 0,
      x1: 0,
      y1: -100,
      z1: 0,
      width: 0.42,
      tier: 0,
      opacity: 0,
    });
  }
  return {
    capacity,
    cursor: 0,
    activeCount: 0,
    defaultMaxLife,
    segments,
    trackers: new Map<string, KartTireTracker>(),
  };
}

export function clearSkidMarkPool(pool: SkidMarkPool): void {
  pool.cursor = 0;
  pool.activeCount = 0;
  pool.trackers.clear();
  for (let i = 0; i < pool.capacity; i++) {
    const s = pool.segments[i];
    s.active = false;
    s.age = 0;
    s.opacity = 0;
    s.y0 = -100;
    s.y1 = -100;
  }
}

export function shouldEmitSkidMarks(kart: KartState): boolean {
  if (kart.drifting && Math.abs(kart.speed) >= 14) return true;
  if (Math.abs(kart.driftSlipAngle) >= 0.14 && Math.abs(kart.speed) >= 16) return true;
  return false;
}

export function computeKartRearWheelContacts(kart: KartState): {
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
} {
  const visualYaw = kart.yaw + kart.driftSlipAngle * 0.45;
  const fx = Math.sin(visualYaw);
  const fz = Math.cos(visualYaw);
  // Right vector perpendicular to visual heading
  const rightX = -fz;
  const rightZ = fx;

  const rearAxleDist = 1.18;
  const halfTrackWidth = 0.96;
  const baseX = kart.x - fx * rearAxleDist;
  const baseZ = kart.z - fz * rearAxleDist;
  const roadY = kart.y + 0.044;

  return {
    lx: baseX - rightX * halfTrackWidth,
    ly: roadY,
    lz: baseZ - rightZ * halfTrackWidth,
    rx: baseX + rightX * halfTrackWidth,
    ry: roadY,
    rz: baseZ + rightZ * halfTrackWidth,
  };
}

function pushSkidSegment(
  pool: SkidMarkPool,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  width: number,
  tier: 0 | 1 | 2 | 3,
  maxLife: number
): void {
  const seg = pool.segments[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.capacity;
  seg.active = true;
  seg.age = 0;
  seg.maxLife = maxLife;
  seg.x0 = x0;
  seg.y0 = y0;
  seg.z0 = z0;
  seg.x1 = x1;
  seg.y1 = y1;
  seg.z1 = z1;
  seg.width = width;
  seg.tier = tier;
  seg.opacity = 1;
}

export function stepSkidMarkPool(
  pool: SkidMarkPool,
  karts: KartState[],
  dt: number
): boolean {
  let dirty = false;
  let activeCount = 0;

  // 1. Age and fade existing skid mark segments
  for (let i = 0; i < pool.capacity; i++) {
    const seg = pool.segments[i];
    if (!seg.active) continue;
    dirty = true;
    seg.age += dt;
    if (seg.age >= seg.maxLife) {
      seg.active = false;
      seg.opacity = 0;
      seg.y0 = -100;
      seg.y1 = -100;
      continue;
    }
    const lifeRatio = seg.age / seg.maxLife;
    // Hold strong visibility initially, then fade smoothly to 0
    seg.opacity = Math.max(0, 1 - Math.pow(lifeRatio, 1.45));
    activeCount++;
  }

  // 2. Sample rear tires of drifting karts and emit dual-wheel ribbon segments
  const minSegLen = 0.34;
  const maxSegLen = 8.5;

  for (let i = 0; i < karts.length; i++) {
    const kart = karts[i];
    let tracker = pool.trackers.get(kart.id);
    if (!tracker) {
      tracker = { hasPrev: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0 };
      pool.trackers.set(kart.id, tracker);
    }

    if (!shouldEmitSkidMarks(kart)) {
      tracker.hasPrev = false;
      continue;
    }

    const contacts = computeKartRearWheelContacts(kart);
    if (!tracker.hasPrev) {
      tracker.hasPrev = true;
      tracker.lx = contacts.lx;
      tracker.ly = contacts.ly;
      tracker.lz = contacts.lz;
      tracker.rx = contacts.rx;
      tracker.ry = contacts.ry;
      tracker.rz = contacts.rz;
      continue;
    }

    const distL = Math.hypot(contacts.lx - tracker.lx, contacts.lz - tracker.lz);
    const distR = Math.hypot(contacts.rx - tracker.rx, contacts.rz - tracker.rz);
    const maxDist = Math.max(distL, distR);

    if (maxDist > maxSegLen) {
      // Discontinuity / respawn jump: reset anchor without drawing a line across the map
      tracker.lx = contacts.lx;
      tracker.ly = contacts.ly;
      tracker.lz = contacts.lz;
      tracker.rx = contacts.rx;
      tracker.ry = contacts.ry;
      tracker.rz = contacts.rz;
      continue;
    }

    if (maxDist >= minSegLen) {
      const width = kart.driftTier >= 2 ? 0.5 : kart.driftTier === 1 ? 0.45 : 0.4;
      pushSkidSegment(
        pool,
        tracker.lx,
        tracker.ly,
        tracker.lz,
        contacts.lx,
        contacts.ly,
        contacts.lz,
        width,
        kart.driftTier,
        pool.defaultMaxLife
      );
      pushSkidSegment(
        pool,
        tracker.rx,
        tracker.ry,
        tracker.rz,
        contacts.rx,
        contacts.ry,
        contacts.rz,
        width,
        kart.driftTier,
        pool.defaultMaxLife
      );

      tracker.lx = contacts.lx;
      tracker.ly = contacts.ly;
      tracker.lz = contacts.lz;
      tracker.rx = contacts.rx;
      tracker.ry = contacts.ry;
      tracker.rz = contacts.rz;
      dirty = true;
    }
  }

  // Re-count active segments accurately after ring-buffer writes/overwrites
  if (dirty) {
    activeCount = 0;
    for (let i = 0; i < pool.capacity; i++) {
      if (pool.segments[i].active) activeCount++;
    }
  }
  pool.activeCount = activeCount;
  return dirty;
}

export interface CameraMotionBlurParams {
  intensity: number;
  radialStrength: number;
  lateralBlurX: number;
  centerX: number;
  centerY: number;
  chromaticAmount: number;
  boostTintMode: 0 | 1 | 2 | 3;
}

export function computeCameraMotionBlurParams(
  kart: KartState,
  preset: RacerPreset
): CameraMotionBlurParams {
  const absSpeed = Math.abs(kart.speed);
  // Base speed threshold: starts kicking in smoothly above 18 m/s
  const baseSpeedSpan = Math.max(12, preset.maxSpeed - 18);
  const speedFactor = Math.max(0, Math.min(1.35, (absSpeed - 18) / baseSpeedSpan));

  let boostRadial = 0;
  let boostTintMode: 0 | 1 | 2 | 3 = 0;

  if (kart.cwwActive) {
    boostRadial = 0.72;
    boostTintMode = 3;
  } else if (kart.nitroTimer > 0) {
    boostRadial = 0.54;
    boostTintMode = 2;
  } else if (kart.padBoostTimer > 0) {
    boostRadial = 0.42;
    boostTintMode = 2;
  } else if (kart.miniBoostTimer > 0) {
    boostRadial = 0.32;
    boostTintMode = 1;
  } else if (kart.drifting && kart.driftTier > 0) {
    boostRadial = 0.14 + kart.driftTier * 0.1;
    boostTintMode = kart.driftTier === 3 ? 3 : kart.driftTier === 2 ? 1 : 2;
  }

  const radialStrength = Math.max(0, Math.min(1, speedFactor * 0.42 + boostRadial));

  // Lateral angular whip blur during high-speed drifting and cornering
  const driftFactor = kart.drifting
    ? kart.driftSlipAngle * 1.15 + kart.steerAngle * 0.42
    : kart.driftSlipAngle * 0.75 + kart.steerAngle * 0.22;
  const speedScale = Math.max(0, Math.min(1.25, absSpeed / 26));
  const lateralBlurX = Math.max(-1, Math.min(1, -driftFactor * speedScale)) || 0;

  // Shift radial vanishing point slightly into the drift apex
  const centerX = Math.max(0.32, Math.min(0.68, 0.5 + kart.driftSlipAngle * 0.16));
  const centerY = boostRadial > 0.35 ? 0.48 : 0.45;

  // Overall combined post-processing intensity [0..1]
  const rawIntensity = Math.max(
    radialStrength,
    Math.min(1, Math.hypot(radialStrength, Math.abs(lateralBlurX) * 0.85))
  );
  const intensity = absSpeed < 8 && boostRadial === 0 ? 0 : Math.max(0, Math.min(1, rawIntensity));

  const chromaticAmount =
    (boostRadial * 0.009 + Math.abs(lateralBlurX) * 0.004 + speedFactor * 0.002) * intensity;

  return {
    intensity,
    radialStrength,
    lateralBlurX,
    centerX,
    centerY,
    chromaticAmount: Math.min(0.014, chromaticAmount),
    boostTintMode,
  };
}


