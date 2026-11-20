import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  CityId,
  GamePhase,
  InputState,
  KartState,
  MultiplayerPlayer,
  RaceFinishSummary,
  RaceHudSnapshot,
  RemoteTelemetry,
  TrackData,
  WeatherSetting,
  WeatherType,
} from './types';
import { getCityById, resolveWeatherForState, WEATHER_LABELS } from './cities';
import { getRacerPreset, RACER_PRESETS } from './racers';
import {
  buildTrackData,
  CameraMotionBlurParams,
  clearSkidMarkPool,
  computeAiInput,
  computeCameraMotionBlurParams,
  computeRaceStandings,
  createGridKartState,
  createSkidMarkPool,
  isKartWrongWay,
  normalizeAngle,
  SkidMarkPool,
  stepKartPhysics,
  stepSkidMarkPool,
} from './physics';
import {
  buildCityWorld,
  CityWorldRefs,
  cloneCustomModelInstance,
  createKartAndDriver,
  disposeObject3D,
  KartRig,
  loadCustomGLBModel,
  updateCityCrowd,
} from './models';
import {
  clampModelScale,
  clampSeatOffsetY,
  CustomModelSummaryItem,
  ModelSlotKind,
  normalizeQuarterTurns,
  planBatchModelFiles,
} from './modelUtils';
import { createVolumetricFogTexture } from './textures';
import { RacingAudio } from './audio';

export interface BatchModelLoadResult {
  loadedKarts: string[];
  loadedDrivers: string[];
  errors: string[];
}

export interface CustomModelState {
  kartName: string | null;
  kartYawSteps: number;
  kartScale: number;
  activeKartId: string | null;
  karts: CustomModelSummaryItem[];
  driverName: string | null;
  driverYawSteps: number;
  driverScale: number;
  driverSeatOffsetY: number;
  driverVisible: boolean;
  activeDriverId: string | null;
  drivers: CustomModelSummaryItem[];
  applyLibraryToAiRivals: boolean;
}

interface CustomModelEntry {
  id: string;
  name: string;
  kind: ModelSlotKind;
  template: THREE.Group;
  yawSteps: number;
  scale: number;
  seatOffsetY: number;
}

export interface EngineCallbacks {
  onHudUpdate: (hud: RaceHudSnapshot) => void;
  onFinish: (summary: RaceFinishSummary) => void;
  onTelemetrySend?: (state: Omit<RemoteTelemetry, 'id'>) => void;
  onLocalFinished?: (finishTimeMs: number) => void;
  onPhaseChange?: (phase: GamePhase) => void;
}

interface Particle {
  active: boolean;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: THREE.Color;
}

interface RemoteTarget {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  drifting: boolean;
  driftDir: number;
  nitroActive: boolean;
  lap: number;
  progress: number;
  updatedAt: number;
}

const CameraMotionBlurShader = {
  name: 'CameraMotionBlurShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uIntensity: { value: 0.0 },
    uRadialStrength: { value: 0.0 },
    uLateralBlurX: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.46) },
    uChromatic: { value: 0.0 },
    uBoostTint: { value: new THREE.Vector3(0.13, 0.83, 0.93) },
    uBoostTintStrength: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uRadialStrength;
    uniform float uLateralBlurX;
    uniform vec2 uCenter;
    uniform float uChromatic;
    uniform vec3 uBoostTint;
    uniform float uBoostTintStrength;
    varying vec2 vUv;

    void main() {
      vec4 baseSample = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.004) {
        gl_FragColor = baseSample;
        return;
      }

      // Keep the hero kart & driver razor-sharp in the lower-center foreground
      vec2 kartDelta = (vUv - vec2(0.5, 0.25)) * vec2(1.22, 1.72);
      float kartFocusMask = smoothstep(0.18, 0.48, length(kartDelta));

      vec2 toCenter = uCenter - vUv;
      float distFromCenter = length(toCenter);
      float radialMask = smoothstep(0.06, 0.72, distFromCenter);

      // Combine radial zoom blur toward vanishing point + directional angular whip during drift
      vec2 radialVec = toCenter * (uRadialStrength * 0.115 * radialMask);
      vec2 lateralVec = vec2(
        uLateralBlurX * 0.048 * (0.35 + 0.65 * distFromCenter),
        -abs(uLateralBlurX) * 0.01 * (vUv.x - 0.5) * sign(uLateralBlurX)
      );
      vec2 blurVec = (radialVec + lateralVec) * kartFocusMask * uIntensity;

      vec3 accum = vec3(0.0);
      float totalWeight = 0.0;

      // 10-tap weighted directional & radial velocity accumulation with chromatic dispersion
      for (int i = 0; i < 10; i++) {
        float t = float(i) / 9.0;
        float weight = 1.0 - t * 0.52;
        vec2 sampleUv = clamp(vUv + blurVec * t, vec2(0.001), vec2(0.999));

        if (uChromatic > 0.0002 && i > 0) {
          vec2 chromaOffset = blurVec * (t * uChromatic * 18.0);
          float r = texture2D(tDiffuse, clamp(sampleUv + chromaOffset, vec2(0.001), vec2(0.999))).r;
          float g = texture2D(tDiffuse, sampleUv).g;
          float b = texture2D(tDiffuse, clamp(sampleUv - chromaOffset, vec2(0.001), vec2(0.999))).b;
          accum += vec3(r, g, b) * weight;
        } else {
          accum += texture2D(tDiffuse, sampleUv).rgb * weight;
        }
        totalWeight += weight;
      }

      vec3 blurred = accum / max(0.0001, totalWeight);

      // Subtle peripheral speed tunnel-vision & boost energy rim glow
      float peripheralRim = smoothstep(0.42, 0.88, distFromCenter) * kartFocusMask * uIntensity;
      blurred = mix(blurred, blurred * 0.9 + uBoostTint * uBoostTintStrength, peripheralRim * 0.42);

      gl_FragColor = vec4(blurred, baseSample.a);
    }
  `,
};

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class NitroDriftEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private motionBlurPass: ShaderPass;
  private outputPass: OutputPass;
  private motionBlurState: CameraMotionBlurParams = {
    intensity: 0,
    radialStrength: 0,
    lateralBlurX: 0,
    centerX: 0.5,
    centerY: 0.46,
    chromaticAmount: 0,
    boostTintMode: 0,
  };
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private isSoftwareGl: boolean;
  private audio = new RacingAudio();

  private phase: GamePhase = 'title';
  private cityId: CityId = 'tokyo';
  private weatherSetting: WeatherSetting = 'city';
  private activeWeather: WeatherType = 'rain';
  private weatherCycleElapsed = 0;
  private playerRacerId = 'blaze';
  private playerName = 'Tay Đua';
  private totalLaps = 3;
  private cameraMode: 'chase' | 'close' = 'chase';

  private track: TrackData;
  private worldGroup: THREE.Group | null = null;
  private worldRefs: CityWorldRefs | null = null;
  private boostPadMaterials: THREE.MeshStandardMaterial[] = [];

  private karts: KartState[] = [];
  private rigs = new Map<string, KartRig>();
  private remoteTargets = new Map<string, RemoteTarget>();
  private customModelSeq = 0;
  private customKartLibrary: CustomModelEntry[] = [];
  private activeCustomKartId: string | null = null;
  private customDriverLibrary: CustomModelEntry[] = [];
  private activeCustomDriverId: string | null = null;
  private customDriverVisible = true;
  private applyLibraryToAiRivals = false;

  // Pooled particle system (zero GC in render loop)
  private particleCount = 120;
  private particles: Particle[] = [];
  private particleCursor = 0;
  private particleMesh: THREE.InstancedMesh;

  // Pooled weather particle system (rain streaks, snowflakes, fog mist droplets, sunset motes)
  private weatherCount = 320;
  private weatherDrops: Array<{ ox: number; oy: number; oz: number; phase: number; speedMult: number }> = [];
  private weatherMesh: THREE.InstancedMesh;
  private weatherMat: THREE.MeshBasicMaterial;

  // Pooled 3D volumetric low-altitude fog & mist cloud banks (38 drifting billboards around camera)
  private fogCloudCount = 38;
  private fogClouds: Array<{
    ox: number;
    oy: number;
    oz: number;
    scaleX: number;
    scaleY: number;
    speedX: number;
    speedZ: number;
    phase: number;
  }> = [];
  private fogCloudsMesh: THREE.InstancedMesh;
  private fogCloudsMat: THREE.MeshBasicMaterial;

  // Pooled 3D wet-asphalt rain splash ripple rings (72 expanding rings on road during rain)
  private rainSplashCount = 72;
  private rainSplashes: Array<{ ox: number; oz: number; phase: number; speed: number }> = [];
  private rainSplashMesh: THREE.InstancedMesh;
  private rainSplashMat: THREE.MeshBasicMaterial;
  private lightningCooldown = 6.5;
  private lightningFlash = 0;

  // Pooled dynamic tire track / skid mark ring-buffer ribbon system (zero-GC, auto-fading over time)
  private skidPool: SkidMarkPool = createSkidMarkPool(540, 7.5);
  private skidGeo: THREE.BufferGeometry;
  private skidPosAttr: THREE.BufferAttribute;
  private skidColorAttr: THREE.BufferAttribute;
  private skidMat: THREE.MeshBasicMaterial;
  private skidMesh: THREE.Mesh;

  // Input state
  private keys = new Set<string>();
  private touchInput = { left: false, right: false, forward: false, backward: false, drift: false };
  private nitroJustPressed = false;
  private miniBoostJustPressed = false;

  // Timing & game feel
  private frameId = 0;
  private disposed = false;
  private lastPerfMs = performance.now();
  private elapsedSec = 0;
  private raceTimeMs = 0;
  private countdownTimer = 0;
  private lastCountdownBeep = 4;
  private hitstopTimer = 0;
  private trauma = 0;
  private bannerText: string | null = null;
  private bannerTimer = 0;
  private lastHudPushMs = 0;
  private finishDelayTimer = -1;
  private pendingFinishSummary: RaceFinishSummary | null = null;

  // Reusable scratch math objects (zero GC)
  private _camTargetPos = new THREE.Vector3();
  private _camLookPos = new THREE.Vector3();
  private _dummy = new THREE.Object3D();
  private _colorBlue = new THREE.Color('#38bdf8');
  private _colorOrange = new THREE.Color('#fb923c');
  private _colorPurple = new THREE.Color('#c084fc');
  private _colorWhite = new THREE.Color('#f8fafc');
  private _colorRed = new THREE.Color('#f43f5e');
  private _weatherColor = new THREE.Color('#bae6fd');
  private _targetFogColor = new THREE.Color();
  private _targetSkyTint = new THREE.Color();
  private _targetSunColor = new THREE.Color();
  private _targetHemiSky = new THREE.Color();
  private _targetGroundColor = new THREE.Color();
  private _scratchColor = new THREE.Color();

  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareGl();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Studio RoomEnvironment reflection map on every device
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(
      62,
      (container.clientWidth || window.innerWidth) / Math.max(1, container.clientHeight || window.innerHeight),
      0.5,
      900
    );

    // Post-Processing Pipeline: RenderPass -> CameraMotionBlurShader -> OutputPass (ACESFilmic + sRGB)
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.motionBlurPass = new ShaderPass(CameraMotionBlurShader);
    this.composer.addPass(this.motionBlurPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Warm/Cool Lighting Rig with Soft Real-Time Dynamic Shadow Map
    this.hemiLight = new THREE.HemisphereLight('#93c5fd', '#1e293b', 0.48);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff7ed', 2.65);
    this.sunLight.position.set(55, 65, -35);
    this.sunLight.castShadow = true;
    const shadowMapRes = this.isSoftwareGl ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowMapRes, shadowMapRes);
    const d = 48;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 220;
    this.sunLight.shadow.camera.updateProjectionMatrix();
    this.sunLight.shadow.radius = 2.6;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.015;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Pooled InstancedMesh particles (sparks + nitro flames)
    const pGeo = new THREE.OctahedronGeometry(0.18, 0);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, this.particleCount);
    this.particleMesh.frustumCulled = false;
    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 0.4,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
        color: new THREE.Color('#38bdf8'),
      });
      this._dummy.position.set(0, -100, 0);
      this._dummy.scale.setScalar(0.001);
      this._dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this._dummy.matrix);
      this.particleMesh.setColorAt(i, this._colorBlue);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.particleMesh);

    // Pooled InstancedMesh dynamic weather system (rain, snow, fog droplets, sunset motes)
    const wGeo = new THREE.BoxGeometry(0.06, 0.95, 0.06);
    this.weatherMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.weatherMesh = new THREE.InstancedMesh(wGeo, this.weatherMat, this.weatherCount);
    this.weatherMesh.frustumCulled = false;
    for (let i = 0; i < this.weatherCount; i++) {
      this.weatherDrops.push({
        ox: (Math.random() - 0.5) * 62,
        oy: Math.random() * 28,
        oz: (Math.random() - 0.5) * 62,
        phase: Math.random() * Math.PI * 2,
        speedMult: 0.8 + Math.random() * 0.48,
      });
      this._dummy.position.set(0, -100, 0);
      this._dummy.scale.setScalar(0.001);
      this._dummy.updateMatrix();
      this.weatherMesh.setMatrixAt(i, this._dummy.matrix);
      this.weatherMesh.setColorAt(i, this._weatherColor);
    }
    this.weatherMesh.instanceMatrix.needsUpdate = true;
    if (this.weatherMesh.instanceColor) this.weatherMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.weatherMesh);

    // Pooled 3D Volumetric Fog & Mist Cloud Banks (adds deep atmospheric layering to cities)
    const fogTex = createVolumetricFogTexture();
    const fogGeo = new THREE.PlaneGeometry(22, 10);
    this.fogCloudsMat = new THREE.MeshBasicMaterial({
      map: fogTex,
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fogCloudsMesh = new THREE.InstancedMesh(fogGeo, this.fogCloudsMat, this.fogCloudCount);
    this.fogCloudsMesh.frustumCulled = false;
    for (let i = 0; i < this.fogCloudCount; i++) {
      this.fogClouds.push({
        ox: (Math.random() - 0.5) * 116,
        oy: 1.4 + Math.random() * 13.5,
        oz: (Math.random() - 0.5) * 116,
        scaleX: 0.85 + Math.random() * 1.15,
        scaleY: 0.75 + Math.random() * 0.85,
        speedX: (Math.random() - 0.5) * 3.2,
        speedZ: (Math.random() - 0.5) * 3.2,
        phase: Math.random() * Math.PI * 2,
      });
      this._dummy.position.set(0, -100, 0);
      this._dummy.scale.setScalar(0.001);
      this._dummy.updateMatrix();
      this.fogCloudsMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.fogCloudsMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.fogCloudsMesh);

    // Pooled 3D Wet-Road Rain Splash Ripple Rings
    const splashGeo = new THREE.RingGeometry(0.11, 0.19, 14);
    splashGeo.rotateX(-Math.PI / 2);
    this.rainSplashMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.rainSplashMesh = new THREE.InstancedMesh(splashGeo, this.rainSplashMat, this.rainSplashCount);
    this.rainSplashMesh.frustumCulled = false;
    for (let i = 0; i < this.rainSplashCount; i++) {
      this.rainSplashes.push({
        ox: (Math.random() - 0.5) * 36,
        oz: (Math.random() - 0.5) * 36,
        phase: Math.random(),
        speed: 1.6 + Math.random() * 1.2,
      });
      this._dummy.position.set(0, -100, 0);
      this._dummy.scale.setScalar(0.001);
      this._dummy.updateMatrix();
      this.rainSplashMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.rainSplashMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rainSplashMesh);

    // Pooled Dynamic Tire Track / Skid Mark Ribbon Mesh (540 pre-allocated quads with RGBA fade)
    const skidCap = this.skidPool.capacity;
    const skidPositions = new Float32Array(skidCap * 4 * 3);
    const skidColors = new Float32Array(skidCap * 4 * 4);
    const skidIndices = new Uint16Array(skidCap * 6);
    for (let i = 0; i < skidCap; i++) {
      const v = i * 4;
      const idx = i * 6;
      skidIndices[idx] = v;
      skidIndices[idx + 1] = v + 1;
      skidIndices[idx + 2] = v + 2;
      skidIndices[idx + 3] = v + 2;
      skidIndices[idx + 4] = v + 1;
      skidIndices[idx + 5] = v + 3;
    }
    this.skidGeo = new THREE.BufferGeometry();
    this.skidPosAttr = new THREE.BufferAttribute(skidPositions, 3);
    this.skidPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.skidColorAttr = new THREE.BufferAttribute(skidColors, 4);
    this.skidColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.skidGeo.setAttribute('position', this.skidPosAttr);
    this.skidGeo.setAttribute('color', this.skidColorAttr);
    this.skidGeo.setIndex(new THREE.BufferAttribute(skidIndices, 1));

    this.skidMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.skidMesh = new THREE.Mesh(this.skidGeo, this.skidMat);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 2;
    this.scene.add(this.skidMesh);

    (window as unknown as { __nitroEngine?: NitroDriftEngine }).__nitroEngine = this;

    // Load initial Tokyo track & showcase grid
    this.track = buildTrackData(getCityById(this.cityId));
    this.rebuildWorld(this.cityId);
    this.spawnSoloGrid();
    this.positionTitleCamera(0);
    this.updateWeatherSystem(0.016, true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Bind events
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.lastPerfMs = performance.now();
    this.pushHud(true);
    this.tick();
  }

  public getTrackData(): TrackData {
    return this.track;
  }

  public getActiveSkidMarkCount(): number {
    return this.skidPool.activeCount;
  }

  public getMotionBlurState(): CameraMotionBlurParams {
    return { ...this.motionBlurState };
  }

  public setCallbacks(cb: EngineCallbacks): void {
    this.callbacks = cb;
  }

  public setCity(cityId: CityId): void {
    if (this.cityId === cityId && this.worldGroup) return;
    this.cityId = cityId;
    this.rebuildWorld(cityId);
    if (this.phase === 'title') {
      this.spawnSoloGrid();
    }
    this.updateWeatherSystem(0.016, true);
    this.pushHud(true);
  }

  public setWeatherSetting(setting: WeatherSetting): void {
    this.weatherSetting = setting;
    this.weatherCycleElapsed = 0;
    const city = getCityById(this.cityId);
    this.activeWeather = resolveWeatherForState(city.defaultWeather, this.weatherSetting, 0);
    this.updateWeatherSystem(0.016, true);
    this.pushHud(true);
  }

  public getWeatherSetting(): WeatherSetting {
    return this.weatherSetting;
  }

  public setPlayerProfile(name: string, racerId: string): void {
    this.playerName = name.trim() || 'Tay Đua';
    this.playerRacerId = racerId;
    if (this.phase === 'title') {
      this.spawnSoloGrid();
      this.renderFrame();
    }
    this.pushHud(true);
  }

  private getActiveKartEntry(): CustomModelEntry | null {
    if (!this.activeCustomKartId) return null;
    return this.customKartLibrary.find((m) => m.id === this.activeCustomKartId) ?? null;
  }

  private getActiveDriverEntry(): CustomModelEntry | null {
    if (!this.activeCustomDriverId) return null;
    return this.customDriverLibrary.find((m) => m.id === this.activeCustomDriverId) ?? null;
  }

  public getCustomModelState(): CustomModelState {
    const activeKart = this.getActiveKartEntry();
    const activeDriver = this.getActiveDriverEntry();
    return {
      kartName: activeKart?.name ?? null,
      kartYawSteps: activeKart?.yawSteps ?? 0,
      kartScale: activeKart?.scale ?? 1,
      activeKartId: activeKart?.id ?? null,
      karts: this.customKartLibrary.map((k) => ({
        id: k.id,
        name: k.name,
        kind: k.kind,
        yawSteps: k.yawSteps,
        scale: k.scale,
        seatOffsetY: k.seatOffsetY,
      })),
      driverName: activeDriver?.name ?? null,
      driverYawSteps: activeDriver?.yawSteps ?? 0,
      driverScale: activeDriver?.scale ?? 1,
      driverSeatOffsetY: activeDriver?.seatOffsetY ?? 0,
      driverVisible: this.customDriverVisible,
      activeDriverId: activeDriver?.id ?? null,
      drivers: this.customDriverLibrary.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        yawSteps: d.yawSteps,
        scale: d.scale,
        seatOffsetY: d.seatOffsetY,
      })),
      applyLibraryToAiRivals: this.applyLibraryToAiRivals,
    };
  }

  public async addCustomModelsFromFiles(
    fileInput: File[] | FileList,
    explicitKind?: ModelSlotKind
  ): Promise<BatchModelLoadResult> {
    const files = Array.from(fileInput);
    const plan = planBatchModelFiles(files, explicitKind);
    const loadedKarts: string[] = [];
    const loadedDrivers: string[] = [];
    const errors: string[] = plan.rejectedNames.map(
      (n) => `${n}: định dạng không hỗ trợ (chỉ nhận .glb / .gltf)`
    );

    if (plan.items.length === 0) {
      if (errors.length === 0) {
        errors.push('Không tìm thấy file model .glb hoặc .gltf hợp lệ.');
      }
      return { loadedKarts, loadedDrivers, errors };
    }

    const results = await Promise.allSettled(
      plan.items.map(async (item) => {
        const template = await loadCustomGLBModel(item.file, item.kind, plan.companionFiles);
        return { name: item.file.name, kind: item.kind, template };
      })
    );

    let lastKartId: string | null = null;
    let lastDriverId: string | null = null;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const item = plan.items[i];
      if (res.status === 'fulfilled') {
        const id = `${res.value.kind}_${++this.customModelSeq}`;
        const entry: CustomModelEntry = {
          id,
          name: res.value.name,
          kind: res.value.kind,
          template: res.value.template,
          yawSteps: 0,
          scale: 1,
          seatOffsetY: 0,
        };
        if (res.value.kind === 'kart') {
          this.customKartLibrary.push(entry);
          loadedKarts.push(entry.name);
          lastKartId = id;
        } else {
          this.customDriverLibrary.push(entry);
          loadedDrivers.push(entry.name);
          lastDriverId = id;
        }
      } else {
        const reason =
          res.reason instanceof Error && res.reason.message
            ? res.reason.message
            : 'Không thể đọc cấu trúc 3D';
        errors.push(`${item.file.name}: ${reason}`);
      }
    }

    if (lastKartId) {
      this.activeCustomKartId = lastKartId;
    }
    if (lastDriverId) {
      this.activeCustomDriverId = lastDriverId;
      this.customDriverVisible = true;
    }

    if (loadedKarts.length > 0 || loadedDrivers.length > 0) {
      this.applyCustomModelsToAllRigs(true);
    }

    return { loadedKarts, loadedDrivers, errors };
  }

  public async setCustomKartFromFile(file: File): Promise<string> {
    const res = await this.addCustomModelsFromFiles([file], 'kart');
    if (res.loadedKarts.length === 0) {
      throw new Error(res.errors[0] || 'Không thể nạp model Xe Kart 3D.');
    }
    return res.loadedKarts[0];
  }

  public selectCustomKart(id: string | null): CustomModelState {
    if (id === null || this.customKartLibrary.some((k) => k.id === id)) {
      this.activeCustomKartId = id;
      this.applyCustomModelsToAllRigs(true);
    }
    return this.getCustomModelState();
  }

  public removeCustomKart(id: string): CustomModelState {
    const idx = this.customKartLibrary.findIndex((k) => k.id === id);
    if (idx !== -1) {
      const [removed] = this.customKartLibrary.splice(idx, 1);
      disposeObject3D(removed.template);
      if (this.activeCustomKartId === id) {
        this.activeCustomKartId =
          this.customKartLibrary[this.customKartLibrary.length - 1]?.id ?? null;
      }
      this.applyCustomModelsToAllRigs(true);
    }
    return this.getCustomModelState();
  }

  public clearCustomKart(): void {
    this.activeCustomKartId = null;
    this.applyCustomModelsToAllRigs(true);
  }

  public clearAllCustomKarts(): CustomModelState {
    for (const entry of this.customKartLibrary) {
      disposeObject3D(entry.template);
    }
    this.customKartLibrary = [];
    this.activeCustomKartId = null;
    this.applyCustomModelsToAllRigs(true);
    return this.getCustomModelState();
  }

  public setCustomKartTransform(yawSteps: number, scale: number): CustomModelState {
    const active = this.getActiveKartEntry();
    if (active) {
      active.yawSteps = normalizeQuarterTurns(yawSteps);
      active.scale = clampModelScale(scale);
      this.applyCustomModelsToAllRigs(true);
    }
    return this.getCustomModelState();
  }

  public async setCustomDriverFromFile(file: File): Promise<string> {
    const res = await this.addCustomModelsFromFiles([file], 'driver');
    if (res.loadedDrivers.length === 0) {
      throw new Error(res.errors[0] || 'Không thể nạp model Nhân Vật 3D.');
    }
    return res.loadedDrivers[0];
  }

  public selectCustomDriver(id: string | null): CustomModelState {
    if (id === null || this.customDriverLibrary.some((d) => d.id === id)) {
      this.activeCustomDriverId = id;
      if (id !== null) this.customDriverVisible = true;
      this.applyCustomModelsToAllRigs(true);
    }
    return this.getCustomModelState();
  }

  public removeCustomDriver(id: string): CustomModelState {
    const idx = this.customDriverLibrary.findIndex((d) => d.id === id);
    if (idx !== -1) {
      const [removed] = this.customDriverLibrary.splice(idx, 1);
      disposeObject3D(removed.template);
      if (this.activeCustomDriverId === id) {
        this.activeCustomDriverId =
          this.customDriverLibrary[this.customDriverLibrary.length - 1]?.id ?? null;
      }
      this.applyCustomModelsToAllRigs(true);
    }
    return this.getCustomModelState();
  }

  public clearCustomDriver(): void {
    this.activeCustomDriverId = null;
    this.applyCustomModelsToAllRigs(true);
  }

  public clearAllCustomDrivers(): CustomModelState {
    for (const entry of this.customDriverLibrary) {
      disposeObject3D(entry.template);
    }
    this.customDriverLibrary = [];
    this.activeCustomDriverId = null;
    this.applyCustomModelsToAllRigs(true);
    return this.getCustomModelState();
  }

  public setCustomDriverTransform(
    yawSteps: number,
    scale: number,
    seatOffsetY?: number,
    visible?: boolean
  ): CustomModelState {
    const active = this.getActiveDriverEntry();
    if (active) {
      active.yawSteps = normalizeQuarterTurns(yawSteps);
      active.scale = clampModelScale(scale);
      if (seatOffsetY !== undefined) {
        active.seatOffsetY = clampSeatOffsetY(seatOffsetY);
      }
    }
    if (visible !== undefined) {
      this.customDriverVisible = visible;
    }
    this.applyCustomModelsToAllRigs(true);
    return this.getCustomModelState();
  }

  public setApplyLibraryToAiRivals(enabled: boolean): CustomModelState {
    this.applyLibraryToAiRivals = enabled;
    this.applyCustomModelsToAllRigs(true);
    return this.getCustomModelState();
  }

  private applyEntriesToRig(
    rig: KartRig,
    kartEntry: CustomModelEntry | null,
    driverEntry: CustomModelEntry | null,
    driverVisible: boolean
  ): void {
    while (rig.customKartSlot.children.length > 0) {
      rig.customKartSlot.remove(rig.customKartSlot.children[0]);
    }
    if (kartEntry) {
      rig.defaultKartGroup.visible = false;
      rig.defaultWheelsGroup.visible = false;
      const kartClone = cloneCustomModelInstance(kartEntry.template);
      kartClone.rotation.y = normalizeQuarterTurns(kartEntry.yawSteps) * (Math.PI / 2);
      kartClone.scale.setScalar(clampModelScale(kartEntry.scale));
      rig.customKartSlot.add(kartClone);
    } else {
      rig.defaultKartGroup.visible = true;
      rig.defaultWheelsGroup.visible = true;
    }

    while (rig.customDriverSlot.children.length > 0) {
      rig.customDriverSlot.remove(rig.customDriverSlot.children[0]);
    }
    rig.driverGroup.visible = driverVisible;
    rig.driverGroup.position.y = 0.72 + clampSeatOffsetY(driverEntry?.seatOffsetY ?? 0);
    if (driverEntry) {
      rig.defaultDriverGroup.visible = false;
      const driverClone = cloneCustomModelInstance(driverEntry.template);
      driverClone.rotation.y = normalizeQuarterTurns(driverEntry.yawSteps) * (Math.PI / 2);
      driverClone.scale.setScalar(clampModelScale(driverEntry.scale));
      rig.customDriverSlot.add(driverClone);
    } else {
      rig.defaultDriverGroup.visible = true;
    }
  }

  private applyCustomModelsToAllRigs(renderImmediately = true): void {
    const activeKart = this.getActiveKartEntry();
    const activeDriver = this.getActiveDriverEntry();
    const aiKartPool =
      this.customKartLibrary.length > 1
        ? this.customKartLibrary.filter((k) => k.id !== this.activeCustomKartId)
        : this.customKartLibrary;
    const aiDriverPool =
      this.customDriverLibrary.length > 1
        ? this.customDriverLibrary.filter((d) => d.id !== this.activeCustomDriverId)
        : this.customDriverLibrary;

    let aiIndex = 0;
    let playerKart: KartState | undefined;

    for (const kart of this.karts) {
      const rig = this.rigs.get(kart.id);
      if (!rig) continue;

      if (kart.isPlayer) {
        playerKart = kart;
        this.applyEntriesToRig(rig, activeKart, activeDriver, this.customDriverVisible);
      } else if (this.applyLibraryToAiRivals && !kart.isRemote) {
        const aiKart =
          aiKartPool.length > 0 ? aiKartPool[aiIndex % aiKartPool.length] : null;
        const aiDriver =
          aiDriverPool.length > 0 ? aiDriverPool[aiIndex % aiDriverPool.length] : null;
        this.applyEntriesToRig(rig, aiKart, aiDriver, true);
        aiIndex++;
      } else {
        this.applyEntriesToRig(rig, null, null, true);
      }
    }

    if (renderImmediately && playerKart && !this.disposed) {
      this.updateDynamicShadowFrustum(playerKart, getCityById(this.cityId));
      this.renderFrame();
    }
  }

  public startSoloRace(cityId?: CityId, laps = 3, countdownSec = 2.1): void {
    this.audio.unlock();
    if (cityId && cityId !== this.cityId) {
      this.cityId = cityId;
      this.rebuildWorld(cityId);
    }
    this.totalLaps = laps;
    this.spawnSoloGrid();
    this.beginRaceCountdown(countdownSec);
  }

  public startMultiplayerRace(
    cityId: CityId,
    laps: number,
    players: MultiplayerPlayer[],
    localPlayerId: string
  ): void {
    this.audio.unlock();
    if (cityId !== this.cityId) {
      this.cityId = cityId;
      this.rebuildWorld(cityId);
    }
    this.totalLaps = laps;
    this.spawnMultiplayerGrid(players, localPlayerId);
    this.beginRaceCountdown(2.8);
  }

  private beginRaceCountdown(seconds: number): void {
    this.clearInputs();
    this.phase = 'playing';
    this.raceTimeMs = 0;
    this.weatherCycleElapsed = 0;
    this.countdownTimer = seconds;
    this.lastCountdownBeep = 4;
    this.hitstopTimer = 0;
    this.trauma = 0;
    this.finishDelayTimer = -1;
    this.pendingFinishSummary = null;
    this.bannerText = null;
    this.bannerTimer = 0;
    this.audio.setPaused(false);
    document.body.dataset.state = 'playing';
    this.callbacks.onPhaseChange?.('playing');
    this.snapCameraBehindPlayer();
    this.updateWeatherSystem(0.016, true);
    this.pushHud(true);
  }

  public pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.clearInputs();
    this.audio.setPaused(true);
    document.body.dataset.state = 'paused';
    this.callbacks.onPhaseChange?.('paused');
    this.pushHud(true);
  }

  public resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.clearInputs();
    this.lastPerfMs = performance.now();
    this.audio.setPaused(false);
    document.body.dataset.state = 'playing';
    this.callbacks.onPhaseChange?.('playing');
    this.pushHud(true);
  }

  public returnToTitle(): void {
    this.phase = 'title';
    this.clearInputs();
    this.audio.setPaused(true);
    this.remoteTargets.clear();
    this.spawnSoloGrid();
    document.body.dataset.state = 'title';
    this.callbacks.onPhaseChange?.('title');
    this.pushHud(true);
  }

  public toggleMute(): boolean {
    this.audio.unlock();
    const next = !this.audio.isMuted();
    this.audio.setMuted(next);
    return next;
  }

  public toggleCameraMode(): 'chase' | 'close' {
    this.cameraMode = this.cameraMode === 'chase' ? 'close' : 'chase';
    return this.cameraMode;
  }

  public setTouchControl(control: keyof typeof this.touchInput, pressed: boolean): void {
    this.touchInput[control] = pressed;
  }

  public triggerTouchNitro(): void {
    this.audio.unlock();
    this.nitroJustPressed = true;
  }

  public receiveRemoteTelemetry(data: RemoteTelemetry): void {
    this.remoteTargets.set(data.id, { ...data, updatedAt: performance.now() });
  }

  public markRemoteFinished(playerId: string, finishTimeMs: number): void {
    const kart = this.karts.find((k) => k.id === playerId);
    if (kart) {
      kart.finished = true;
      kart.finishTimeMs = finishTimeMs;
    }
  }

  private rebuildWorld(cityId: CityId): void {
    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      this.disposeGroup(this.worldGroup);
      this.worldGroup = null;
      this.worldRefs = null;
    }
    this.boostPadMaterials = [];

    const city = getCityById(cityId);
    this.track = buildTrackData(city, 320);
    this.activeWeather = resolveWeatherForState(city.defaultWeather, this.weatherSetting, this.weatherCycleElapsed);

    // Apply city lighting & horizon fog
    this.scene.background = new THREE.Color(city.fogColor);
    this.scene.fog = new THREE.Fog(city.fogColor, city.fogNear, city.fogFar);
    this.sunLight.color.set(city.sunColor);
    this.sunLight.intensity = city.sunIntensity;
    this.sunLight.position.set(city.sunPos.x, city.sunPos.y, city.sunPos.z);
    this.hemiLight.color.set(city.hemiSky);
    this.hemiLight.groundColor.set(city.hemiGround);
    this.hemiLight.intensity = city.hemiIntensity;

    const built = buildCityWorld(this.track, this.renderer.capabilities.getMaxAnisotropy());
    this.worldGroup = built.group;
    this.worldRefs = built;
    this.boostPadMaterials = built.boostPadMaterials;
    this.scene.add(this.worldGroup);
  }

  private clearKarts(): void {
    for (const rig of this.rigs.values()) {
      this.scene.remove(rig.root);
      this.disposeGroup(rig.root);
    }
    this.rigs.clear();
    this.karts = [];
    this.remoteTargets.clear();
    this.clearSkidMarks();
  }

  private clearSkidMarks(): void {
    clearSkidMarkPool(this.skidPool);
    this.syncSkidMarkGeometry();
  }

  private syncSkidMarkGeometry(): void {
    if (!this.skidPosAttr || !this.skidColorAttr) return;
    const posArr = this.skidPosAttr.array as Float32Array;
    const colArr = this.skidColorAttr.array as Float32Array;
    const cap = this.skidPool.capacity;
    const segs = this.skidPool.segments;

    for (let i = 0; i < cap; i++) {
      const seg = segs[i];
      const pBase = i * 12;
      const cBase = i * 16;

      if (!seg.active || seg.opacity <= 0.005) {
        for (let k = 0; k < 12; k += 3) {
          posArr[pBase + k] = 0;
          posArr[pBase + k + 1] = -100;
          posArr[pBase + k + 2] = 0;
        }
        for (let k = 0; k < 16; k++) {
          colArr[cBase + k] = 0;
        }
        continue;
      }

      const dx = seg.x1 - seg.x0;
      const dz = seg.z1 - seg.z0;
      const len = Math.hypot(dx, dz) || 1;
      // Lateral normal perpendicular to tire travel direction on the road surface
      const nx = -dz / len;
      const nz = dx / len;
      // Gently taper width as the skid mark fades out over time
      const halfW = seg.width * 0.5 * (0.48 + 0.52 * seg.opacity);

      // v0: start-left
      posArr[pBase] = seg.x0 - nx * halfW;
      posArr[pBase + 1] = seg.y0;
      posArr[pBase + 2] = seg.z0 - nz * halfW;
      // v1: start-right
      posArr[pBase + 3] = seg.x0 + nx * halfW;
      posArr[pBase + 4] = seg.y0;
      posArr[pBase + 5] = seg.z0 + nz * halfW;
      // v2: end-left
      posArr[pBase + 6] = seg.x1 - nx * halfW;
      posArr[pBase + 7] = seg.y1;
      posArr[pBase + 8] = seg.z1 - nz * halfW;
      // v3: end-right
      posArr[pBase + 9] = seg.x1 + nx * halfW;
      posArr[pBase + 10] = seg.y1;
      posArr[pBase + 11] = seg.z1 + nz * halfW;

      // Color: hot scorched drift rubber cooling into deep vulcanized charcoal asphalt mark
      const heat = Math.max(0, 1 - seg.age / 1.35);
      let r = 0.04;
      let g = 0.05;
      let b = 0.08;
      if (seg.tier === 3) {
        r += 0.44 * heat;
        g += 0.11 * heat;
        b += 0.58 * heat;
      } else if (seg.tier === 2) {
        r += 0.56 * heat;
        g += 0.22 * heat;
        b += 0.04 * heat;
      } else if (seg.tier === 1) {
        r += 0.08 * heat;
        g += 0.36 * heat;
        b += 0.54 * heat;
      }

      const alpha = seg.opacity * 0.88;
      for (let v = 0; v < 4; v++) {
        const off = cBase + v * 4;
        colArr[off] = r;
        colArr[off + 1] = g;
        colArr[off + 2] = b;
        colArr[off + 3] = alpha;
      }
    }

    this.skidPosAttr.needsUpdate = true;
    this.skidColorAttr.needsUpdate = true;
  }

  private updateSkidMarks(dt: number): void {
    if (dt <= 0) return;
    const changed = stepSkidMarkPool(this.skidPool, this.karts, dt);
    if (changed) {
      this.syncSkidMarkGeometry();
    }
  }

  public simulateDriftSample(steps = 56, steerDir: 'left' | 'right' = 'left'): number {
    const player = this.karts.find((k) => k.isPlayer);
    if (!player) return 0;
    const preset = getRacerPreset(player.racerId);
    player.speed = Math.max(player.speed, preset.maxSpeed * 0.92);
    for (let i = 0; i < steps; i++) {
      stepKartPhysics(
        player,
        {
          forward: true,
          backward: false,
          left: steerDir === 'left',
          right: steerDir === 'right',
          drift: true,
          nitroJustPressed: false,
          miniBoostJustPressed: false,
        },
        preset,
        this.track,
        1 / 60,
        this.totalLaps,
        this.raceTimeMs + i * 16.6
      );
      this.updateSkidMarks(1 / 60);
    }
    const rig = this.rigs.get(player.id);
    if (rig) {
      rig.root.position.set(player.x, player.y, player.z);
      rig.root.rotation.y = player.yaw + player.driftSlipAngle * 0.45;
    }
    this.snapCameraBehindPlayer();
    this.updateDynamicShadowFrustum(player, getCityById(this.cityId));
    this.updateMotionBlurPostProcess(player, 1 / 60, true);
    this.renderFrame();
    return this.skidPool.activeCount;
  }

  public simulateNitroSample(cww = true): CameraMotionBlurParams {
    const player = this.karts.find((k) => k.isPlayer);
    if (!player) return this.getMotionBlurState();
    const preset = getRacerPreset(player.racerId);
    player.nitroCharges = 2;
    player.miniBoostTimer = cww ? 1.1 : 0;
    player.speed = preset.maxSpeed * 1.18;
    for (let i = 0; i < 18; i++) {
      stepKartPhysics(
        player,
        {
          forward: true,
          backward: false,
          left: false,
          right: false,
          drift: false,
          nitroJustPressed: i === 0,
          miniBoostJustPressed: false,
        },
        preset,
        this.track,
        1 / 60,
        this.totalLaps,
        this.raceTimeMs + i * 16.6
      );
    }
    const rig = this.rigs.get(player.id);
    if (rig) {
      rig.root.position.set(player.x, player.y, player.z);
      rig.root.rotation.y = player.yaw;
      rig.flameLeft.visible = true;
      rig.flameRight.visible = true;
      rig.flameLeft.scale.set(1, 1, cww ? 1.9 : 1.5);
      rig.flameRight.scale.set(1, 1, cww ? 1.9 : 1.5);
      const flameMat = rig.flameLeft.material as THREE.MeshBasicMaterial;
      flameMat.color.set(cww ? '#c084fc' : '#22d3ee');
    }
    this.snapCameraBehindPlayer();
    this.updateDynamicShadowFrustum(player, getCityById(this.cityId));
    this.updateMotionBlurPostProcess(player, 1 / 60, true);
    this.renderFrame();
    this.pushHud(true);
    return this.getMotionBlurState();
  }

  private updateMotionBlurPostProcess(
    player: KartState | undefined,
    dt: number,
    immediate = false
  ): void {
    const target: CameraMotionBlurParams =
      player && this.phase === 'playing'
        ? computeCameraMotionBlurParams(player, getRacerPreset(player.racerId))
        : {
            intensity: 0,
            radialStrength: 0,
            lateralBlurX: 0,
            centerX: 0.5,
            centerY: 0.46,
            chromaticAmount: 0,
            boostTintMode: 0,
          };

    const blend = immediate ? 1 : 1 - Math.exp(-11 * dt);
    this.motionBlurState.intensity += (target.intensity - this.motionBlurState.intensity) * blend;
    this.motionBlurState.radialStrength +=
      (target.radialStrength - this.motionBlurState.radialStrength) * blend;
    this.motionBlurState.lateralBlurX +=
      (target.lateralBlurX - this.motionBlurState.lateralBlurX) * blend;
    this.motionBlurState.centerX += (target.centerX - this.motionBlurState.centerX) * blend;
    this.motionBlurState.centerY += (target.centerY - this.motionBlurState.centerY) * blend;
    this.motionBlurState.chromaticAmount +=
      (target.chromaticAmount - this.motionBlurState.chromaticAmount) * blend;
    this.motionBlurState.boostTintMode = target.boostTintMode;

    const u = this.motionBlurPass.uniforms;
    u['uIntensity'].value = this.motionBlurState.intensity;
    u['uRadialStrength'].value = this.motionBlurState.radialStrength;
    u['uLateralBlurX'].value = this.motionBlurState.lateralBlurX;
    (u['uCenter'].value as THREE.Vector2).set(
      this.motionBlurState.centerX,
      this.motionBlurState.centerY
    );
    u['uChromatic'].value = this.motionBlurState.chromaticAmount;

    const tintVec = u['uBoostTint'].value as THREE.Vector3;
    if (this.motionBlurState.boostTintMode === 3) {
      // CWW Combo / Tier-3 Ultra Drift: electric violet-magenta
      tintVec.set(0.75, 0.38, 0.98);
      u['uBoostTintStrength'].value = 0.28;
    } else if (this.motionBlurState.boostTintMode === 2) {
      // Nitro N2O / Boost Pad / Tier-1 Drift: neon cyan
      tintVec.set(0.13, 0.83, 0.95);
      u['uBoostTintStrength'].value = 0.22;
    } else if (this.motionBlurState.boostTintMode === 1) {
      // Mini-Boost / Tier-2 Super Drift: fiery amber-orange
      tintVec.set(0.98, 0.56, 0.22);
      u['uBoostTintStrength'].value = 0.22;
    } else {
      u['uBoostTintStrength'].value = 0.0;
    }
  }

  private renderFrame(): void {
    if (this.motionBlurState.intensity >= 0.006) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private spawnSoloGrid(): void {
    this.clearKarts();
    const otherPresets = RACER_PRESETS.filter((r) => r.id !== this.playerRacerId);
    const lineup = [
      { id: 'player', name: this.playerName, racerId: this.playerRacerId, isPlayer: true, isRemote: false },
      ...otherPresets.slice(0, 5).map((r, idx) => ({
        id: `ai_${idx}`,
        name: r.name,
        racerId: r.id,
        isPlayer: false,
        isRemote: false,
      })),
    ];

    lineup.forEach((entry, slot) => {
      const state = createGridKartState({
        id: entry.id,
        name: entry.name,
        racerId: entry.racerId,
        isPlayer: entry.isPlayer,
        isRemote: entry.isRemote,
        gridSlot: slot,
        track: this.track,
      });
      this.karts.push(state);
      const rig = createKartAndDriver(
        getRacerPreset(entry.racerId),
        entry.name,
        !entry.isPlayer
      );
      rig.root.position.set(state.x, state.y, state.z);
      rig.root.rotation.y = state.yaw;
      this.scene.add(rig.root);
      this.rigs.set(state.id, rig);
    });

    this.applyCustomModelsToAllRigs(false);
  }

  private spawnMultiplayerGrid(players: MultiplayerPlayer[], localPlayerId: string): void {
    this.clearKarts();
    const usedIds = new Set<string>();
    const lineup: Array<{
      id: string;
      name: string;
      racerId: string;
      isPlayer: boolean;
      isRemote: boolean;
      slot: number;
    }> = players.map((p, idx) => {
      usedIds.add(p.racerId);
      return {
        id: p.id,
        name: p.name,
        racerId: p.racerId,
        isPlayer: p.id === localPlayerId,
        isRemote: p.id !== localPlayerId,
        slot: p.gridSlot ?? idx,
      };
    });

    // Backfill remaining slots up to 6 with AI rivals for lively Zing Speed grids
    const aiPool = RACER_PRESETS.filter((r) => !usedIds.has(r.id)).concat(RACER_PRESETS);
    let aiIdx = 0;
    while (lineup.length < 6) {
      const preset = aiPool[aiIdx % aiPool.length];
      lineup.push({
        id: `ai_mp_${aiIdx}`,
        name: `${preset.name} [AI]`,
        racerId: preset.id,
        isPlayer: false,
        isRemote: false,
        slot: lineup.length,
      });
      aiIdx++;
    }

    lineup.forEach((entry) => {
      const state = createGridKartState({
        id: entry.id,
        name: entry.name,
        racerId: entry.racerId,
        isPlayer: entry.isPlayer,
        isRemote: entry.isRemote,
        gridSlot: entry.slot,
        track: this.track,
      });
      this.karts.push(state);
      const rig = createKartAndDriver(
        getRacerPreset(entry.racerId),
        entry.name,
        !entry.isPlayer
      );
      rig.root.position.set(state.x, state.y, state.z);
      rig.root.rotation.y = state.yaw;
      this.scene.add(rig.root);
      this.rigs.set(state.id, rig);
    });

    this.applyCustomModelsToAllRigs(false);
  }

  private positionTitleCamera(elapsed: number): void {
    const p = this.karts.find((k) => k.isPlayer);
    if (!p) return;
    // Frame hero kart in right-center foreground with road, gantry, and city landmark stretching ahead!
    const sway = Math.sin(elapsed * 0.35) * 0.24;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const rx = -fz;
    const rz = fx;

    const camX = p.x - fx * 6.8 + rx * (-2.6 + sway * 2.2);
    const camZ = p.z - fz * 6.8 + rz * (-2.6 + sway * 2.2);
    this.camera.position.set(camX, p.y + 3.15 + Math.sin(elapsed * 0.5) * 0.25, camZ);
    // Look slightly to the left of the kart so the kart & city landmark rest cleanly in the right 60% of the screen
    this.camera.lookAt(
      p.x + fx * 10 - rx * 2.3,
      p.y + 1.55,
      p.z + fz * 10 - rz * 2.3
    );
  }

  private snapCameraBehindPlayer(): void {
    const p = this.karts.find((k) => k.isPlayer);
    if (!p) return;
    const dist = this.cameraMode === 'chase' ? 9.5 : 6.8;
    const height = this.cameraMode === 'chase' ? 4.3 : 3.2;
    this.camera.position.set(
      p.x - Math.sin(p.yaw) * dist,
      p.y + height,
      p.z - Math.cos(p.yaw) * dist
    );
    this.camera.lookAt(p.x + Math.sin(p.yaw) * 14, p.y + 1.4, p.z + Math.cos(p.yaw) * 14);
  }

  private showBanner(text: string, duration = 1.6): void {
    this.bannerText = text;
    this.bannerTimer = duration;
  }

  private emitParticles(
    x: number,
    y: number,
    z: number,
    vxBase: number,
    vzBase: number,
    count: number,
    color: THREE.Color,
    size = 1.0
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % this.particleCount;
      p.active = true;
      p.life = 0;
      p.maxLife = 0.28 + Math.random() * 0.28;
      p.x = x + (Math.random() - 0.5) * 0.4;
      p.y = y + Math.random() * 0.25;
      p.z = z + (Math.random() - 0.5) * 0.4;
      p.vx = vxBase + (Math.random() - 0.5) * 5.5;
      p.vy = 1.8 + Math.random() * 3.8;
      p.vz = vzBase + (Math.random() - 0.5) * 5.5;
      p.size = size * (0.7 + Math.random() * 0.7);
      p.color.copy(color);
    }
  }

  private updateParticles(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this._dummy.position.set(0, -100, 0);
        this._dummy.scale.setScalar(0.001);
        this._dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 11.5 * dt;
      const frac = 1 - p.life / p.maxLife;
      this._dummy.position.set(p.x, p.y, p.z);
      this._dummy.rotation.set(p.life * 8, p.life * 5, 0);
      this._dummy.scale.setScalar(p.size * frac);
      this._dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this._dummy.matrix);
      this.particleMesh.setColorAt(i, p.color);
    }
    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private readPlayerInput(): InputState {
    const forward =
      this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touchInput.forward;
    const backward =
      this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touchInput.backward;
    const left =
      this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touchInput.left;
    const right =
      this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touchInput.right;
    const drift =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.keys.has('KeyK') ||
      this.touchInput.drift;

    const input: InputState = {
      forward,
      backward,
      left,
      right,
      drift,
      nitroJustPressed: this.nitroJustPressed,
      miniBoostJustPressed: this.miniBoostJustPressed,
    };
    this.nitroJustPressed = false;
    this.miniBoostJustPressed = false;
    return input;
  }

  private stepSimulation(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    this.elapsedSec += dt;

    // Pulse boost pad emissive glow smoothly & animate city citizens/spectators
    const pulse = 0.55 + Math.sin(this.elapsedSec * 5.5) * 0.25;
    for (const mat of this.boostPadMaterials) {
      mat.emissiveIntensity = pulse;
    }
    if (this.worldRefs) {
      updateCityCrowd(this.worldRefs, this.track, this.elapsedSec);
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - dt);
      if (this.bannerTimer === 0) this.bannerText = null;
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    // Dynamic weather progression & atmosphere update (active on title showcase & gameplay!)
    this.weatherCycleElapsed += dt;
    const city = getCityById(this.cityId);
    const desiredWeather = resolveWeatherForState(
      city.defaultWeather,
      this.weatherSetting,
      this.weatherCycleElapsed
    );
    if (desiredWeather !== this.activeWeather) {
      this.activeWeather = desiredWeather;
      if (this.phase === 'playing' && this.weatherSetting === 'dynamic') {
        this.showBanner(`THỜI TIẾT: ${WEATHER_LABELS[desiredWeather].toUpperCase()}`, 1.8);
      }
    }

    // Title Screen: Atmospheric Live-World Showcase Camera framing hero kart & city landmark
    if (this.phase === 'title') {
      const p = this.karts.find((k) => k.isPlayer);
      if (p) {
        this.positionTitleCamera(this.elapsedSec);
        this.updateDynamicShadowFrustum(p, city);
        const rig = this.rigs.get(p.id);
        if (rig) {
          rig.scarfMesh.rotation.z = Math.sin(this.elapsedSec * 4.5) * 0.14;
          rig.bodyGroup.position.y = Math.sin(this.elapsedSec * 6) * 0.025;
        }
        // Keep rival nameplates hidden on title screen for a spotless hero showcase
        for (const k of this.karts) {
          const r = this.rigs.get(k.id);
          if (r?.nameTagSprite) r.nameTagSprite.visible = false;
        }
      }
      this.updateWeatherSystem(dt, false);
      this.updateMotionBlurPostProcess(undefined, dt, true);
      this.audio.updateLoop(0, false, false, false);
      return;
    }

    if (this.phase !== 'playing') {
      this.updateMotionBlurPostProcess(undefined, dt, true);
      this.audio.updateLoop(0, false, false, false);
      return;
    }

    // Handle post-finish celebration beat before showing results modal
    if (this.finishDelayTimer > 0) {
      this.finishDelayTimer -= dt;
      if (this.finishDelayTimer <= 0 && this.pendingFinishSummary) {
        const summary = this.pendingFinishSummary;
        this.pendingFinishSummary = null;
        this.phase = 'gameover';
        this.audio.setPaused(true);
        document.body.dataset.state = 'gameover';
        this.callbacks.onPhaseChange?.('gameover');
        this.callbacks.onFinish(summary);
        this.pushHud(true);
        return;
      }
    }

    // Countdown phase before GO! (advance using real wall-clock dt clamped at 0.25s so software WebGL stays snappy)
    let racingLive = true;
    if (this.countdownTimer > 0) {
      this.countdownTimer = Math.max(0, this.countdownTimer - Math.min(rawDt, 0.25));
      const secCeil = Math.ceil(this.countdownTimer);
      if (secCeil < this.lastCountdownBeep && secCeil >= 1) {
        this.lastCountdownBeep = secCeil;
        this.audio.playCountdown(false);
      }
      if (this.countdownTimer === 0 && this.lastCountdownBeep > 0) {
        this.lastCountdownBeep = 0;
        this.audio.playCountdown(true);
        this.showBanner('XUẤT PHÁT!', 1.2);
      }
      racingLive = false;
    }

    // Hitstop freeze for heavy wall impacts (particles & camera shake continue!)
    let simDt = dt;
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      simDt = 0;
    }

    if (racingLive && simDt > 0) {
      this.raceTimeMs += simDt * 1000;
      const playerInput = this.readPlayerInput();

      for (const kart of this.karts) {
        if (kart.isRemote) {
          // Smooth interpolation toward latest network snapshot
          const target = this.remoteTargets.get(kart.id);
          if (target) {
            const blend = 1 - Math.exp(-12 * simDt);
            kart.x += (target.x - kart.x) * blend;
            kart.y += (target.y - kart.y) * blend;
            kart.z += (target.z - kart.z) * blend;
            const yawDiff = normalizeAngle(target.yaw - kart.yaw);
            kart.yaw = normalizeAngle(kart.yaw + yawDiff * blend);
            kart.speed = target.speed;
            kart.steerAngle = target.steer;
            kart.drifting = target.drifting;
            kart.driftDir = (target.driftDir as -1 | 0 | 1) || 0;
            kart.nitroTimer = target.nitroActive ? 1 : 0;
            kart.lap = target.lap;
            kart.totalProgress = target.progress;
          }
          continue;
        }

        const preset = getRacerPreset(kart.racerId);
        const input = kart.isPlayer
          ? kart.finished
            ? computeAiInput(kart, this.track, this.elapsedSec)
            : playerInput
          : computeAiInput(kart, this.track, this.elapsedSec);

        // Scale AI top speed slightly by individual skill for varied packs
        const effectivePreset = kart.isPlayer
          ? preset
          : { ...preset, maxSpeed: preset.maxSpeed * kart.aiSkill };

        const res = stepKartPhysics(
          kart,
          input,
          effectivePreset,
          this.track,
          simDt,
          this.totalLaps,
          this.raceTimeMs
        );

        if (kart.isPlayer) {
          if (res.hitWall) {
            this.hitstopTimer = 0.045;
            this.trauma = Math.min(1, this.trauma + 0.52);
            this.audio.playWallHit();
            this.emitParticles(kart.x, kart.y + 0.6, kart.z, 0, 0, 14, this._colorOrange, 1.3);
          }
          if (res.triggeredCww) {
            this.trauma = Math.min(1, this.trauma + 0.35);
            this.audio.playNitro(true);
            this.showBanner('CWW COMBO · SIÊU TỐC!', 1.8);
          } else if (res.triggeredNitro) {
            this.trauma = Math.min(1, this.trauma + 0.22);
            this.audio.playNitro(false);
            this.showBanner('NITRO N2O!', 1.3);
          } else if (res.triggeredMiniBoost) {
            this.audio.playMiniBoost();
            this.showBanner('TIỂU PHUN!', 0.9);
          }
          if (res.hitBoostPad) {
            this.audio.playBoostPad();
            this.trauma = Math.min(1, this.trauma + 0.16);
          }
          if (res.completedLap && !res.finishedRace) {
            this.audio.playLapComplete(false);
            this.showBanner(`VÒNG ${kart.lap} / ${this.totalLaps}`, 1.7);
          }
          if (res.finishedRace && this.finishDelayTimer < 0) {
            this.audio.playLapComplete(true);
            this.showBanner('VỀ ĐÍCH!', 2.0);
            this.callbacks.onLocalFinished?.(kart.finishTimeMs ?? this.raceTimeMs);
            const ordered = computeRaceStandings(this.karts);
            const myRank = ordered.findIndex((k) => k.isPlayer) + 1;
            const city = getCityById(this.cityId);
            this.pendingFinishSummary = {
              rank: myRank,
              totalRacers: this.karts.length,
              totalTimeMs: kart.finishTimeMs ?? this.raceTimeMs,
              bestLapMs: kart.bestLapMs ?? this.raceTimeMs,
              maxDriftCombo: kart.maxDriftCombo,
              cityId: this.cityId,
              cityName: city.name,
              standings: ordered.map((k, idx) => ({
                id: k.id,
                name: k.name,
                racerId: k.racerId,
                rank: idx + 1,
                lap: k.lap,
                finished: k.finished,
                finishTimeMs: k.finishTimeMs,
                isPlayer: k.isPlayer,
              })),
            };
            this.finishDelayTimer = 0.75;
          }

          // Stream local player telemetry to multiplayer peers
          this.callbacks.onTelemetrySend?.({
            x: kart.x,
            y: kart.y,
            z: kart.z,
            yaw: kart.yaw,
            speed: kart.speed,
            steer: kart.steerAngle,
            drifting: kart.drifting,
            driftDir: kart.driftDir,
            nitroActive: kart.nitroTimer > 0,
            lap: kart.lap,
            progress: kart.totalProgress,
          });
        }
      }
    }

    // Update 3D kart visuals, wheels, driver lean, flames, sparks
    const playerRef = this.karts.find((k) => k.isPlayer);
    for (const kart of this.karts) {
      const rig = this.rigs.get(kart.id);
      if (!rig) continue;

      rig.root.position.set(kart.x, kart.y, kart.z);
      rig.root.rotation.y = kart.yaw + kart.driftSlipAngle * 0.45;

      // Show rival nameplate only when rival is ahead of camera and within readable range (never blocking player's own kart!)
      if (rig.nameTagSprite && playerRef) {
        const dx = kart.x - this.camera.position.x;
        const dz = kart.z - this.camera.position.z;
        const distFromCam = Math.hypot(dx, dz);
        const relToPlayerFwd =
          (kart.x - playerRef.x) * Math.sin(playerRef.yaw) +
          (kart.z - playerRef.z) * Math.cos(playerRef.yaw);
        rig.nameTagSprite.visible = distFromCam > 8.5 && distFromCam < 75 && relToPlayerFwd > 1.5;
      }

      // Body tilt into corners/drifts + engine vibration
      const targetRoll = -(kart.steerAngle * 0.14 + kart.driftSlipAngle * 0.2);
      rig.bodyGroup.rotation.z += (targetRoll - rig.bodyGroup.rotation.z) * Math.min(1, 10 * dt);
      rig.bodyGroup.position.y = Math.sin(this.elapsedSec * 24 + kart.x) * (kart.speed > 5 ? 0.015 : 0.005);

      // Driver lean & fluttering scarf
      rig.driverGroup.rotation.z = targetRoll * 1.4;
      rig.steeringWheel.rotation.z = kart.steerAngle * 1.1;
      rig.scarfMesh.rotation.z = Math.sin(this.elapsedSec * (8 + Math.abs(kart.speed) * 0.35)) * 0.25;
      rig.scarfMesh.rotation.x = 1.05 + Math.min(0.45, Math.abs(kart.speed) * 0.01);

      // Wheels spin & front steering
      const wheelSpin = kart.speed * dt * 2.6;
      for (const w of rig.wheels) {
        w.rotation.x += wheelSpin;
      }
      for (const pivot of rig.frontWheelPivots) {
        pivot.rotation.y = kart.steerAngle * 0.65;
      }

      // Nitro / Mini-Boost exhaust flames
      const boosting = kart.nitroTimer > 0 || kart.miniBoostTimer > 0 || kart.padBoostTimer > 0;
      rig.flameLeft.visible = boosting;
      rig.flameRight.visible = boosting;
      if (boosting) {
        const flicker = 0.85 + Math.random() * 0.55;
        const lenScale = kart.cwwActive ? 1.8 : kart.nitroTimer > 0 ? 1.45 : 0.9;
        rig.flameLeft.scale.set(1, 1, lenScale * flicker);
        rig.flameRight.scale.set(1, 1, lenScale * flicker);
        const flameMat = rig.flameLeft.material as THREE.MeshBasicMaterial;
        flameMat.color.set(kart.cwwActive ? '#c084fc' : kart.nitroTimer > 0 ? '#22d3ee' : '#fb923c');
      }

      // Hit flash on wall bump
      const hitFlash = kart.hitWallTimer > 0.15;
      for (const m of rig.hitFlashMaterials) {
        m.emissiveIntensity = hitFlash ? 1.5 : 0.3;
      }

      // Emit drift sparks & boost trails
      if (kart.drifting && kart.speed > 18 && Math.random() < 0.7) {
        const sparkColor =
          kart.driftTier === 3
            ? this._colorPurple
            : kart.driftTier === 2
            ? this._colorOrange
            : this._colorBlue;
        const bx = kart.x - Math.sin(kart.yaw) * 1.4;
        const bz = kart.z - Math.cos(kart.yaw) * 1.4;
        this.emitParticles(bx, kart.y + 0.18, bz, -Math.sin(kart.yaw) * 8, -Math.cos(kart.yaw) * 8, 2, sparkColor, 0.9);
      }
      if (boosting && Math.random() < 0.55) {
        const bx = kart.x - Math.sin(kart.yaw) * 2.1;
        const bz = kart.z - Math.cos(kart.yaw) * 2.1;
        this.emitParticles(
          bx,
          kart.y + 0.45,
          bz,
          -Math.sin(kart.yaw) * 12,
          -Math.cos(kart.yaw) * 12,
          1,
          kart.cwwActive ? this._colorPurple : this._colorBlue,
          1.1
        );
      }
    }

    this.updateParticles(dt);
    this.updateSkidMarks(dt);

    // Camera follow with exponential damping, dynamic FOV kick, and trauma shake
    const player = this.karts.find((k) => k.isPlayer);
    if (player) {
      const boosting = player.nitroTimer > 0 || player.cwwActive || player.padBoostTimer > 0;
      const targetFov = player.cwwActive ? 78 : boosting ? 73 : 62 + Math.min(6, Math.abs(player.speed) * 0.08);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
      this.camera.updateProjectionMatrix();

      const camDist = this.cameraMode === 'chase' ? (boosting ? 10.6 : 9.2) : 6.7;
      const camHeight = this.cameraMode === 'chase' ? 4.35 : 3.1;
      const followYaw = player.yaw;

      this._camTargetPos.set(
        player.x - Math.sin(followYaw) * camDist,
        player.y + camHeight,
        player.z - Math.cos(followYaw) * camDist
      );
      const dampAlpha = 1 - Math.exp(-9.5 * dt);
      this.camera.position.lerp(this._camTargetPos, dampAlpha);

      // Apply decaying trauma^2 shake
      if (this.trauma > 0.01) {
        const shake = this.trauma * this.trauma * 0.45;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
      }

      this._camLookPos.set(
        player.x + Math.sin(followYaw) * 14,
        player.y + 1.45,
        player.z + Math.cos(followYaw) * 14
      );
      this.camera.lookAt(this._camLookPos);

      // Update real-time directional shadow camera frustum centered ahead of player
      this.updateDynamicShadowFrustum(player, city);

      this.updateWeatherSystem(dt, false);
      this.updateMotionBlurPostProcess(player, dt, false);
      this.audio.updateLoop(Math.abs(player.speed), player.drifting, player.nitroTimer > 0, racingLive);
    }
  }

  private updateDynamicShadowFrustum(
    player: KartState,
    city: ReturnType<typeof getCityById>
  ): void {
    const fx = Math.sin(player.yaw);
    const fz = Math.cos(player.yaw);
    const rx = -fz;
    const rz = fx;

    // Center the 96m x 96m orthographic shadow frustum 16m ahead of the player kart
    const focusX = player.x + fx * 16;
    const focusY = player.y;
    const focusZ = player.z + fz * 16;

    // Position the directional sun behind-and-to-the-side of the driving direction
    // so karts, spoilers, gantries, portals, trees, and buildings cast rich diagonal
    // 3D shadows forward and across the asphalt road in full view of the camera!
    const sideSign = city.sunPos.x >= 0 ? 1 : -1;
    const sideDist = this.activeWeather === 'sunset' ? 54 : 44;
    const backDist = this.activeWeather === 'sunset' ? 28 : 22;
    const offsetY =
      this.activeWeather === 'sunset'
        ? 28
        : this.activeWeather === 'fog' || this.activeWeather === 'rain'
        ? 46
        : 36;

    const offsetX = rx * sideDist * sideSign - fx * backDist;
    const offsetZ = rz * sideDist * sideSign - fz * backDist;

    this.sunLight.position.set(focusX + offsetX, focusY + offsetY, focusZ + offsetZ);
    this.sunLight.target.position.set(focusX, focusY, focusZ);
    this.sunLight.target.updateMatrixWorld();
  }

  private updateWeatherSystem(dt: number, immediate: boolean): void {
    const city = getCityById(this.cityId);
    const w = this.activeWeather;
    const blend = immediate ? 1 : 1 - Math.exp(-2.8 * dt);

    // 1. Target atmosphere colors, volumetric fog depth & material responses per weather mode
    this._targetFogColor.set(city.fogColor);
    this._targetSkyTint.set('#ffffff');
    this._targetSunColor.set(city.sunColor);
    this._targetHemiSky.set(city.hemiSky);
    this._targetGroundColor.set(city.groundColor);

    let targetFogNear = city.fogNear;
    let targetFogFar = city.fogFar;
    // High directional-to-hemisphere ratio so real-time shadow maps cast crisp, deep shadows on asphalt & ground
    let targetSunIntensity = city.sunIntensity * 1.48;
    let targetHemiIntensity = city.hemiIntensity * 0.52;
    let targetRoadRoughness = 0.74;
    let targetRoadMetalness = 0.08;
    let targetSunDiscOpacity = 0;
    let targetLampHaloOpacity = city.neonMode ? 0.11 : 0.04;

    if (w === 'rain') {
      this._scratchColor.set('#1e2d42');
      this._targetFogColor.lerp(this._scratchColor, 0.58);
      this._scratchColor.set('#647894');
      this._targetSkyTint.lerp(this._scratchColor, 0.6);
      this._scratchColor.set('#93c5fd');
      this._targetSunColor.lerp(this._scratchColor, 0.52);
      this._scratchColor.set('#64748b');
      this._targetHemiSky.lerp(this._scratchColor, 0.48);
      targetFogNear = 28;
      targetFogFar = 235;
      targetSunIntensity = city.sunIntensity * 0.65;
      targetHemiIntensity = city.hemiIntensity * 0.86;
      // Wet mirror-like asphalt sheen reflects neon & environment map
      targetRoadRoughness = 0.15;
      targetRoadMetalness = 0.38;
      targetLampHaloOpacity = 0.2;

      // Occasional storm lightning flash in heavy rain
      this.lightningCooldown -= dt;
      if (this.lightningCooldown <= 0) {
        this.lightningFlash = 1.0;
        this.lightningCooldown = 7 + Math.random() * 8;
      }
      if (this.lightningFlash > 0) {
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 4.5);
        targetSunIntensity += this.lightningFlash * 2.2;
        targetHemiIntensity += this.lightningFlash * 0.75;
      }
    } else if (w === 'snow') {
      this._scratchColor.set('#c4d7eb');
      this._targetFogColor.lerp(this._scratchColor, 0.58);
      this._scratchColor.set('#d5e6f7');
      this._targetSkyTint.lerp(this._scratchColor, 0.52);
      this._scratchColor.set('#e0f2fe');
      this._targetSunColor.lerp(this._scratchColor, 0.58);
      this._scratchColor.set('#dbeafe');
      this._targetHemiSky.lerp(this._scratchColor, 0.55);
      this._scratchColor.set('#e2e8f0');
      this._targetGroundColor.lerp(this._scratchColor, 0.62);
      targetFogNear = 32;
      targetFogFar = 245;
      targetSunIntensity = city.sunIntensity * 0.88;
      targetHemiIntensity = Math.min(1.25, city.hemiIntensity * 1.15);
      targetRoadRoughness = 0.52;
      targetRoadMetalness = 0.14;
      targetLampHaloOpacity = 0.16;
    } else if (w === 'fog') {
      // Dense volumetric city fog (Sương mù dày đặc) — dramatic multi-plane depth fade
      this._scratchColor.set(city.neonMode ? '#334155' : '#94a3b8');
      this._targetFogColor.lerp(this._scratchColor, 0.76);
      this._scratchColor.set('#cbd5e1');
      this._targetSkyTint.lerp(this._scratchColor, 0.78);
      this._scratchColor.set('#e2e8f0');
      this._targetSunColor.lerp(this._scratchColor, 0.65);
      this._scratchColor.set('#cbd5e1');
      this._targetHemiSky.lerp(this._scratchColor, 0.65);
      targetFogNear = 15;
      targetFogFar = 132;
      targetSunIntensity = city.sunIntensity * 0.62;
      targetHemiIntensity = city.hemiIntensity * 0.95;
      targetRoadRoughness = 0.36;
      targetRoadMetalness = 0.22;
      targetLampHaloOpacity = 0.26;
    } else if (w === 'sunset') {
      this._scratchColor.set('#ea8a47');
      this._targetFogColor.lerp(this._scratchColor, 0.58);
      this._scratchColor.set('#fdba74');
      this._targetSkyTint.lerp(this._scratchColor, 0.52);
      this._scratchColor.set('#fb923c');
      this._targetSunColor.lerp(this._scratchColor, 0.65);
      this._scratchColor.set('#fed7aa');
      this._targetHemiSky.lerp(this._scratchColor, 0.45);
      targetFogNear = city.fogNear * 0.76;
      targetFogFar = city.fogFar * 0.86;
      targetSunIntensity = Math.max(1.85, city.sunIntensity * 1.12);
      targetHemiIntensity = city.hemiIntensity * 0.92;
      targetRoadRoughness = 0.54;
      targetRoadMetalness = 0.16;
      targetSunDiscOpacity = 0.92;
      targetLampHaloOpacity = 0.16;
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this._targetFogColor, blend);
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.lerp(this._targetFogColor, blend);
      this.scene.fog.near += (targetFogNear - this.scene.fog.near) * blend;
      this.scene.fog.far += (targetFogFar - this.scene.fog.far) * blend;
    }
    this.sunLight.color.lerp(this._targetSunColor, blend);
    this.sunLight.intensity += (targetSunIntensity - this.sunLight.intensity) * blend;
    this.sunLight.shadow.radius = w === 'fog' || w === 'rain' ? 4.2 : 2.8;
    this.hemiLight.color.lerp(this._targetHemiSky, blend);
    this.hemiLight.intensity += (targetHemiIntensity - this.hemiLight.intensity) * blend;

    const playerRef = this.karts.find((k) => k.isPlayer) ?? this.karts[0];
    if (playerRef) {
      this.updateDynamicShadowFrustum(playerRef, city);
    }

    if (this.worldRefs) {
      this.worldRefs.skyDomeMat.color.lerp(this._targetSkyTint, blend);
      this.worldRefs.groundMat.color.lerp(this._targetGroundColor, blend);
      this.worldRefs.roadMat.roughness += (targetRoadRoughness - this.worldRefs.roadMat.roughness) * blend;
      this.worldRefs.roadMat.metalness += (targetRoadMetalness - this.worldRefs.roadMat.metalness) * blend;
      this.worldRefs.lampHaloMat.opacity +=
        (targetLampHaloOpacity - this.worldRefs.lampHaloMat.opacity) * blend;

      const discOp =
        this.worldRefs.sunsetDiscMat.opacity +
        (targetSunDiscOpacity - this.worldRefs.sunsetDiscMat.opacity) * blend;
      this.worldRefs.sunsetDiscMat.opacity = discOp;
      this.worldRefs.sunsetHaloMat.opacity = discOp * 0.34;
      this.worldRefs.sunsetSun.visible = discOp > 0.02;
      if (this.worldRefs.sunsetSun.visible) {
        const pulse = 1 + Math.sin(this.elapsedSec * 1.6) * 0.04;
        this.worldRefs.sunsetSun.scale.setScalar(pulse);
      }
    }

    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;

    // 2. Update 3D Volumetric Low-Altitude Fog & Mist Cloud Banks around camera
    const activeFogClouds =
      w === 'fog' ? this.fogCloudCount : w === 'rain' ? 18 : w === 'snow' ? 16 : 0;
    if (activeFogClouds === 0) {
      this.fogCloudsMesh.visible = false;
    } else {
      this.fogCloudsMesh.visible = true;
      this.fogCloudsMat.color.copy(this._targetFogColor).lerp(this._colorWhite, 0.45);
      this.fogCloudsMat.opacity = w === 'fog' ? 0.46 : 0.22;

      const fogBox = 116;
      const halfFogBox = fogBox * 0.5;
      const camYaw = Math.atan2(
        this._camLookPos.x - camX || 0,
        this._camLookPos.z - camZ || -1
      );

      for (let i = 0; i < this.fogCloudCount; i++) {
        if (i >= activeFogClouds) {
          this._dummy.position.set(0, -100, 0);
          this._dummy.scale.setScalar(0.001);
          this._dummy.updateMatrix();
          this.fogCloudsMesh.setMatrixAt(i, this._dummy.matrix);
          continue;
        }
        const fc = this.fogClouds[i];
        fc.ox += fc.speedX * dt;
        fc.oz += fc.speedZ * dt;
        if (fc.ox < -halfFogBox) fc.ox += fogBox;
        else if (fc.ox > halfFogBox) fc.ox -= fogBox;
        if (fc.oz < -halfFogBox) fc.oz += fogBox;
        else if (fc.oz > halfFogBox) fc.oz -= fogBox;

        const yHeight =
          w === 'fog'
            ? fc.oy + Math.sin(this.elapsedSec * 0.7 + fc.phase) * 0.8
            : 1.5 + (fc.oy % 4.5);

        this._dummy.position.set(camX + fc.ox, yHeight, camZ + fc.oz);
        this._dummy.rotation.set(0, camYaw + Math.sin(this.elapsedSec * 0.25 + fc.phase) * 0.2, 0);
        const breathe = 1 + Math.sin(this.elapsedSec * 0.9 + fc.phase) * 0.1;
        this._dummy.scale.set(fc.scaleX * breathe, fc.scaleY, 1);
        this._dummy.updateMatrix();
        this.fogCloudsMesh.setMatrixAt(i, this._dummy.matrix);
      }
      this.fogCloudsMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Update 3D Wet-Road Rain Splash Ripples around camera/player
    if (w !== 'rain') {
      this.rainSplashMesh.visible = false;
    } else {
      this.rainSplashMesh.visible = true;
      const player = this.karts.find((k) => k.isPlayer);
      const baseY = (player ? player.y : 0) + 0.07;
      const splashBox = 36;
      const halfSplash = splashBox * 0.5;

      for (let i = 0; i < this.rainSplashCount; i++) {
        const sp = this.rainSplashes[i];
        sp.phase += dt * sp.speed;
        if (sp.phase >= 1) {
          sp.phase -= 1;
          sp.ox = (Math.random() - 0.5) * splashBox;
          sp.oz = (Math.random() - 0.5) * splashBox;
        }
        if (sp.ox < -halfSplash) sp.ox += splashBox;
        else if (sp.ox > halfSplash) sp.ox -= splashBox;
        if (sp.oz < -halfSplash) sp.oz += splashBox;
        else if (sp.oz > halfSplash) sp.oz -= splashBox;

        const ringScale = 0.4 + sp.phase * 2.2;
        this._dummy.position.set(camX + sp.ox, baseY, camZ + sp.oz);
        this._dummy.rotation.set(0, 0, 0);
        this._dummy.scale.set(ringScale, 1, ringScale);
        this._dummy.updateMatrix();
        this.rainSplashMesh.setMatrixAt(i, this._dummy.matrix);
      }
      this.rainSplashMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Update pooled zero-GC 3D precipitation & atmospheric particles wrapped around camera view
    if (w === 'clear') {
      this.weatherMesh.visible = false;
      return;
    }

    this.weatherMesh.visible = true;

    let activeCount = this.weatherCount;
    if (w === 'sunset') activeCount = 95;
    else if (w === 'fog') activeCount = 140;
    else if (w === 'snow') activeCount = 265;

    if (w === 'rain') {
      this.weatherMat.opacity = 0.72;
      this._weatherColor.set('#bae6fd');
    } else if (w === 'snow') {
      this.weatherMat.opacity = 0.92;
      this._weatherColor.set('#f8fafc');
    } else if (w === 'fog') {
      this.weatherMat.opacity = 0.45;
      this._weatherColor.set('#e2e8f0');
    } else {
      this.weatherMat.opacity = 0.58;
      this._weatherColor.set('#fde68a');
    }

    const boxW = 60;
    const boxH = 26;
    const halfW = boxW * 0.5;

    for (let i = 0; i < this.weatherCount; i++) {
      if (i >= activeCount) {
        this._dummy.position.set(0, -100, 0);
        this._dummy.scale.setScalar(0.001);
        this._dummy.updateMatrix();
        this.weatherMesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }

      const d = this.weatherDrops[i];
      if (w === 'rain') {
        d.oy -= 36 * d.speedMult * dt;
        d.ox -= 5.2 * dt;
      } else if (w === 'snow') {
        d.oy -= 5.1 * d.speedMult * dt;
        d.ox += Math.sin(this.elapsedSec * 2.1 + d.phase) * 3.1 * dt;
        d.oz += Math.cos(this.elapsedSec * 1.6 + d.phase) * 2.4 * dt;
      } else if (w === 'fog') {
        // Suspended mist droplets drifting horizontally with air currents
        d.oy += Math.sin(this.elapsedSec * 0.8 + d.phase) * 0.45 * dt;
        d.ox += Math.cos(this.elapsedSec * 0.6 + d.phase) * 2.2 * dt;
        d.oz += Math.sin(this.elapsedSec * 0.5 + d.phase) * 1.8 * dt;
      } else {
        // Warm golden dusk motes floating gently upward
        d.oy += 0.95 * d.speedMult * dt;
        d.ox += Math.sin(this.elapsedSec * 0.9 + d.phase) * 1.2 * dt;
        d.oz += Math.cos(this.elapsedSec * 0.7 + d.phase) * 1.2 * dt;
      }

      // Wrap relative offsets seamlessly into box around camera
      if (d.oy < -4) d.oy += boxH;
      else if (d.oy > boxH - 4) d.oy -= boxH;
      if (d.ox < -halfW) d.ox += boxW;
      else if (d.ox > halfW) d.ox -= boxW;
      if (d.oz < -halfW) d.oz += boxW;
      else if (d.oz > halfW) d.oz -= boxW;

      this._dummy.position.set(camX + d.ox, Math.max(0.2, camY - 2 + d.oy), camZ + d.oz);
      if (w === 'rain') {
        this._dummy.rotation.set(0.12, 0, 0.16);
        this._dummy.scale.set(0.72, 1.75, 0.72);
      } else if (w === 'snow') {
        const flakeSize = 2.1 + (i % 3) * 0.65;
        this._dummy.rotation.set(this.elapsedSec * 1.6 + d.phase, d.phase, this.elapsedSec + d.phase);
        this._dummy.scale.set(flakeSize, 0.24, flakeSize);
      } else if (w === 'fog') {
        this._dummy.rotation.set(0, this.elapsedSec * 0.4 + d.phase, 0);
        this._dummy.scale.set(3.4, 0.18, 3.4);
      } else {
        this._dummy.rotation.set(0, this.elapsedSec + d.phase, 0);
        this._dummy.scale.set(1.9, 0.16, 1.9);
      }
      this._dummy.updateMatrix();
      this.weatherMesh.setMatrixAt(i, this._dummy.matrix);
      this.weatherMesh.setColorAt(i, this._weatherColor);
    }

    this.weatherMesh.instanceMatrix.needsUpdate = true;
    if (this.weatherMesh.instanceColor) this.weatherMesh.instanceColor.needsUpdate = true;
  }

  private pushHud(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastHudPushMs < 100) return; // <= 10Hz React HUD updates
    this.lastHudPushMs = now;

    const ordered = computeRaceStandings(this.karts);
    const player = this.karts.find((k) => k.isPlayer) ?? this.karts[0];
    const myRank = Math.max(1, ordered.findIndex((k) => k.id === player?.id) + 1);
    const city = getCityById(this.cityId);

    const countdownVal =
      this.phase === 'playing' && this.countdownTimer > 0
        ? Math.ceil(this.countdownTimer)
        : this.phase === 'playing' && this.raceTimeMs < 750 && this.countdownTimer === 0
        ? 0
        : -1;

    this.callbacks.onHudUpdate({
      phase: this.phase,
      countdown: countdownVal,
      speedKmh: Math.round(Math.abs(player?.speed ?? 0) * 3.8),
      rank: myRank,
      totalRacers: this.karts.length,
      lap: player?.lap ?? 1,
      totalLaps: this.totalLaps,
      raceTimeMs: Math.round(this.raceTimeMs),
      nitroGauge: Math.round(player?.nitroGauge ?? 0),
      nitroCharges: player?.nitroCharges ?? 0,
      nitroActive: (player?.nitroTimer ?? 0) > 0,
      cwwActive: Boolean(player?.cwwActive),
      miniBoostReady: (player?.miniBoostWindow ?? 0) > 0,
      miniBoostActive: (player?.miniBoostTimer ?? 0) > 0,
      driftTier: player?.driftTier ?? 0,
      wrongWay: player ? isKartWrongWay(player, this.track) : false,
      bannerText: this.bannerText,
      cityName: city.name,
      trackName: city.trackName,
      weather: this.activeWeather,
      weatherSetting: this.weatherSetting,
      minimapRacers: this.karts.map((k) => ({
        id: k.id,
        x: k.x,
        z: k.z,
        isPlayer: k.isPlayer,
        color: getRacerPreset(k.racerId).bodyColor,
      })),
      standings: ordered.map((k, idx) => ({
        id: k.id,
        name: k.name,
        racerId: k.racerId,
        rank: idx + 1,
        lap: k.lap,
        finished: k.finished,
        finishTimeMs: k.finishTimeMs,
        isPlayer: k.isPlayer,
      })),
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = Math.max(0.001, (now - this.lastPerfMs) / 1000);
    this.lastPerfMs = now;

    this.stepSimulation(rawDt);
    this.renderFrame();
    this.pushHud(false);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = window.requestAnimationFrame(this.tick);
    }
  };

  private clearInputs(): void {
    this.keys.clear();
    this.touchInput.left = false;
    this.touchInput.right = false;
    this.touchInput.forward = false;
    this.touchInput.backward = false;
    this.touchInput.drift = false;
    this.nitroJustPressed = false;
    this.miniBoostJustPressed = false;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      return;
    }

    if (this.phase === 'playing') {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        if (e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyN' || e.code === 'ControlLeft') {
          this.audio.unlock();
          this.nitroJustPressed = true;
        }
        if (e.code === 'KeyW' || e.code === 'ArrowUp') {
          this.miniBoostJustPressed = true;
        }
        if (e.code === 'KeyC') {
          this.toggleCameraMode();
        }
      }
    }
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleBlur = (): void => {
    this.clearInputs();
  };

  private handleVisibility = (): void => {
    if (document.hidden) {
      this.clearInputs();
    }
  };

  private handleResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.renderFrame();
  }

  private disposeGroup(group: THREE.Object3D): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.userData?.__skipDisposeOnSlotClear) return;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
  }

  public dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.resizeObserver.disconnect();
    this.audio.dispose();
    this.clearKarts();
    for (const entry of this.customKartLibrary) {
      disposeObject3D(entry.template);
    }
    this.customKartLibrary = [];
    this.activeCustomKartId = null;
    for (const entry of this.customDriverLibrary) {
      disposeObject3D(entry.template);
    }
    this.customDriverLibrary = [];
    this.activeCustomDriverId = null;
    if (this.worldGroup) {
      this.disposeGroup(this.worldGroup);
    }
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.weatherMesh.geometry.dispose();
    this.weatherMat.dispose();
    this.fogCloudsMesh.geometry.dispose();
    if (this.fogCloudsMat.map) this.fogCloudsMat.map.dispose();
    this.fogCloudsMat.dispose();
    this.rainSplashMesh.geometry.dispose();
    this.rainSplashMat.dispose();
    this.skidGeo.dispose();
    this.skidMat.dispose();
    this.motionBlurPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    const win = window as unknown as { __nitroEngine?: NitroDriftEngine };
    if (win.__nitroEngine === this) {
      delete win.__nitroEngine;
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
