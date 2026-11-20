import test from 'node:test';
import assert from 'node:assert/strict';
import { CITIES, getCityById, resolveWeatherForState, WEATHER_LABELS } from './cities';
import { getRacerPreset } from './racers';
import {
  buildTrackData,
  clearSkidMarkPool,
  computeAiInput,
  computeCameraMotionBlurParams,
  computeRaceStandings,
  createGridKartState,
  createSkidMarkPool,
  isKartWrongWay,
  stepKartPhysics,
  stepSkidMarkPool,
} from './physics';
import {
  clampModelScale,
  clampSeatOffsetY,
  classifyModelFileName,
  computeModelNormalizationTransform,
  normalizeQuarterTurns,
  planBatchModelFiles,
  validateModelFileName,
} from './modelUtils';
import { InputState, WeatherType } from './types';

const idleInput: InputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  drift: false,
  nitroJustPressed: false,
  miniBoostJustPressed: false,
};

test('all 10 world cities build valid closed track splines with positive length', () => {
  assert.equal(CITIES.length, 10);
  const ids = new Set<string>();
  const weatherTypes = new Set<WeatherType>();
  for (const city of CITIES) {
    ids.add(city.id);
    weatherTypes.add(city.defaultWeather);
    assert.ok(WEATHER_LABELS[city.defaultWeather], `${city.id} should have valid weather label`);
    const track = buildTrackData(city, 180);
    assert.ok(track.totalLength > 600, `${city.id} expanded track should be > 600m, got ${track.totalLength}`);
    assert.equal(track.samples.length, 180);
    // Check no NaN coordinates
    for (const s of track.samples) {
      assert.ok(Number.isFinite(s.point.x) && Number.isFinite(s.point.z));
      assert.ok(Math.abs(Math.hypot(s.right.x, s.right.z) - 1) < 0.01);
    }
  }
  assert.equal(ids.size, 10);
  assert.ok(weatherTypes.has('rain'), 'Expected at least one city with rain weather');
  assert.ok(weatherTypes.has('snow'), 'Expected at least one city with snow weather');
  assert.ok(weatherTypes.has('fog'), 'Expected at least one city with dense fog weather');
  assert.ok(weatherTypes.has('sunset'), 'Expected at least one city with sunset weather');
});

test('dynamic weather resolution handles city default, overrides, and cyclic progression', () => {
  assert.equal(resolveWeatherForState('rain', 'city', 120), 'rain');
  assert.equal(resolveWeatherForState('rain', 'snow', 15), 'snow');
  assert.equal(resolveWeatherForState('rain', 'fog', 15), 'fog');
  assert.equal(resolveWeatherForState('rain', 'sunset', 15), 'sunset');

  const phase0 = resolveWeatherForState('clear', 'dynamic', 0);
  const phase1 = resolveWeatherForState('clear', 'dynamic', 28);
  const phase2 = resolveWeatherForState('clear', 'dynamic', 56);
  const phase3 = resolveWeatherForState('clear', 'dynamic', 84);
  const phase4 = resolveWeatherForState('clear', 'dynamic', 112);
  assert.deepEqual([phase0, phase1, phase2, phase3, phase4], ['clear', 'sunset', 'rain', 'fog', 'snow']);
});

test('kart accelerates smoothly from grid and stays inside road bounds', () => {
  const track = buildTrackData(getCityById('tokyo'));
  const preset = getRacerPreset('blaze');
  const kart = createGridKartState({
    id: 'p1',
    name: 'Player',
    racerId: preset.id,
    isPlayer: true,
    isRemote: false,
    gridSlot: 0,
    track,
  });

  // Kart should face forward along track at spawn (not wrong way)
  assert.equal(isKartWrongWay(kart, track), false);

  for (let i = 0; i < 60; i++) {
    stepKartPhysics(kart, { ...idleInput, forward: true }, preset, track, 1 / 60, 3, i * 16);
  }
  assert.ok(kart.speed > 20, `Expected speed > 20 m/s after 1s gas, got ${kart.speed}`);
  assert.ok(
    Math.abs(kart.lateralOffset) <= track.city.roadWidth * 0.5,
    'Kart must remain clamped within track guardrails'
  );
});

test('drifting charges nitro canisters, triggers mini-boost and CWW combo', () => {
  const track = buildTrackData(getCityById('paris'));
  const preset = getRacerPreset('sakura');
  const kart = createGridKartState({
    id: 'p1',
    name: 'Sakura',
    racerId: preset.id,
    isPlayer: true,
    isRemote: false,
    gridSlot: 0,
    track,
  });

  kart.speed = 45;
  kart.nitroGauge = 40;
  kart.nitroCharges = 0;

  // Drift left for 1.8s -> should fill nitro canister and reach tier 3
  for (let i = 0; i < 108; i++) {
    stepKartPhysics(
      kart,
      { ...idleInput, forward: true, left: true, drift: true },
      preset,
      track,
      1 / 60,
      3,
      i * 16
    );
  }

  assert.equal(kart.drifting, true);
  assert.equal(kart.driftTier, 3);
  assert.ok(kart.nitroCharges >= 1, `Expected >= 1 nitro canister, got ${kart.nitroCharges}`);

  // Release drift while holding forward -> triggers Mini-Boost
  const releaseRes = stepKartPhysics(
    kart,
    { ...idleInput, forward: true, drift: false },
    preset,
    track,
    1 / 60,
    3,
    2000
  );
  assert.equal(releaseRes.triggeredMiniBoost, true);
  assert.ok(kart.miniBoostTimer > 0);

  // Fire Nitro while Mini-Boost is active -> triggers CWW Combo!
  const nitroRes = stepKartPhysics(
    kart,
    { ...idleInput, forward: true, nitroJustPressed: true },
    preset,
    track,
    1 / 60,
    3,
    2050
  );
  assert.equal(nitroRes.triggeredNitro, true);
  assert.equal(nitroRes.triggeredCww, true);
  assert.equal(kart.cwwActive, true);
});

test('AI racer completes checkpoints and finishes a 1-lap race cleanly', () => {
  const track = buildTrackData(getCityById('hanoi'));
  const preset = getRacerPreset('lotus');
  const kart = createGridKartState({
    id: 'ai_1',
    name: 'AI Lotus',
    racerId: preset.id,
    isPlayer: false,
    isRemote: false,
    gridSlot: 1,
    track,
  });

  let timeMs = 0;
  const dt = 0.04;
  for (let step = 0; step < 1600 && !kart.finished; step++) {
    const aiInput = computeAiInput(kart, track, timeMs / 1000);
    stepKartPhysics(kart, aiInput, preset, track, dt, 1, timeMs);
    timeMs += dt * 1000;
  }

  assert.equal(kart.finished, true, 'AI kart should complete 1 lap on expanded Hanoi track within 64s');
  assert.ok(kart.finishTimeMs !== null && kart.finishTimeMs > 5000);
});

test('standings sort finished racers by time ahead of in-progress racers by progress', () => {
  const track = buildTrackData(getCityById('dubai'));
  const k1 = createGridKartState({
    id: 'k1',
    name: 'A',
    racerId: 'blaze',
    isPlayer: true,
    isRemote: false,
    gridSlot: 0,
    track,
  });
  const k2 = createGridKartState({
    id: 'k2',
    name: 'B',
    racerId: 'volt',
    isPlayer: false,
    isRemote: false,
    gridSlot: 1,
    track,
  });
  const k3 = createGridKartState({
    id: 'k3',
    name: 'C',
    racerId: 'apex',
    isPlayer: false,
    isRemote: false,
    gridSlot: 2,
    track,
  });

  k1.finished = true;
  k1.finishTimeMs = 45000;
  k2.finished = true;
  k2.finishTimeMs = 42000;
  k3.finished = false;
  k3.totalProgress = 2.9;

  const ordered = computeRaceStandings([k1, k2, k3]);
  assert.deepEqual(
    ordered.map((k) => k.id),
    ['k2', 'k1', 'k3']
  );
});

test('dynamic tire track pool emits dual rear-wheel skid marks during drifting, fades opacity, and bounds memory via ring buffer', () => {
  const track = buildTrackData(getCityById('tokyo'));
  const preset = getRacerPreset('blaze');
  const kart = createGridKartState({
    id: 'p1',
    name: 'Drifter',
    racerId: preset.id,
    isPlayer: true,
    isRemote: false,
    gridSlot: 0,
    track,
  });

  const pool = createSkidMarkPool(24, 3.0);
  assert.equal(pool.activeCount, 0);

  // Driving straight without drift should NOT emit skid marks
  kart.speed = 38;
  for (let i = 0; i < 15; i++) {
    stepKartPhysics(kart, { ...idleInput, forward: true }, preset, track, 1 / 60, 3, i * 16);
    stepSkidMarkPool(pool, [kart], 1 / 60);
  }
  assert.equal(pool.activeCount, 0, 'Straight driving should not emit skid marks');

  // Intense drifting left at high speed should emit paired left/right rear tire track segments
  for (let i = 0; i < 90; i++) {
    stepKartPhysics(
      kart,
      { ...idleInput, forward: true, left: true, drift: true },
      preset,
      track,
      1 / 60,
      3,
      (i + 20) * 16
    );
    stepSkidMarkPool(pool, [kart], 1 / 60);
  }

  assert.ok(pool.activeCount > 0, 'Drifting should emit active skid mark segments');
  assert.ok(
    pool.activeCount <= pool.capacity,
    `Ring buffer must strictly cap memory at capacity ${pool.capacity}, got ${pool.activeCount}`
  );
  assert.equal(pool.activeCount % 2, 0, 'Skid marks should be emitted in dual rear-wheel pairs');

  // Stop drifting and verify skid marks fade out over time and expire cleanly
  kart.drifting = false;
  kart.driftSlipAngle = 0;
  kart.speed = 0;

  stepSkidMarkPool(pool, [kart], 1.5);
  const midFadeSegments = pool.segments.filter((s) => s.active);
  assert.ok(midFadeSegments.length > 0);
  for (const s of midFadeSegments) {
    assert.ok(s.opacity > 0 && s.opacity < 0.85, `Expected faded opacity in (0, 0.85), got ${s.opacity}`);
  }

  // Advance past maxLife (3.0s total) -> all segments must fade out and deactivate
  stepSkidMarkPool(pool, [kart], 2.0);
  assert.equal(pool.activeCount, 0, 'All skid marks must expire after maxLife to free visual slots');

  clearSkidMarkPool(pool);
  assert.equal(pool.activeCount, 0);
});

test('camera motion blur parameters scale with high-speed drifting, Nitro N2O, and CWW combo', () => {
  const track = buildTrackData(getCityById('tokyo'));
  const preset = getRacerPreset('blaze');
  const kart = createGridKartState({
    id: 'p1',
    name: 'BlurTest',
    racerId: preset.id,
    isPlayer: true,
    isRemote: false,
    gridSlot: 0,
    track,
  });

  // 1. Stationary at grid -> zero motion blur
  const idleBlur = computeCameraMotionBlurParams(kart, preset);
  assert.equal(idleBlur.intensity, 0);
  assert.equal(idleBlur.radialStrength, 0);
  assert.equal(idleBlur.lateralBlurX, 0);

  // 2. High-speed drifting left -> strong lateral angular whip blur & shifted vanishing point
  kart.speed = 46;
  kart.drifting = true;
  kart.driftDir = 1;
  kart.driftTier = 2;
  kart.driftSlipAngle = 0.42;
  kart.steerAngle = 0.38;
  const driftBlur = computeCameraMotionBlurParams(kart, preset);
  assert.ok(driftBlur.intensity > 0.45, `Expected drift blur intensity > 0.45, got ${driftBlur.intensity}`);
  assert.ok(driftBlur.lateralBlurX < -0.4, `Expected negative lateral whip blur during left drift, got ${driftBlur.lateralBlurX}`);
  assert.ok(driftBlur.centerX > 0.54, `Expected vanishing point shifted toward drift apex, got ${driftBlur.centerX}`);

  // 3. Nitro N2O & CWW Combo -> elevated radial velocity zoom blur & chromatic dispersion
  kart.drifting = false;
  kart.driftSlipAngle = 0;
  kart.steerAngle = 0;
  kart.speed = 62;
  kart.nitroTimer = 2.5;
  const nitroBlur = computeCameraMotionBlurParams(kart, preset);
  assert.equal(nitroBlur.boostTintMode, 2);
  assert.ok(nitroBlur.radialStrength > 0.75, `Expected strong radial blur on Nitro, got ${nitroBlur.radialStrength}`);

  kart.cwwActive = true;
  const cwwBlur = computeCameraMotionBlurParams(kart, preset);
  assert.equal(cwwBlur.boostTintMode, 3);
  assert.ok(cwwBlur.radialStrength > nitroBlur.radialStrength, 'CWW Combo should exceed standard Nitro radial blur');
  assert.ok(cwwBlur.chromaticAmount > 0.005, 'CWW Combo should enable peripheral chromatic speed dispersion');
});

test('custom 3D kart & driver GLB normalization centers X/Z, grounds minY=0, and clamps transforms', () => {
  assert.deepEqual(validateModelFileName('super_kart_blender.GLB'), { ok: true, ext: '.glb' });
  assert.deepEqual(validateModelFileName('driver_mixamo.gltf'), { ok: true, ext: '.gltf' });
  assert.equal(validateModelFileName('car_mesh.obj').ok, false);

  // Oversized kart exported off-origin from Blender (length 13m, offset Y bottom at -2.5m)
  const kartNorm = computeModelNormalizationTransform(
    { x: -1.5, y: -2.5, z: 2.0 },
    { x: 4.5, y: 1.5, z: 15.0 },
    'kart',
    1,
    1.0
  );
  assert.ok(kartNorm.normalizedDepth <= 3.251, `Normalized kart depth must fit <= 3.25m, got ${kartNorm.normalizedDepth}`);
  assert.ok(kartNorm.normalizedHeight <= 1.901, `Normalized kart height must fit <= 1.9m, got ${kartNorm.normalizedHeight}`);
  // Bottom grounded at y=0: boxMin.y * scale + offsetY === 0
  assert.ok(Math.abs(-2.5 * kartNorm.scale + kartNorm.offsetY) < 1e-6);
  // Center X/Z anchored at 0: center * scale + offset === 0
  assert.ok(Math.abs(1.5 * kartNorm.scale + kartNorm.offsetX) < 1e-6);
  assert.ok(Math.abs(8.5 * kartNorm.scale + kartNorm.offsetZ) < 1e-6);
  assert.ok(Math.abs(kartNorm.rotationY - Math.PI / 2) < 1e-6);

  // Driver model exported in centimeters (180cm tall) -> scales cleanly to <= 1.15m cockpit height
  const driverNorm = computeModelNormalizationTransform(
    { x: -30, y: 0, z: -20 },
    { x: 30, y: 180, z: 20 },
    'driver',
    -1,
    1.2
  );
  assert.ok(Math.abs(driverNorm.normalizedHeight - 1.15 * 1.2) < 1e-5);
  assert.equal(normalizeQuarterTurns(-1), 3);
  assert.equal(normalizeQuarterTurns(5), 1);
  assert.equal(clampModelScale(3.0), 1.8);
  assert.equal(clampModelScale(0.1), 0.5);
  assert.equal(clampSeatOffsetY(-2.0), -0.5);
  assert.equal(clampSeatOffsetY(2.0), 0.85);
});

test('multi-model batch planner classifies mixed kart/driver GLB files and separates GLTF companion textures', () => {
  assert.equal(classifyModelFileName('f1_cyber_kart.glb'), 'kart');
  assert.equal(classifyModelFileName('xe_dua_rong.glb'), 'kart');
  assert.equal(classifyModelFileName('anime_driver_mixamo.glb'), 'driver');
  assert.equal(classifyModelFileName('nhan_vat_nu.gltf'), 'driver');
  assert.equal(classifyModelFileName('asset_01.glb'), null);

  const mixedPlan = planBatchModelFiles([
    { name: 'hyper_car.glb' },
    { name: 'pilot_knight.glb' },
    { name: 'custom_mesh.gltf' },
    { name: 'custom_mesh.bin' },
    { name: 'albedo.png' },
    { name: 'readme.txt' },
  ]);

  assert.equal(mixedPlan.items.length, 3);
  assert.equal(mixedPlan.items[0].kind, 'kart');
  assert.equal(mixedPlan.items[1].kind, 'driver');
  assert.equal(mixedPlan.items[2].kind, 'kart'); // ambiguous falls back to kart
  assert.deepEqual(
    mixedPlan.companionFiles.map((f) => f.name),
    ['custom_mesh.bin', 'albedo.png']
  );
  assert.deepEqual(mixedPlan.rejectedNames, ['readme.txt']);

  // Explicit slot override routes every selected model into that slot
  const explicitDriverPlan = planBatchModelFiles(
    [{ name: 'hyper_car.glb' }, { name: 'hero.glb' }],
    'driver'
  );
  assert.ok(explicitDriverPlan.items.every((item) => item.kind === 'driver'));
});


