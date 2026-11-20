import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeletonSafe } from 'three/addons/utils/SkeletonUtils.js';
import { CityId, RacerPreset, TrackData } from './types';
import {
  computeModelNormalizationTransform,
  ModelSlotKind,
  validateModelFileName,
} from './modelUtils';
import {
  createAsphaltNormalTexture,
  createBoostPadTexture,
  createBuildingFacadeTexture,
  createCarbonFiberTexture,
  createContactShadowTexture,
  createRoadTexture,
  createSkyDomeTexture,
  createStartLineTexture,
  createTerrainTexture,
  createTireTreadTexture,
} from './textures';
import { sampleTrackAt } from './physics';

export interface KartRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  defaultKartGroup: THREE.Group;
  defaultWheelsGroup: THREE.Group;
  customKartSlot: THREE.Group;
  driverGroup: THREE.Group;
  defaultDriverGroup: THREE.Group;
  customDriverSlot: THREE.Group;
  scarfMesh: THREE.Mesh;
  steeringWheel: THREE.Mesh;
  wheels: THREE.Group[];
  frontWheelPivots: THREE.Group[];
  flameLeft: THREE.Mesh;
  flameRight: THREE.Mesh;
  brakeGlow: THREE.MeshStandardMaterial;
  hitFlashMaterials: THREE.MeshStandardMaterial[];
  nameTagSprite?: THREE.Sprite;
}

let sharedShadowTex: THREE.CanvasTexture | null = null;
function getShadowTexture(): THREE.CanvasTexture {
  if (!sharedShadowTex) sharedShadowTex = createContactShadowTexture();
  return sharedShadowTex;
}

function createNameTagSprite(name: string, accent: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(11, 17, 32, 0.82)';
  ctx.beginPath();
  ctx.roundRect(12, 12, 232, 40, 12);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 14), 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.65, 0.42, 1);
  sprite.position.set(0, 2.28, 0);
  return sprite;
}

/**
 * Builds a high-realism composite Zing Speed S-Class Hyper-Kart + articulated anatomically
 * sculpted Driver with double-wishbone suspension, brake discs/calipers, carbon splitter,
 * rear diffuser, side mirrors, racing seat & multi-spoke machined rims.
 * Grounded cleanly at y = 0 (bottom-center pivot).
 */
export function createKartAndDriver(
  preset: RacerPreset,
  labelName?: string,
  showLabel = false
): KartRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const defaultKartGroup = new THREE.Group();
  bodyGroup.add(defaultKartGroup);

  const customKartSlot = new THREE.Group();
  bodyGroup.add(customKartSlot);

  const defaultWheelsGroup = new THREE.Group();
  root.add(defaultWheelsGroup);

  // Soft under-chassis ambient occlusion contact shadow (blends with real-time directional shadow map)
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.85, 4.45),
    new THREE.MeshBasicMaterial({
      map: getShadowTexture(),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.055;
  root.add(shadowMesh);

  const carbonTex = createCarbonFiberTexture();
  const tireTex = createTireTreadTexture();

  // High-contrast studio PBR materials
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: preset.bodyColor,
    metalness: 0.68,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 1.0,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: preset.secondaryColor,
    map: carbonTex,
    metalness: 0.35,
    roughness: 0.48,
  });
  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: '#0f172a',
    metalness: 0.45,
    roughness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: preset.accentColor,
    metalness: 0.5,
    roughness: 0.2,
    emissive: preset.accentColor,
    emissiveIntensity: 0.42,
  });
  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: '#f1f5f9',
    metalness: 0.96,
    roughness: 0.12,
    clearcoat: 0.6,
  });
  const titaniumExhaustMat = new THREE.MeshStandardMaterial({
    color: '#94a3b8',
    metalness: 0.92,
    roughness: 0.22,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    map: tireTex,
    metalness: 0.1,
    roughness: 0.82,
  });
  const brakeDiscMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    metalness: 0.88,
    roughness: 0.28,
  });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: preset.accentColor,
    metalness: 0.45,
    roughness: 0.25,
  });
  const brakeGlow = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    emissive: '#ef4444',
    emissiveIntensity: 0.75,
    roughness: 0.15,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#e0f2fe',
    emissiveIntensity: 1.65,
    roughness: 0.08,
  });

  // 1. Sculpted beveled aerodynamic monocoque chassis via ExtrudeGeometry
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.68, -1.48);
  hullShape.lineTo(0.68, -1.48);
  hullShape.lineTo(0.84, -0.45);
  hullShape.lineTo(0.76, 0.72);
  hullShape.lineTo(0.42, 1.66);
  hullShape.lineTo(-0.42, 1.66);
  hullShape.lineTo(-0.76, 0.72);
  hullShape.lineTo(-0.84, -0.45);
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.11,
    bevelSize: 0.09,
    bevelSegments: 4,
  });
  hullGeo.rotateX(Math.PI / 2);
  const hullMesh = new THREE.Mesh(hullGeo, paintMat);
  hullMesh.position.set(0, 0.63, 0);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  defaultKartGroup.add(hullMesh);

  // Sculpted nose cone taper & front hood cowl
  const noseCone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.56, 1.05, 16),
    paintMat
  );
  noseCone.rotation.x = Math.PI / 2 + 0.14;
  noseCone.scale.set(1.25, 1, 0.52);
  noseCone.position.set(0, 0.52, 1.32);
  noseCone.castShadow = true;
  defaultKartGroup.add(noseCone);

  // 2. Woven Carbon Undertray + Rear Venturi Diffuser with 5 vertical strakes
  const floorTray = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.1, 3.32), carbonMat);
  floorTray.position.set(0, 0.25, 0.04);
  floorTray.castShadow = true;
  defaultKartGroup.add(floorTray);

  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.18, 0.58), carbonMat);
    fin.position.set(i * 0.28, 0.27, -1.46);
    fin.rotation.x = 0.15;
    defaultKartGroup.add(fin);
  }

  // 3. Multi-element Front Aero Wing + Endplates + Nose Accent Spine
  const frontMainPlane = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.06, 0.38), carbonMat);
  frontMainPlane.position.set(0, 0.28, 1.62);
  defaultKartGroup.add(frontMainPlane);

  const frontUpperFlap = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.22), paintMat);
  frontUpperFlap.position.set(0, 0.35, 1.52);
  frontUpperFlap.rotation.x = 0.22;
  defaultKartGroup.add(frontUpperFlap);

  for (const side of [-1, 1]) {
    const fEndplate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.54), accentMat);
    fEndplate.position.set(side * 0.99, 0.34, 1.58);
    defaultKartGroup.add(fEndplate);

    // Front Aero Dive-Plane Canards on nose flanks
    const canard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.28), carbonMat);
    canard.position.set(side * 0.56, 0.48, 1.38);
    canard.rotation.z = -side * 0.22;
    canard.rotation.x = 0.24;
    defaultKartGroup.add(canard);
  }

  const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 1.18), accentMat);
  noseStripe.position.set(0, 0.71, 1.06);
  noseStripe.rotation.x = 0.17;
  defaultKartGroup.add(noseStripe);

  // 4. Sculpted Sidepods with NACA Air Intakes, Bargeboards, Wing Mirrors & Dual LED Headlights
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.21, 1.18, 12, 18),
      paintMat
    );
    pod.rotation.x = Math.PI / 2;
    pod.scale.set(1.08, 1, 0.9);
    pod.position.set(side * 0.88, 0.48, -0.06);
    pod.castShadow = true;
    defaultKartGroup.add(pod);

    // Sidepod radiator intake cavity + internal intercooler mesh core
    const intakeHole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.14), darkTrimMat);
    intakeHole.position.set(side * 0.88, 0.5, 0.58);
    defaultKartGroup.add(intakeHole);

    // Carbon aero bargeboard turning vane ahead of sidepod
    const bargeboard = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.32, 0.46), carbonMat);
    bargeboard.position.set(side * 0.78, 0.44, 0.72);
    bargeboard.rotation.y = side * 0.24;
    defaultKartGroup.add(bargeboard);

    // Glowing side neon aero blade
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 1.42), accentMat);
    trim.position.set(side * 1.08, 0.36, -0.05);
    defaultKartGroup.add(trim);

    // Twin Anodized N2O Nitrous Oxide Bottles mounted along the rear engine bay flanks
    const nitroTank = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.58, 16), accentMat);
    nitroTank.rotation.x = Math.PI / 2 - 0.25;
    nitroTank.position.set(side * 0.34, 0.88, -0.96);
    defaultKartGroup.add(nitroTank);

    const nitroDome = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 12), chromeMat);
    nitroDome.position.set(side * 0.34, 0.95, -0.69);
    defaultKartGroup.add(nitroDome);

    // Side rearview racing mirrors on stalk
    const mirrorStalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.24, 8), carbonMat);
    mirrorStalk.position.set(side * 0.58, 0.86, 0.46);
    mirrorStalk.rotation.z = -side * 0.55;
    defaultKartGroup.add(mirrorStalk);

    const mirrorHousing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.11), paintMat);
    mirrorHousing.position.set(side * 0.69, 0.94, 0.46);
    defaultKartGroup.add(mirrorHousing);

    // Dual projector LED headlights + DRL strips
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.12), headlightMat);
    lamp.position.set(side * 0.46, 0.54, 1.66);
    lamp.rotation.y = -side * 0.18;
    defaultKartGroup.add(lamp);
  }

  // 5. Cockpit bucket seat, carbon dashboard shroud, roll hoop, engine louvers & overhead airbox scoop
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.14), darkTrimMat);
  seatBack.position.set(0, 0.82, -0.44);
  seatBack.rotation.x = -0.22;
  defaultKartGroup.add(seatBack);

  const rollHoop = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 12, 24, Math.PI), chromeMat);
  rollHoop.position.set(0, 1.15, -0.58);
  defaultKartGroup.add(rollHoop);

  const airboxBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.78, 16), paintMat);
  airboxBody.rotation.x = Math.PI / 2 - 0.18;
  airboxBody.position.set(0, 0.98, -0.88);
  airboxBody.castShadow = true;
  defaultKartGroup.add(airboxBody);

  // Rear engine deck cooling louver vents
  for (let lv = 0; lv < 4; lv++) {
    const louver = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.08), carbonMat);
    louver.position.set(0, 0.79 - lv * 0.03, -0.82 - lv * 0.14);
    louver.rotation.x = 0.25;
    defaultKartGroup.add(louver);
  }

  // Shark-fin engine cover stabilizer
  const sharkFin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.76), accentMat);
  sharkFin.position.set(0, 1.15, -1.04);
  defaultKartGroup.add(sharkFin);

  // 6. Swan-neck Rear Wing Struts & Dual-Plane High-Downforce GT Wing
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.24), carbonMat);
    strut.position.set(side * 0.46, 0.98, -1.26);
    strut.rotation.x = -0.22;
    defaultKartGroup.add(strut);

    const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.46, 0.64), accentMat);
    endplate.position.set(side * 0.98, 1.24, -1.36);
    defaultKartGroup.add(endplate);
  }
  const rearWingMain = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.07, 0.38), carbonMat);
  rearWingMain.position.set(0, 1.24, -1.34);
  rearWingMain.rotation.x = 0.14;
  rearWingMain.castShadow = true;
  defaultKartGroup.add(rearWingMain);

  const rearWingFlap = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.05, 0.2), paintMat);
  rearWingFlap.position.set(0, 1.32, -1.48);
  rearWingFlap.rotation.x = 0.32;
  defaultKartGroup.add(rearWingFlap);

  // 7. Full-width LED Rear Taillight Bar + F1 Rain Beacon + Side Brake Lamps
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.095, 0.08), brakeGlow);
  tailBar.position.set(0, 0.64, -1.54);
  defaultKartGroup.add(tailBar);

  const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.08), brakeGlow);
  rainLight.position.set(0, 0.36, -1.62);
  defaultKartGroup.add(rainLight);

  // 8. Dual Lathe-turned Titanium N2O Exhaust Nozzles + Multi-Layer Afterburner Cones
  const flameMat = new THREE.MeshBasicMaterial({
    color: '#22d3ee',
    transparent: true,
    opacity: 0.92,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.96,
  });
  const flameGeo = new THREE.ConeGeometry(0.21, 1.52, 14);
  flameGeo.rotateX(-Math.PI / 2);
  const innerFlameGeo = new THREE.ConeGeometry(0.11, 0.98, 12);
  innerFlameGeo.rotateX(-Math.PI / 2);

  const flameLeft = new THREE.Mesh(flameGeo, flameMat);
  const flameRight = new THREE.Mesh(flameGeo, flameMat);
  flameLeft.add(new THREE.Mesh(innerFlameGeo, innerFlameMat));
  flameRight.add(new THREE.Mesh(innerFlameGeo, innerFlameMat));
  flameLeft.visible = false;
  flameRight.visible = false;

  const nozzlePts = [
    new THREE.Vector2(0.11, 0),
    new THREE.Vector2(0.16, 0.12),
    new THREE.Vector2(0.17, 0.38),
    new THREE.Vector2(0.14, 0.48),
    new THREE.Vector2(0.11, 0.48),
  ];
  const nozzleGeo = new THREE.LatheGeometry(nozzlePts, 18);
  nozzleGeo.rotateX(Math.PI / 2);

  for (const [idx, side] of ([-1, 1] as const).entries()) {
    const exhaust = new THREE.Mesh(nozzleGeo, titaniumExhaustMat);
    exhaust.position.set(side * 0.34, 0.48, -1.82);
    defaultKartGroup.add(exhaust);

    // Anodized blue titanium tip ring
    const tipRing = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 10, 18), accentMat);
    tipRing.position.set(side * 0.34, 0.48, -1.8);
    defaultKartGroup.add(tipRing);

    const flame = idx === 0 ? flameLeft : flameRight;
    flame.position.set(side * 0.34, 0.48, -2.52);
    bodyGroup.add(flame);
  }

  // 9. Curved Smoked-Glass Cockpit Canopy Windshield & F1 Steering Yoke with Telemetry Screen
  const windshield = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.54, 0.48, 18, 1, false, -Math.PI * 0.42, Math.PI * 0.84),
    new THREE.MeshPhysicalMaterial({
      color: '#38bdf8',
      metalness: 0.25,
      roughness: 0.06,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
    })
  );
  windshield.rotation.y = Math.PI;
  windshield.rotation.x = -0.35;
  windshield.position.set(0, 0.83, 0.56);
  defaultKartGroup.add(windshield);

  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.032, 12, 22), carbonMat);
  steeringWheel.position.set(0, 0.92, 0.42);
  steeringWheel.rotation.x = -0.35;
  const dashScreen = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.03), accentMat);
  steeringWheel.add(dashScreen);
  defaultKartGroup.add(steeringWheel);

  // 10. Double-Wishbone Suspension Struts + Coilover Springs + 4 Multi-Spoke Wheels with Brake Discs & Calipers
  const wheels: THREE.Group[] = [];
  const frontWheelPivots: THREE.Group[] = [];
  const wheelPositions: Array<[number, number, number, boolean]> = [
    [-0.98, 0.35, 1.06, true],
    [0.98, 0.35, 1.06, true],
    [-1.04, 0.39, -0.96, false],
    [1.04, 0.39, -0.96, false],
  ];

  for (const [wx, wy, wz, isFront] of wheelPositions) {
    const side = wx < 0 ? -1 : 1;

    // Upper & lower carbon wishbone suspension arms connecting chassis to wheel hub
    for (const dy of [-0.07, 0.08]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.52, 8), carbonMat);
      arm.rotation.z = Math.PI / 2 + side * 0.12;
      arm.position.set(side * 0.72, wy + dy, wz);
      defaultKartGroup.add(arm);
    }

    // Diagonal pushrod coilover shock absorber with anodized spring
    const damper = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.46, 10), accentMat);
    damper.rotation.z = side * 0.65;
    damper.position.set(side * 0.7, wy + 0.14, wz);
    defaultKartGroup.add(damper);

    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    defaultWheelsGroup.add(pivot);
    if (isFront) frontWheelPivots.push(pivot);

    const radius = isFront ? 0.35 : 0.39;
    const width = isFront ? 0.32 : 0.4;

    // Non-rotating brake caliper mounted on hub upright
    const caliper = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.55, radius * 0.48, radius * 0.28),
      caliperMat
    );
    caliper.position.set(-side * 0.05, 0.06, -radius * 0.42);
    pivot.add(caliper);

    const wheelGroup = new THREE.Group();
    pivot.add(wheelGroup);
    wheels.push(wheelGroup);

    // Sculpted rounded racing tire (high-segment cylinder tread + beveled torus sidewalls)
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 28), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    wheelGroup.add(tire);

    for (const swSide of [-1, 1]) {
      const sidewall = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.84, radius * 0.16, 12, 28),
        tireMat
      );
      sidewall.rotation.y = Math.PI / 2;
      sidewall.position.x = swSide * (width * 0.42);
      wheelGroup.add(sidewall);
    }

    // Glowing sidewall tire ring stripe
    const tireStripe = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.72, radius * 0.78, 28),
      accentMat
    );
    tireStripe.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    tireStripe.position.x = side * (width * 0.515);
    wheelGroup.add(tireStripe);

    // Inner ventilated steel brake rotor disc
    const brakeDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, 0.04, 20),
      brakeDiscMat
    );
    brakeDisc.rotation.z = Math.PI / 2;
    brakeDisc.position.x = -side * 0.04;
    wheelGroup.add(brakeDisc);

    // Deep-dish machined alloy outer rim barrel
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.64, radius * 0.64, width * 0.88, 20),
      chromeMat
    );
    rim.rotation.z = Math.PI / 2;
    wheelGroup.add(rim);

    // 5-star twin-spoke alloy wheels + center-lock anodized lug nut
    for (let s = 0; s < 5; s++) {
      const angle = (s / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.03, radius * 0.58, 0.055),
        chromeMat
      );
      spoke.rotation.x = angle;
      spoke.position.y = Math.cos(angle) * radius * 0.28;
      spoke.position.z = Math.sin(angle) * radius * 0.28;
      wheelGroup.add(spoke);
    }

    const centerLock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.09, width + 0.05, 14),
      accentMat
    );
    centerLock.rotation.z = Math.PI / 2;
    wheelGroup.add(centerLock);
  }

  // 11. Articulated Sculpted Driver (Blender/Mixamo-proportioned seated racer + Custom GLB slot)
  const driverGroup = new THREE.Group();
  driverGroup.position.set(0, 0.72, -0.18);
  bodyGroup.add(driverGroup);

  const defaultDriverGroup = new THREE.Group();
  driverGroup.add(defaultDriverGroup);

  const customDriverSlot = new THREE.Group();
  driverGroup.add(customDriverSlot);

  const suitMat = new THREE.MeshStandardMaterial({
    color: preset.suitColor,
    roughness: 0.55,
    metalness: 0.18,
  });
  const suitArmorMat = new THREE.MeshStandardMaterial({
    color: preset.secondaryColor,
    roughness: 0.32,
    metalness: 0.48,
  });
  const helmetMat = new THREE.MeshPhysicalMaterial({
    color: preset.helmetColor,
    roughness: 0.1,
    metalness: 0.38,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
  });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: preset.visorColor,
    metalness: 0.94,
    roughness: 0.05,
    clearcoat: 1.0,
    emissive: preset.visorColor,
    emissiveIntensity: 0.35,
  });
  const scarfMat = new THREE.MeshStandardMaterial({
    color: preset.scarfColor,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });

  // Sculpted torso racing jacket + chest protector + dorsal cyber-spine pack + HANS collar
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.34, 12, 20), suitMat);
  torso.position.set(0, 0.32, 0);
  torso.rotation.x = 0.14;
  torso.castShadow = true;
  defaultDriverGroup.add(torso);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.28, 0.18), suitArmorMat);
  chestPlate.position.set(0, 0.38, 0.12);
  chestPlate.rotation.x = 0.14;
  defaultDriverGroup.add(chestPlate);

  const dorsalPack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.12), suitArmorMat);
  dorsalPack.position.set(0, 0.36, -0.15);
  dorsalPack.rotation.x = 0.14;
  defaultDriverGroup.add(dorsalPack);

  const dorsalCore = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), accentMat);
  dorsalCore.position.set(0, 0.36, -0.2);
  dorsalCore.rotation.x = 0.14;
  defaultDriverGroup.add(dorsalCore);

  const neckCollar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 10, 18), suitArmorMat);
  neckCollar.rotation.x = Math.PI / 2 + 0.1;
  neckCollar.position.set(0, 0.58, 0.02);
  defaultDriverGroup.add(neckCollar);

  // Articulated Seated Thighs, Knee Pads, Shins & Racing Boots inside the cockpit
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.28, 8, 12), suitMat);
    thigh.position.set(side * 0.14, 0.12, 0.24);
    thigh.rotation.x = Math.PI / 2 - 0.25;
    thigh.rotation.z = -side * 0.08;
    defaultDriverGroup.add(thigh);

    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), accentMat);
    kneePad.position.set(side * 0.15, 0.18, 0.42);
    defaultDriverGroup.add(kneePad);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.26, 8, 12), suitArmorMat);
    shin.position.set(side * 0.15, 0.08, 0.58);
    shin.rotation.x = Math.PI / 2 + 0.35;
    defaultDriverGroup.add(shin);
  }

  // Upper arms, elbow pads, forearms & racing gloves gripping the steering yoke
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.118, 14, 14), accentMat);
    shoulder.position.set(side * 0.29, 0.52, 0.02);
    defaultDriverGroup.add(shoulder);

    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.066, 0.24, 8, 12), suitMat);
    upperArm.position.set(side * 0.28, 0.42, 0.16);
    upperArm.rotation.x = 0.85;
    upperArm.rotation.z = side * 0.18;
    defaultDriverGroup.add(upperArm);

    const elbowPad = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 10), suitArmorMat);
    elbowPad.position.set(side * 0.26, 0.34, 0.27);
    defaultDriverGroup.add(elbowPad);

    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.24, 8, 12), suitArmorMat);
    forearm.position.set(side * 0.22, 0.31, 0.39);
    forearm.rotation.x = Math.PI / 2 - 0.15;
    forearm.rotation.z = side * 0.26;
    defaultDriverGroup.add(forearm);

    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), accentMat);
    glove.position.set(side * 0.16, 0.28, 0.55);
    defaultDriverGroup.add(glove);
  }

  // Full-face aerodynamic racing helmet + chin guard + iridium visor + dual aero stabilizer fins
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.275, 28, 22), helmetMat);
  helmet.scale.set(0.95, 1.0, 1.08);
  helmet.position.set(0, 0.83, 0.04);
  helmet.castShadow = true;
  defaultDriverGroup.add(helmet);

  const chinBar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.25, 0.16, 18, 1, false, -Math.PI * 0.45, Math.PI * 0.9),
    suitArmorMat
  );
  chinBar.position.set(0, 0.73, 0.08);
  defaultDriverGroup.add(chinBar);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.268, 22, 14, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.28, Math.PI * 0.34),
    visorMat
  );
  visor.position.set(0, 0.84, 0.09);
  visor.rotation.y = Math.PI / 2;
  defaultDriverGroup.add(visor);

  const helmetCrest = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.44), accentMat);
  helmetCrest.position.set(0, 1.08, -0.02);
  helmetCrest.rotation.x = -0.14;
  defaultDriverGroup.add(helmetCrest);

  // Side helmet audio comms pods & aerodynamic cat-ear/winglet vents
  for (const side of [-1, 1]) {
    const earPod = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 14), accentMat);
    earPod.rotation.z = Math.PI / 2;
    earPod.position.set(side * 0.26, 0.82, 0.02);
    defaultDriverGroup.add(earPod);

    const aeroWinglet = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 6), accentMat);
    aeroWinglet.position.set(side * 0.16, 1.05, -0.08);
    aeroWinglet.rotation.x = -0.5;
    aeroWinglet.rotation.z = -side * 0.35;
    defaultDriverGroup.add(aeroWinglet);
  }

  // Fluttering racing scarf (Zing Speed signature anime vibe!)
  const scarfGeo = new THREE.PlaneGeometry(0.22, 0.86, 2, 6);
  scarfGeo.translate(0, -0.38, 0);
  const scarfMesh = new THREE.Mesh(scarfGeo, scarfMat);
  scarfMesh.position.set(0, 0.62, -0.22);
  scarfMesh.rotation.x = 1.25;
  defaultDriverGroup.add(scarfMesh);

  let nameTagSprite: THREE.Sprite | undefined;
  if (showLabel && labelName) {
    nameTagSprite = createNameTagSprite(labelName, preset.accentColor);
    root.add(nameTagSprite);
  }

  // Enable soft real-time shadow casting & self-shadowing across all opaque kart and driver parts
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    if (mat && !mat.transparent) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  return {
    root,
    bodyGroup,
    defaultKartGroup,
    defaultWheelsGroup,
    customKartSlot,
    driverGroup,
    defaultDriverGroup,
    customDriverSlot,
    scarfMesh,
    steeringWheel,
    wheels,
    frontWheelPivots,
    flameLeft,
    flameRight,
    brakeGlow,
    hitFlashMaterials: [paintMat, accentMat],
    nameTagSprite,
  };
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.userData?.__skipDisposeOnSlotClear) return;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.map) std.map.dispose();
        if (std.normalMap) std.normalMap.dispose();
        if (std.roughnessMap) std.roughnessMap.dispose();
        if (std.metalnessMap) std.metalnessMap.dispose();
        if (std.emissiveMap) std.emissiveMap.dispose();
        m.dispose();
      }
    }
  });
}

export function cloneCustomModelInstance(template: THREE.Group): THREE.Group {
  const cloned = cloneSkeletonSafe(template) as THREE.Group;
  cloned.traverse((child) => {
    child.userData.__skipDisposeOnSlotClear = true;
  });
  return cloned;
}

/**
 * Loads a Blender / Sketchfab / Mixamo .GLB or .GLTF asset directly from File or URL,
 * auto-normalizes scale and bottom-center pivot so it applies instantaneously as either
 * a Kart vehicle body or a Cockpit Driver character.
 */
export async function loadCustomGLBModel(
  source: File | string,
  kind: ModelSlotKind,
  companionFiles?: File[]
): Promise<THREE.Group> {
  const companionUrls: string[] = [];
  const manager = new THREE.LoadingManager();

  if (companionFiles && companionFiles.length > 0) {
    const mapByName = new Map<string, string>();
    for (const cf of companionFiles) {
      const url = URL.createObjectURL(cf);
      companionUrls.push(url);
      mapByName.set(cf.name.toLowerCase(), url);
    }
    manager.setURLModifier((requestedUrl) => {
      const cleanName = decodeURIComponent(requestedUrl.split(/[\\/]/).pop() || '')
        .split('?')[0]
        .toLowerCase();
      return mapByName.get(cleanName) ?? requestedUrl;
    });
  }

  const loader = new GLTFLoader(manager);
  let gltf;

  try {
    if (typeof source === 'string') {
      gltf = await loader.loadAsync(source);
    } else {
      const validation = validateModelFileName(source.name);
      if (!validation.ok) {
        throw new Error(validation.error);
      }
      if (validation.ext === '.glb') {
        const buffer = await source.arrayBuffer();
        gltf = await loader.parseAsync(buffer, '');
      } else {
        const objectUrl = URL.createObjectURL(source);
        try {
          gltf = await loader.loadAsync(objectUrl);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    }
  } finally {
    for (const url of companionUrls) {
      URL.revokeObjectURL(url);
    }
  }

  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    throw new Error('File 3D không có dữ liệu hình khối (mesh) hợp lệ.');
  }

  const norm = computeModelNormalizationTransform(box.min, box.max, kind, 0, 1);
  model.scale.setScalar(norm.scale);
  model.position.set(norm.offsetX, norm.offsetY, norm.offsetZ);

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const wrapper = new THREE.Group();
  wrapper.add(model);
  return wrapper;
}

/**
 * Backward-compatible helper for URL-based driver GLB loading.
 */
export async function loadCustomDriverGLB(url: string): Promise<THREE.Group> {
  return loadCustomGLBModel(url, 'driver');
}

/**
 * Builds the entire 3D City World for any of the 10 famous world cities:
 * Curved ribbon track with asphalt normal map, guardrails, streetlight poles,
 * start gantry, boost pads, extended textured landscape, instanced skyline/trees,
 * and iconic signature 3D landmarks.
 */
export interface CitizenInstanceData {
  mode: 'spectator' | 'walker';
  // For spectators (stationary base position + facing yaw)
  baseX: number;
  baseY: number;
  baseZ: number;
  yaw: number;
  // For walkers (moving along track spline at lateral offset)
  trackT: number;
  walkSpeedT: number;
  walkDir: 1 | -1;
  lateralDist: number;
  phase: number;
  scale: number;
  hasProp: boolean;
}

export interface CityCrowdRefs {
  citizens: CitizenInstanceData[];
  legsInst: THREE.InstancedMesh;
  torsoInst: THREE.InstancedMesh;
  headInst: THREE.InstancedMesh;
  hatInst: THREE.InstancedMesh;
  leftArmInst: THREE.InstancedMesh;
  rightArmInst: THREE.InstancedMesh;
  propInst: THREE.InstancedMesh;
}

export interface CityWorldRefs {
  group: THREE.Group;
  boostPadMaterials: THREE.MeshStandardMaterial[];
  skyDome: THREE.Mesh;
  skyDomeMat: THREE.MeshBasicMaterial;
  roadMat: THREE.MeshStandardMaterial;
  groundMat: THREE.MeshStandardMaterial;
  sunsetSun: THREE.Group;
  sunsetDiscMat: THREE.MeshBasicMaterial;
  sunsetHaloMat: THREE.MeshBasicMaterial;
  lampHaloMat: THREE.MeshBasicMaterial;
  crowd: CityCrowdRefs;
}

export function buildCityWorld(track: TrackData, maxAnisotropy: number): CityWorldRefs {
  const { city, samples } = track;
  const group = new THREE.Group();
  const boostPadMaterials: THREE.MeshStandardMaterial[] = [];

  // 1. Sky Dome (horizon-matched, tintable by weather)
  const skyTex = createSkyDomeTexture(city.skyTop, city.skyHorizon);
  const skyDomeMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    color: 0xffffff,
    side: THREE.BackSide,
    fog: false,
  });
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(520, 28, 18),
    skyDomeMat
  );
  group.add(skyDome);

  // Horizon Sunset Solar Disc & Halo (revealed smoothly during sunset weather)
  const sunsetSun = new THREE.Group();
  sunsetSun.position.set(165, 38, -280);
  const sunsetDiscMat = new THREE.MeshBasicMaterial({
    color: '#fef08a',
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const sunsetDisc = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 18), sunsetDiscMat);
  const sunsetHaloMat = new THREE.MeshBasicMaterial({
    color: '#fb923c',
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const sunsetHalo = new THREE.Mesh(new THREE.SphereGeometry(38, 24, 18), sunsetHaloMat);
  sunsetSun.add(sunsetHalo, sunsetDisc);
  sunsetSun.visible = false;
  group.add(sunsetSun);

  // 2. Extended Ground Terrain & Optional Reflective Water + Distant Horizon Mountains
  const centerX = (track.minX + track.maxX) * 0.5;
  const centerZ = (track.minZ + track.maxZ) * 0.5;

  const terrainTex = createTerrainTexture(city.groundColor, city.id);
  const groundMat = new THREE.MeshStandardMaterial({
    color: city.groundColor,
    map: terrainTex,
    roughness: 0.9,
    metalness: 0.04,
    envMapIntensity: 0.14,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(540, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centerX, -0.35, centerZ);
  ground.receiveShadow = true;
  group.add(ground);

  if (city.waterColor) {
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: city.waterColor,
      roughness: 0.1,
      metalness: 0.55,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(185, 48), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(centerX + 8, -0.18, centerZ - 12);
    group.add(water);
  }

  // 3. Curved Ribbon Road Mesh + 3D Asphalt Road Bed Slab with Normal Map
  const n = samples.length;
  const halfW = city.roadWidth * 0.5;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];

  let accumDist = 0;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    if (i > 0) {
      const prev = samples[(i - 1) % n];
      accumDist += Math.hypot(
        s.point.x - prev.point.x,
        s.point.y - prev.point.y,
        s.point.z - prev.point.z
      );
    }

    const lx = s.point.x - s.right.x * halfW;
    const ly = s.point.y;
    const lz = s.point.z - s.right.z * halfW;

    const rx = s.point.x + s.right.x * halfW;
    const ry = s.point.y;
    const rz = s.point.z + s.right.z * halfW;

    const vIdx = i * 2;
    positions[vIdx * 3] = lx;
    positions[vIdx * 3 + 1] = ly;
    positions[vIdx * 3 + 2] = lz;

    positions[(vIdx + 1) * 3] = rx;
    positions[(vIdx + 1) * 3 + 1] = ry;
    positions[(vIdx + 1) * 3 + 2] = rz;

    const vCoord = accumDist / 16;
    uvs[vIdx * 2] = 0;
    uvs[vIdx * 2 + 1] = vCoord;
    uvs[(vIdx + 1) * 2] = 1;
    uvs[(vIdx + 1) * 2 + 1] = vCoord;

    if (i < n) {
      const a = vIdx;
      const b = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  roadGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  roadGeo.setIndex(indices);
  roadGeo.computeVertexNormals();

  const roadTex = createRoadTexture(
    city.roadColor,
    city.curbPrimary,
    city.curbSecondary,
    city.accentHex,
    maxAnisotropy
  );
  const roadNormalTex = createAsphaltNormalTexture(maxAnisotropy);
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTex,
    normalMap: roadNormalTex,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.72,
    metalness: 0.08,
    envMapIntensity: 0.2,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Outer Boulevard Sidewalk / Promenade Pavement Ribbons (Left & Right pedestrian walkways)
  const swPositions = new Float32Array((n + 1) * 4 * 3);
  const swIndices: number[] = [];
  const swInner = halfW + 1.05;
  const swOuter = halfW + 4.35;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    const base = i * 4;
    // Left inner & outer
    swPositions[base * 3] = s.point.x - s.right.x * swInner;
    swPositions[base * 3 + 1] = s.point.y + 0.08;
    swPositions[base * 3 + 2] = s.point.z - s.right.z * swInner;

    swPositions[(base + 1) * 3] = s.point.x - s.right.x * swOuter;
    swPositions[(base + 1) * 3 + 1] = s.point.y + 0.08;
    swPositions[(base + 1) * 3 + 2] = s.point.z - s.right.z * swOuter;

    // Right inner & outer
    swPositions[(base + 2) * 3] = s.point.x + s.right.x * swInner;
    swPositions[(base + 2) * 3 + 1] = s.point.y + 0.08;
    swPositions[(base + 2) * 3 + 2] = s.point.z + s.right.z * swInner;

    swPositions[(base + 3) * 3] = s.point.x + s.right.x * swOuter;
    swPositions[(base + 3) * 3 + 1] = s.point.y + 0.08;
    swPositions[(base + 3) * 3 + 2] = s.point.z + s.right.z * swOuter;

    if (i < n) {
      const next = (i + 1) * 4;
      // Left sidewalk: base+1 is outer left, base is inner left -> CCW upward normal (+Y)
      swIndices.push(base + 1, base, next + 1, base, next, next + 1);
      // Right sidewalk: base+2 is inner right, base+3 is outer right -> CCW upward normal (+Y)
      swIndices.push(base + 2, base + 3, next + 2, base + 3, next + 3, next + 2);
    }
  }
  const swGeo = new THREE.BufferGeometry();
  swGeo.setAttribute('position', new THREE.BufferAttribute(swPositions, 3));
  swGeo.setIndex(swIndices);
  swGeo.computeVertexNormals();
  const swColor =
    city.id === 'rio'
      ? '#cbd5e1'
      : city.id === 'rome' || city.id === 'paris'
      ? '#b8a99a'
      : city.id === 'hanoi'
      ? '#9ca3af'
      : '#334155';
  const swMesh = new THREE.Mesh(
    swGeo,
    new THREE.MeshStandardMaterial({
      color: swColor,
      roughness: 0.85,
      metalness: 0.06,
      envMapIntensity: 0.16,
    })
  );
  swMesh.receiveShadow = true;
  group.add(swMesh);

  // Elevated Highway Concrete Viaduct Support Columns under raised track sections
  const viaductMat = new THREE.MeshStandardMaterial({
    color: '#475569',
    roughness: 0.75,
    metalness: 0.2,
  });
  for (let i = 0; i < n; i += 8) {
    const s = samples[i];
    if (s.point.y > 0.65) {
      const colH = s.point.y + 0.45;
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(city.roadWidth * 0.88, 0.55, 1.8),
        viaductMat
      );
      beam.position.set(s.point.x, s.point.y - 0.3, s.point.z);
      beam.rotation.y = yaw;
      group.add(beam);

      for (const side of [-1, 1]) {
        const pier = new THREE.Mesh(
          new THREE.CylinderGeometry(0.65, 0.82, colH, 10),
          viaductMat
        );
        pier.position.set(
          s.point.x + s.right.x * (halfW * 0.62) * side,
          s.point.y - colH * 0.5,
          s.point.z + s.right.z * (halfW * 0.62) * side
        );
        group.add(pier);
      }
    }
  }

  // 4. Instanced Trackside Guardrail Barriers & Cantilevered Streetlight Poles
  const barrierCount = Math.floor(n / 2) * 2;
  const barrierGeo = new THREE.BoxGeometry(0.48, 0.84, 4.35);
  const barrierMat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    roughness: 0.4,
    metalness: 0.42,
  });
  const barrierInst = new THREE.InstancedMesh(barrierGeo, barrierMat, barrierCount);
  const dummy = new THREE.Object3D();
  const c1 = new THREE.Color(city.curbPrimary);
  const c2 = new THREE.Color('#f1f5f9');
  let bIdx = 0;

  for (let i = 0; i < n; i += 2) {
    const s = samples[i];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      const dist = halfW + 0.58;
      dummy.position.set(
        s.point.x + s.right.x * dist * side,
        s.point.y + 0.42,
        s.point.z + s.right.z * dist * side
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      barrierInst.setMatrixAt(bIdx, dummy.matrix);
      barrierInst.setColorAt(bIdx, (i / 2) % 2 === 0 ? c1 : c2);
      bIdx++;
    }
  }
  barrierInst.instanceMatrix.needsUpdate = true;
  if (barrierInst.instanceColor) barrierInst.instanceColor.needsUpdate = true;
  barrierInst.computeBoundingSphere();
  group.add(barrierInst);

  // Mid-track City Highway Sign Gantries & Apex Turn Warning Boards
  const signGantryMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    metalness: 0.72,
    roughness: 0.28,
  });
  const signBoardMat = new THREE.MeshStandardMaterial({
    color: city.neonMode ? '#0f172a' : '#065f46',
    emissive: city.accentHex,
    emissiveIntensity: 0.35,
    roughness: 0.25,
  });
  for (const gt of [0.22, 0.52, 0.78]) {
    const gs = sampleTrackAt(track, gt);
    const gYaw = Math.atan2(gs.tangent.x, gs.tangent.z);
    const gArch = new THREE.Group();
    gArch.position.set(gs.point.x, gs.point.y, gs.point.z);
    gArch.rotation.y = gYaw;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 8.2, 8), signGantryMat);
      post.position.set(side * (halfW + 1.15), 4.1, 0);
      gArch.add(post);
    }
    const truss = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 2.8, 0.65, 0.65), signGantryMat);
    truss.position.set(0, 7.9, 0);
    const board = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth * 0.58, 1.75, 0.28), signBoardMat);
    board.position.set(0, 7.75, 0.35);
    gArch.add(truss, board);
    group.add(gArch);
  }

  // Instanced Trackside Cantilever Streetlight Poles + Glowing LED Lamp Heads
  const poleStep = 8;
  const poleSamples: Array<{ x: number; y: number; z: number; lx: number; lz: number; yaw: number }> = [];
  for (let i = 2; i < n; i += poleStep) {
    const s = samples[i];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      const dist = halfW + 1.3;
      const lampDist = halfW - 0.55;
      poleSamples.push({
        x: s.point.x + s.right.x * dist * side,
        y: s.point.y,
        z: s.point.z + s.right.z * dist * side,
        lx: s.point.x + s.right.x * lampDist * side,
        lz: s.point.z + s.right.z * lampDist * side,
        yaw: yaw + (side === 1 ? -Math.PI / 2 : Math.PI / 2),
      });
    }
  }

  const lampHaloMat = new THREE.MeshBasicMaterial({
    color: city.neonMode ? city.accentHex : '#fef08a',
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  if (poleSamples.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.17, 7.6, 8);
    poleGeo.translate(0, 3.8, 0);
    const poleMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      metalness: 0.78,
      roughness: 0.28,
    });
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, poleSamples.length);

    const lampGeo = new THREE.BoxGeometry(1.9, 0.18, 0.42);
    const lampMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: city.neonMode ? city.accentHex : '#fef08a',
      emissiveIntensity: 1.4,
      roughness: 0.15,
    });
    const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, poleSamples.length);

    // Volumetric light-cone beam beneath each streetlamp head (glows through fog, rain, and dusk)
    const coneGeo = new THREE.ConeGeometry(2.6, 6.8, 12, 1, true);
    const coneInst = new THREE.InstancedMesh(coneGeo, lampHaloMat, poleSamples.length);

    poleSamples.forEach((p, idx) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(idx, dummy.matrix);

      const headX = (p.x + p.lx) * 0.5;
      const headZ = (p.z + p.lz) * 0.5;
      dummy.position.set(headX, p.y + 7.5, headZ);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.updateMatrix();
      lampInst.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(headX, p.y + 4.0, headZ);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      coneInst.setMatrixAt(idx, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    lampInst.instanceMatrix.needsUpdate = true;
    coneInst.instanceMatrix.needsUpdate = true;
    poleInst.computeBoundingSphere();
    lampInst.computeBoundingSphere();
    coneInst.computeBoundingSphere();
    group.add(poleInst, lampInst, coneInst);
  }

  // 5. Start / Finish Line Decal & Iconic Space-Frame Overhead Gantry Arch with 5 Starting Lights
  const startSample = sampleTrackAt(track, 0);
  const startYaw = Math.atan2(startSample.tangent.x, startSample.tangent.z);
  const startGroup = new THREE.Group();
  startGroup.position.set(startSample.point.x, startSample.point.y, startSample.point.z);
  startGroup.rotation.y = startYaw;
  group.add(startGroup);

  const checkStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(city.roadWidth - 1.0, 4.2),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createStartLineTexture(maxAnisotropy),
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  checkStrip.rotation.x = -Math.PI / 2;
  checkStrip.position.y = 0.04;
  startGroup.add(checkStrip);

  const gantryMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    metalness: 0.78,
    roughness: 0.24,
  });
  const gantryAccent = new THREE.MeshStandardMaterial({
    color: city.accentHex,
    emissive: city.accentHex,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const startPodLightMat = new THREE.MeshStandardMaterial({
    color: '#22c55e',
    emissive: '#22c55e',
    emissiveIntensity: 1.3,
    roughness: 0.15,
  });

  for (const side of [-1, 1]) {
    for (const dz of [-0.45, 0.45]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 8.8, 12), gantryMat);
      col.position.set(side * (halfW + 1.05), 4.4, dz);
      col.castShadow = true;
      startGroup.add(col);
    }
    const basePlinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.8), gantryMat);
    basePlinth.position.set(side * (halfW + 1.05), 0.6, 0);
    startGroup.add(basePlinth);

    const sideFin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.8, 1.4), gantryAccent);
    sideFin.position.set(side * (halfW + 1.65), 4.4, 0);
    startGroup.add(sideFin);
  }

  const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 3.6, 1.55, 1.6), gantryMat);
  crossBeam.position.set(0, 8.3, 0);
  startGroup.add(crossBeam);

  const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 1.6, 0.28, 1.72), gantryAccent);
  lightStrip.position.set(0, 7.62, 0);
  startGroup.add(lightStrip);

  for (let i = -2; i <= 2; i++) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.92, 0.42), gantryMat);
    pod.position.set(i * 1.8, 7.15, 0.72);
    startGroup.add(pod);

    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), startPodLightMat);
    lens.position.set(i * 1.8, 7.15, 0.92);
    startGroup.add(lens);
  }

  // 6. Glowing Boost Pads along the Track (wider for expanded tracks)
  const padTex = createBoostPadTexture(city.accentHex, maxAnisotropy);
  for (const padT of city.boostPads) {
    const ps = sampleTrackAt(track, padT);
    const padYaw = Math.atan2(ps.tangent.x, ps.tangent.z);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: padTex,
      emissive: '#0ea5e9',
      emissiveIntensity: 0.75,
      roughness: 0.18,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    boostPadMaterials.push(padMat);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 13.5), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = -padYaw;
    pad.position.set(ps.point.x, ps.point.y + 0.05, ps.point.z);
    group.add(pad);
  }

  // 7. Instanced City Skyline Buildings, Rooftops, Grandstands & Stylized Trees
  addCitySkylineAndTrees(group, track, maxAnisotropy);

  // 8. Authentic Street-Level Cultural Architecture & Props per City (Buses, Taxis, Lanterns, Cafés, Boats, Shophouses...)
  buildCityCharacteristicProps(group, track);

  // 9. Animated 3D Citizens, Cheering Spectators in Grandstands & Strolling Pedestrians along the Sidewalks
  const crowd = buildCityCrowdAndSpectators(group, track);
  updateCityCrowdInternal(crowd, track, 0);

  // 10. Signature Multi-Monument Cityscape Complex (prominently visible from start vista & around circuit!)
  const landmark = createCityLandmark(city.landmarkType, city.accentHex);
  const vistaX = 76;
  const vistaZ = -68;
  landmark.position.set(vistaX, -0.35, vistaZ);
  group.add(landmark);

  // 11. Enable real-time dynamic shadow map casting & receiving across all environmental objects
  const receiveOnlyMeshes = new Set<THREE.Object3D>([
    ground,
    roadMesh,
    swMesh,
    checkStrip,
  ]);
  const noShadowMeshes = new Set<THREE.Object3D>([
    skyDome,
    sunsetSun,
  ]);

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || noShadowMeshes.has(mesh)) return;
    if (receiveOnlyMeshes.has(mesh)) {
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      return;
    }
    const mat = mesh.material as THREE.Material;
    if (!mat || mat.transparent) return;
    if (boostPadMaterials.includes(mat as THREE.MeshStandardMaterial)) {
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  return {
    group,
    boostPadMaterials,
    skyDome,
    skyDomeMat,
    roadMat,
    groundMat,
    sunsetSun,
    sunsetDiscMat,
    sunsetHaloMat,
    lampHaloMat,
    crowd,
  };
}

function isNearTrack(track: TrackData, x: number, z: number, margin: number): boolean {
  const minDistSq = margin * margin;
  for (let i = 0; i < track.samples.length; i += 2) {
    const p = track.samples[i].point;
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < minDistSq) return true;
  }
  return false;
}

function addCitySkylineAndTrees(
  group: THREE.Group,
  track: TrackData,
  maxAnisotropy: number
): void {
  const { city } = track;
  const centerX = (track.minX + track.maxX) * 0.5;
  const centerZ = (track.minZ + track.maxZ) * 0.5;

  const facadeTex = createBuildingFacadeTexture(
    city.neonMode ? '#141e36' : city.id === 'cairo' ? '#c29863' : city.id === 'hanoi' ? '#d97706' : '#475569',
    city.neonMode ? '#38bdf8' : '#fef3c7',
    Boolean(city.neonMode),
    maxAnisotropy
  );

  // Deterministic pseudo-random per city so layouts look curated and never flicker
  let seed = city.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0) * 31, 17);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // Instanced urban buildings + stepped architectural penthouse crowns
  const bPositions: Array<{ x: number; z: number; sx: number; sy: number; sz: number; ry: number }> = [];
  for (let i = 0; i < 260 && bPositions.length < 88; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 36 + rand() * 235;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    // Keep main landmark vista plaza clear
    if (Math.hypot(x - 76, z + 68) < 52) continue;
    if (isNearTrack(track, x, z, city.roadWidth * 0.5 + 14.5)) continue;

    const tallCity = city.id === 'tokyo' || city.id === 'newyork' || city.id === 'dubai';
    const lowHistoric = city.id === 'hanoi' || city.id === 'rome' || city.id === 'cairo';
    const sx = 9 + rand() * 14;
    const sz = 9 + rand() * 14;
    const sy = tallCity
      ? 26 + rand() * 68
      : lowHistoric
      ? 8 + rand() * 18
      : 14 + rand() * 30;
    bPositions.push({ x, z, sx, sy, sz, ry: rand() * Math.PI });
  }

  if (bPositions.length > 0) {
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    const bMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: facadeTex,
      roughness: 0.42,
      metalness: city.neonMode ? 0.45 : 0.25,
    });
    const bInst = new THREE.InstancedMesh(bGeo, bMat, bPositions.length);

    // Rooftop stepped crown / tiled roof & glowing beacon layer
    const isPitchedRoof = city.id === 'hanoi' || city.id === 'rome' || city.id === 'paris';
    const crownGeo = isPitchedRoof
      ? new THREE.ConeGeometry(0.76, 0.24, 4)
      : new THREE.BoxGeometry(0.74, 0.14, 0.74);
    if (isPitchedRoof) crownGeo.rotateY(Math.PI / 4);
    crownGeo.translate(0, isPitchedRoof ? 0.12 : 0.07, 0);

    const crownColor =
      city.id === 'hanoi' || city.id === 'rome'
        ? '#991b1b'
        : city.id === 'paris'
        ? '#334155'
        : city.neonMode
        ? city.accentHex
        : '#334155';
    const crownMat = new THREE.MeshStandardMaterial({
      color: crownColor,
      emissive: city.neonMode ? city.accentHex : '#0f172a',
      emissiveIntensity: city.neonMode ? 0.55 : 0.08,
      roughness: 0.4,
      metalness: 0.45,
    });
    const roofInst = new THREE.InstancedMesh(crownGeo, crownMat, bPositions.length);

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    bPositions.forEach((b, idx) => {
      dummy.position.set(b.x, -0.35, b.z);
      dummy.rotation.set(0, b.ry, 0);
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix();
      bInst.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(b.x, -0.35 + b.sy, b.z);
      dummy.scale.set(b.sx, Math.max(2.6, b.sy * 0.15), b.sz);
      dummy.updateMatrix();
      roofInst.setMatrixAt(idx, dummy.matrix);

      const shade = 0.78 + rand() * 0.28;
      tint.setRGB(shade, shade, shade);
      bInst.setColorAt(idx, tint);
    });
    bInst.instanceMatrix.needsUpdate = true;
    roofInst.instanceMatrix.needsUpdate = true;
    if (bInst.instanceColor) bInst.instanceColor.needsUpdate = true;
    bInst.computeBoundingSphere();
    roofInst.computeBoundingSphere();
    group.add(bInst, roofInst);
  }

  // Instanced multi-canopy trees (cherry blossoms in Tokyo, palms in Dubai/Cairo/Rio, cypress in Rome, lush green elsewhere)
  const treeCoords: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < 250 && treeCoords.length < 72; i++) {
    const s = track.samples[Math.floor(rand() * track.samples.length)];
    const side = rand() > 0.5 ? 1 : -1;
    const dist = city.roadWidth * 0.5 + 6.5 + rand() * 22;
    const x = s.point.x + s.right.x * dist * side;
    const z = s.point.z + s.right.z * dist * side;
    if (Math.hypot(x - 76, z + 68) < 42) continue;
    if (isNearTrack(track, x, z, city.roadWidth * 0.5 + 5.0)) continue;
    treeCoords.push({ x, z, s: 0.85 + rand() * 0.45 });
  }

  if (treeCoords.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.26, 0.44, 3.8, 10);
    trunkGeo.translate(0, 1.9, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);

    const isCypress = city.id === 'rome';
    const crownGeo = isCypress
      ? new THREE.ConeGeometry(1.35, 6.4, 10)
      : new THREE.IcosahedronGeometry(2.2, 1);
    crownGeo.translate(0, isCypress ? 5.2 : 4.6, 0);

    const crownColor =
      city.id === 'tokyo'
        ? '#f9a8d4'
        : city.id === 'cairo' || city.id === 'dubai'
        ? '#65a30d'
        : '#22c55e';
    const crownMat = new THREE.MeshStandardMaterial({
      color: crownColor,
      roughness: 0.78,
    });
    const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, treeCoords.length);
    const crownSubInst = new THREE.InstancedMesh(crownGeo, crownMat, treeCoords.length);

    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    treeCoords.forEach((t, idx) => {
      dummy.position.set(t.x, -0.35, t.z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      crownInst.setMatrixAt(idx, dummy.matrix);

      // Secondary offset canopy lobe for rich multi-part foliage silhouette
      dummy.position.set(t.x + 1.15 * t.s, -0.75, t.z + 0.85 * t.s);
      dummy.scale.setScalar(t.s * 0.74);
      dummy.updateMatrix();
      crownSubInst.setMatrixAt(idx, dummy.matrix);

      c.set(crownColor).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.14);
      crownInst.setColorAt(idx, c);
      c.offsetHSL(0, 0, -0.06);
      crownSubInst.setColorAt(idx, c);
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    crownSubInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
    if (crownSubInst.instanceColor) crownSubInst.instanceColor.needsUpdate = true;
    trunkInst.computeBoundingSphere();
    crownInst.computeBoundingSphere();
    crownSubInst.computeBoundingSphere();
    group.add(trunkInst, crownInst, crownSubInst);
  }
}

/**
 * Accurate Multi-Monument 3D Architectural Cityscape Complexes for all 10 World Cities!
 * Built around the central vista (76, -0.35, -68) + horizon backdrop monuments.
 */
function createCityLandmark(cityId: CityId, accentHex: string): THREE.Group {
  const g = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#d6c7a9', roughness: 0.78, metalness: 0.08 });
  const steelMat = new THREE.MeshPhysicalMaterial({
    color: '#cbd5e1',
    roughness: 0.22,
    metalness: 0.88,
    clearcoat: 0.6,
  });
  const goldMat = new THREE.MeshPhysicalMaterial({
    color: '#f59e0b',
    roughness: 0.2,
    metalness: 0.85,
    clearcoat: 0.8,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 1.0,
    roughness: 0.18,
  });

  if (cityId === 'tokyo') {
    // 1. Tokyo Tower (Crimson & White Lattice Spire + 2 Observation Decks)
    const redMat = new THREE.MeshPhysicalMaterial({
      color: '#ef4444',
      roughness: 0.26,
      metalness: 0.55,
      clearcoat: 0.7,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3, metalness: 0.35 });

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.3, 24, 8), redMat);
        leg.position.set(sx * 8.2, 11, sz * 8.2);
        leg.rotation.z = sx * 0.24;
        leg.rotation.x = -sz * 0.24;
        g.add(leg);
      }
    }
    const lowerDeck = new THREE.Mesh(new THREE.BoxGeometry(17.5, 4.4, 17.5), whiteMat);
    lowerDeck.position.y = 22;
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 7.6, 24, 8), redMat);
    mid.position.y = 35;
    const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(12, 4.8, 12), glowMat);
    upperDeck.position.y = 46;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 4.0, 32, 8), whiteMat);
    top.position.y = 64;
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.58, 20, 8), redMat);
    antenna.position.y = 89;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 12), glowMat);
    beacon.position.y = 99;
    g.add(lowerDeck, mid, upperDeck, top, antenna, beacon);

    // 2. Traditional 5-Story Senso-ji Asakusa Pagoda & Vermilion Torii Gate
    const pagodaRoot = new THREE.Group();
    pagodaRoot.position.set(32, 0, 22);
    const darkRoofMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5, metalness: 0.4 });
    for (let tier = 0; tier < 5; tier++) {
      const w = 10.5 - tier * 1.3;
      const y = 3.2 + tier * 5.8;
      const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 4.2, w * 0.72), redMat);
      core.position.y = y;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.92, 2.4, 4), darkRoofMat);
      roof.position.y = y + 2.8;
      roof.rotation.y = Math.PI / 4;
      pagodaRoot.add(core, roof);
    }
    const sorinFinial = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 8.5, 10), goldMat);
    sorinFinial.position.y = 35;
    pagodaRoot.add(sorinFinial);
    g.add(pagodaRoot);

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 15.5, 12), redMat);
      post.position.set(-26 + side * 6.8, 7.75, 24);
      g.add(post);
    }
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(18.5, 1.65, 2.3), redMat);
    kasagi.position.set(-26, 15.5, 24);
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.15, 1.45), redMat);
    nuki.position.set(-26, 12.4, 24);
    g.add(kasagi, nuki);

    // 3. Distant Snow-Capped Mount Fuji on the Northern Horizon + Rainbow Suspension Bridge
    const fujiRock = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 86, 76, 32),
      new THREE.MeshStandardMaterial({ color: '#3b4268', roughness: 0.85 })
    );
    fujiRock.position.set(45, 38, -210);
    const fujiSnow = new THREE.Mesh(
      new THREE.CylinderGeometry(18.2, 42, 28, 32),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.4 })
    );
    fujiSnow.position.set(45, 62.5, -210);
    g.add(fujiRock, fujiSnow);
  } else if (cityId === 'paris') {
    // 1. Iconic Eiffel Tower with 4 arched legs, base arches, 3 observation decks & golden beacon
    const ironMat = new THREE.MeshStandardMaterial({ color: '#785c48', roughness: 0.42, metalness: 0.72 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(3.3, 27, 3.3), ironMat);
        leg.position.set(sx * 7.8, 12.5, sz * 7.8);
        leg.rotation.z = sx * 0.23;
        leg.rotation.x = -sz * 0.23;
        g.add(leg);
      }
    }
    for (let rot = 0; rot < 2; rot++) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(7.0, 0.78, 10, 24, Math.PI), ironMat);
      arch.position.set(0, 1.5, 0);
      arch.rotation.y = rot * (Math.PI / 2);
      g.add(arch);
    }
    const deck1 = new THREE.Mesh(new THREE.BoxGeometry(17.2, 2.6, 17.2), ironMat);
    deck1.position.y = 23;
    const midTower = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 6.6, 29, 8), ironMat);
    midTower.position.y = 38.5;
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(9.0, 2.5, 9.0), goldMat);
    deck2.position.y = 50.5;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 2.8, 32, 8), ironMat);
    spire.position.y = 67;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 14), glowMat);
    beacon.position.y = 84;
    g.add(deck1, midTower, deck2, spire, beacon);

    // 2. Monumental Arc de Triomphe (Khải Hoàn Môn) with vaulted central arch & attic cornice
    const arcGroup = new THREE.Group();
    arcGroup.position.set(-34, 0, 24);
    for (const sx of [-1, 1]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(7.5, 19, 11.5), stoneMat);
      pier.position.set(sx * 6.8, 9.5, 0);
      arcGroup.add(pier);
    }
    const attic = new THREE.Mesh(new THREE.BoxGeometry(22.5, 6.5, 12.2), stoneMat);
    attic.position.y = 22.2;
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(24, 1.5, 13.4), goldMat);
    cornice.position.y = 19.2;
    arcGroup.add(attic, cornice);
    g.add(arcGroup);

    // 3. Louvre Glass Pyramid & Notre-Dame Twin Towers
    const louvreGlass = new THREE.Mesh(
      new THREE.ConeGeometry(14, 14.5, 4),
      new THREE.MeshPhysicalMaterial({
        color: '#bae6fd',
        metalness: 0.35,
        roughness: 0.08,
        clearcoat: 1.0,
        transparent: true,
        opacity: 0.74,
      })
    );
    louvreGlass.position.set(32, 7.25, 18);
    louvreGlass.rotation.y = Math.PI / 4;
    g.add(louvreGlass);
  } else if (cityId === 'london') {
    // 1. Big Ben Elizabeth Tower + Palace of Westminster Gothic Hall
    const clockShaft = new THREE.Mesh(new THREE.BoxGeometry(9.4, 56, 9.4), stoneMat);
    clockShaft.position.set(-16, 28, 0);
    const clockHousing = new THREE.Mesh(new THREE.BoxGeometry(10.8, 9.8, 10.8), stoneMat);
    clockHousing.position.set(-16, 49, 0);

    const dialMat = new THREE.MeshStandardMaterial({
      color: '#fef9c3',
      emissive: '#fde047',
      emissiveIntensity: 0.85,
    });
    for (let d = 0; d < 4; d++) {
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.4, 20), dialMat);
      const angle = (d * Math.PI) / 2;
      dial.rotation.x = Math.PI / 2;
      dial.rotation.z = angle;
      dial.position.set(-16 + Math.sin(angle) * 5.35, 49, Math.cos(angle) * 5.35);
      g.add(dial);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.6, 16.5, 4), steelMat);
    roof.position.set(-16, 62, 0);
    roof.rotation.y = Math.PI / 4;
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.9, 8.5, 8), goldMat);
    lantern.position.set(-16, 73, 0);

    // Palace of Westminster wing & golden pinnacles
    const palaceBody = new THREE.Mesh(new THREE.BoxGeometry(32, 16, 12), stoneMat);
    palaceBody.position.set(-34, 8, 8);
    g.add(clockShaft, clockHousing, roof, lantern, palaceBody);

    // 2. London Eye Giant Ferris Wheel with 12 Spokes & Glass Passenger Capsules
    const wheelX = 20;
    const wheelY = 29;
    const wheelZ = -6;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(23, 1.05, 12, 36), steelMat);
    wheel.position.set(wheelX, wheelY, wheelZ);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 4.5, 16), glowMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(wheelX, wheelY, wheelZ);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 23, 6), steelMat);
      spoke.position.set(wheelX + Math.cos(a) * 11.5, wheelY + Math.sin(a) * 11.5, wheelZ);
      spoke.rotation.z = a - Math.PI / 2;
      g.add(spoke);

      const pod = new THREE.Mesh(new THREE.SphereGeometry(1.55, 12, 10), glowMat);
      pod.scale.set(1.32, 0.85, 0.85);
      pod.position.set(wheelX + Math.cos(a) * 23.8, wheelY + Math.sin(a) * 23.8, wheelZ);
      g.add(pod);
    }
    const support = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 2.3, 32, 10), steelMat);
    support.position.set(wheelX, 14.5, -12);
    support.rotation.x = 0.25;
    g.add(wheel, hub, support);

    // 3. Iconic Twin-Tower Tower Bridge with Overhead Walkways & Blue Suspension Chains
    const tbGroup = new THREE.Group();
    tbGroup.position.set(8, 0, 32);
    const blueBridgeMat = new THREE.MeshStandardMaterial({ color: '#0284c7', roughness: 0.3, metalness: 0.7 });
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(6.8, 30, 6.8), stoneMat);
      tower.position.set(sx * 16, 15, 0);
      const spireRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 8.5, 4), blueBridgeMat);
      spireRoof.position.set(sx * 16, 34, 0);
      spireRoof.rotation.y = Math.PI / 4;
      tbGroup.add(tower, spireRoof);
    }
    const highWalkway = new THREE.Mesh(new THREE.BoxGeometry(34, 2.2, 3.2), steelMat);
    highWalkway.position.set(0, 26, 0);
    const lowerDeck = new THREE.Mesh(new THREE.BoxGeometry(46, 1.8, 5.2), blueBridgeMat);
    lowerDeck.position.set(0, 7, 0);
    tbGroup.add(highWalkway, lowerDeck);
    g.add(tbGroup);
  } else if (cityId === 'newyork') {
    // 1. Empire State Building stepped art-deco skyscraper + Illuminated Spire
    const artDeco = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.36, metalness: 0.52 });
    const tier1 = new THREE.Mesh(new THREE.BoxGeometry(19, 30, 17), artDeco);
    tier1.position.set(-8, 15, 0);
    const tier2 = new THREE.Mesh(new THREE.BoxGeometry(13.5, 32, 12.5), artDeco);
    tier2.position.set(-8, 45, 0);
    const tier3 = new THREE.Mesh(new THREE.BoxGeometry(8.4, 17, 8.4), artDeco);
    tier3.position.set(-8, 69, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 3.4, 11, 12), steelMat);
    mast.position.set(-8, 82, 0);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 1.9, 22, 10), glowMat);
    spire.position.set(-8, 97, 0);
    g.add(tier1, tier2, tier3, mast, spire);

    // 2. Statue of Liberty on Star Fort Pedestal with 7-Ray Crown & Golden Torch
    const patina = new THREE.MeshStandardMaterial({ color: '#34d399', roughness: 0.46, metalness: 0.38 });
    const starBase = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 5, 8), stoneMat);
    starBase.position.set(24, 2.5, 14);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(9.5, 14, 9.5), stoneMat);
    pedestal.position.set(24, 11, 14);
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.8, 19, 14), patina);
    robe.position.set(24, 27, 14);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.0, 12, 12), patina);
    head.position.set(24, 37.8, 14);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.72, 8, 8), patina);
    arm.position.set(26.4, 39.5, 14);
    arm.rotation.z = -0.25;
    const torch = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 12), goldMat);
    torch.position.set(27.5, 44, 14);
    g.add(starBase, pedestal, robe, head, arm, torch);

    // 3. Chrysler Building Art-Deco Sunburst Crown Tower + Brooklyn Bridge Stone Pylon
    const chryslerShaft = new THREE.Mesh(new THREE.BoxGeometry(12, 54, 12), artDeco);
    chryslerShaft.position.set(-34, 27, 22);
    for (let c = 0; c < 4; c++) {
      const crownArch = new THREE.Mesh(new THREE.CylinderGeometry(5.5 - c * 1.1, 6.8 - c * 1.1, 4.5, 12), steelMat);
      crownArch.position.set(-34, 56 + c * 4.2, 22);
      g.add(crownArch);
    }
    const chryslerNeedle = new THREE.Mesh(new THREE.ConeGeometry(0.8, 15, 8), steelMat);
    chryslerNeedle.position.set(-34, 78, 22);
    g.add(chryslerShaft, chryslerNeedle);
  } else if (cityId === 'hanoi') {
    // 1. Tháp Rùa (Turtle Tower) with arched Gothic portals on emerald Hoan Kiem islet
    const islet = new THREE.Mesh(
      new THREE.CylinderGeometry(16.5, 20.5, 2.5, 24),
      new THREE.MeshStandardMaterial({ color: '#4d7c0f', roughness: 0.86 })
    );
    islet.position.y = 0.8;

    const wallMat = new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.72 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#991b1b', roughness: 0.58 });
    const archDarkMat = new THREE.MeshStandardMaterial({ color: '#1e1b18', roughness: 0.9 });

    const t1 = new THREE.Mesh(new THREE.BoxGeometry(12.6, 8.8, 9.4), wallMat);
    t1.position.y = 6.2;
    for (const dx of [-3.5, 0, 3.5]) {
      const portal = new THREE.Mesh(new THREE.BoxGeometry(1.9, 4.8, 9.8), archDarkMat);
      portal.position.set(dx, 4.6, 0);
      g.add(portal);
    }
    const r1 = new THREE.Mesh(new THREE.ConeGeometry(10.0, 3.5, 4), roofMat);
    r1.position.y = 12.1;
    r1.rotation.y = Math.PI / 4;

    const t2 = new THREE.Mesh(new THREE.BoxGeometry(9.4, 7.2, 7.2), wallMat);
    t2.position.y = 16.3;
    const r2 = new THREE.Mesh(new THREE.ConeGeometry(8.0, 3.0, 4), roofMat);
    r2.position.y = 21.3;
    r2.rotation.y = Math.PI / 4;

    const t3 = new THREE.Mesh(new THREE.BoxGeometry(6.4, 5.6, 5.2), wallMat);
    t3.position.y = 25.0;
    const r3 = new THREE.Mesh(new THREE.ConeGeometry(6.0, 3.4, 4), roofMat);
    r3.position.y = 29.3;
    r3.rotation.y = Math.PI / 4;
    const pinnacle = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 10), goldMat);
    pinnacle.position.y = 31.6;
    g.add(islet, t1, r1, t2, r2, t3, r3, pinnacle);

    // 2. Cầu Thê Húc Vermilion Bridge + Đền Ngọc Sơn Pavilion + Tháp Bút Stone Obelisk
    const bridgeMat = new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.38 });
    const bridgeArch = new THREE.Mesh(new THREE.TorusGeometry(17.5, 1.45, 10, 24, Math.PI), bridgeMat);
    bridgeArch.position.set(24, 0.5, 12);
    bridgeArch.scale.set(1, 0.44, 1);
    for (let p = -14; p <= 14; p += 7) {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.52, 6.8, 8), bridgeMat);
      piling.position.set(24 + p, 2.3, 12);
      g.add(piling);
    }

    // Đền Ngọc Sơn Curved-Roof Pavilion & Tháp Bút (Pen Tower)
    const templeBase = new THREE.Mesh(new THREE.BoxGeometry(11, 6.5, 11), wallMat);
    templeBase.position.set(42, 3.5, 12);
    const templeRoof1 = new THREE.Mesh(new THREE.ConeGeometry(10.2, 4.2, 4), roofMat);
    templeRoof1.position.set(42, 8.6, 12);
    templeRoof1.rotation.y = Math.PI / 4;
    const templeRoof2 = new THREE.Mesh(new THREE.ConeGeometry(7.2, 3.6, 4), roofMat);
    templeRoof2.position.set(42, 12.2, 12);
    templeRoof2.rotation.y = Math.PI / 4;

    const thapBut = new THREE.Mesh(new THREE.BoxGeometry(3.4, 19, 3.4), stoneMat);
    thapBut.position.set(-28, 9.5, 18);
    const brushTip = new THREE.Mesh(new THREE.ConeGeometry(2.1, 5.2, 8), goldMat);
    brushTip.position.set(-28, 21.5, 18);
    g.add(bridgeArch, templeBase, templeRoof1, templeRoof2, thapBut, brushTip);
  } else if (cityId === 'dubai') {
    // 1. Burj Khalifa Soaring Stepped Silver Spire
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#e0f2fe',
      metalness: 0.9,
      roughness: 0.1,
      clearcoat: 1.0,
    });
    const tiers = [
      { r: 10.6, h: 25, y: 12.5 },
      { r: 7.9, h: 27, y: 38 },
      { r: 5.5, h: 27, y: 64 },
      { r: 3.3, h: 25, y: 89 },
      { r: 1.3, h: 28, y: 114 },
    ];
    for (const t of tiers) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.72, t.r, t.h, 12), glassMat);
      m.position.set(-10, t.y, 0);
      g.add(m);
    }

    // 2. Burj Al Arab Sail Hotel with Spine Mast & Cantilevered Helipad
    const sail = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 12.8, 46, 18, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.24, metalness: 0.35 })
    );
    sail.position.set(22, 23, 10);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 54, 10), steelMat);
    mast.position.set(22, 27, 10);
    const helipad = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.85, 18), steelMat);
    helipad.position.set(22, 37.5, 15.8);
    g.add(sail, mast, helipad);

    // 3. Golden Dubai Frame & Museum of the Future Silver Torus
    const frameGroup = new THREE.Group();
    frameGroup.position.set(-34, 0, 24);
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(3.6, 38, 3.6), goldMat);
      col.position.set(sx * 10, 19, 0);
      frameGroup.add(col);
    }
    const topBridge = new THREE.Mesh(new THREE.BoxGeometry(23.6, 4.2, 3.8), goldMat);
    topBridge.position.set(0, 38, 0);
    frameGroup.add(topBridge);

    const museumTorus = new THREE.Mesh(new THREE.TorusGeometry(11.5, 3.8, 16, 36), steelMat);
    museumTorus.scale.set(1.35, 0.85, 0.75);
    museumTorus.position.set(4, 11, -30);
    g.add(frameGroup, museumTorus);
  } else if (cityId === 'sydney') {
    // 1. Sydney Opera House Multi-Shell Sculptural Roofs on Waterfront Podium
    const shellMat = new THREE.MeshPhysicalMaterial({
      color: '#f8fafc',
      roughness: 0.18,
      metalness: 0.18,
      clearcoat: 0.85,
    });
    const podium = new THREE.Mesh(new THREE.BoxGeometry(38, 4.4, 25), stoneMat);
    podium.position.set(-8, 2.2, 2);
    g.add(podium);

    for (let i = 0; i < 5; i++) {
      const shell = new THREE.Mesh(new THREE.ConeGeometry(7.4 - i * 0.55, 18.5 - i * 1.3, 18), shellMat);
      shell.scale.set(0.86, 1, 1.42);
      shell.position.set(-18 + i * 6.2, 11.6 - i * 0.45, i % 2 === 0 ? -1.5 : 3.0);
      shell.rotation.z = -0.24;
      g.add(shell);
    }

    // 2. Sydney Harbour Bridge Steel Through-Arch + Suspended Deck + Twin Granite Pylons
    const bridgeArch = new THREE.Mesh(new THREE.TorusGeometry(28, 1.65, 12, 36, Math.PI), steelMat);
    bridgeArch.position.set(18, 2, -18);
    bridgeArch.scale.set(1, 0.76, 1);
    const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(58, 1.5, 4.6), steelMat);
    bridgeDeck.position.set(18, 8.0, -18);
    for (const sx of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(4.8, 24, 5.8), stoneMat);
      pylon.position.set(18 + sx * 27, 12, -18);
      g.add(pylon);
    }
    g.add(bridgeArch, bridgeDeck);

    // 3. Sydney Tower Eye Golden Observation Turret & Spire
    const towerShaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 58, 12), steelMat);
    towerShaft.position.set(-34, 29, -22);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 4.2, 7.5, 16), goldMat);
    turret.position.set(-34, 60, -22);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.1, 18, 8), steelMat);
    spire.position.set(-34, 72, -22);
    g.add(towerShaft, turret, spire);
  } else if (cityId === 'cairo') {
    // 1. Trio of Giza Pyramids (Khufu, Khafre, Menkaure) with Golden Electrum Capstone
    const sandMat = new THREE.MeshStandardMaterial({ color: '#d9a45b', roughness: 0.84, metalness: 0.06 });
    const p1 = new THREE.Mesh(new THREE.ConeGeometry(30, 39, 4), sandMat);
    p1.position.set(-12, 19.5, -10);
    p1.rotation.y = Math.PI / 4;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(6.2, 7.8, 4), goldMat);
    cap.position.set(-12, 35.8, -10);
    cap.rotation.y = Math.PI / 4;

    const p2 = new THREE.Mesh(new THREE.ConeGeometry(22, 29, 4), sandMat);
    p2.position.set(22, 14.5, 6);
    p2.rotation.y = Math.PI / 4;

    const p3 = new THREE.Mesh(new THREE.ConeGeometry(14, 18, 4), sandMat);
    p3.position.set(-34, 9, 18);
    p3.rotation.y = Math.PI / 4;
    g.add(p1, cap, p2, p3);

    // 2. Sculpted Great Sphinx of Giza with Nemes Headdress & Forepaws
    const sphinxBody = new THREE.Mesh(new THREE.BoxGeometry(7.8, 5.8, 15), sandMat);
    sphinxBody.position.set(-2, 2.9, 18);
    const sphinxHead = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.6, 5.5, 8), sandMat);
    sphinxHead.position.set(-2, 8.2, 23);
    for (const side of [-1, 1]) {
      const paw = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.3, 7.0), sandMat);
      paw.position.set(-2 + side * 2.6, 1.15, 27.5);
      g.add(paw);
    }
    g.add(sphinxBody, sphinxHead);

    // 3. Ancient Luxor/Karnak Hypostyle Temple Pylon Gate & Twin Obelisks
    for (const sx of [-1, 1]) {
      const pylonTower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.8, 20, 4), stoneMat);
      pylonTower.position.set(24 + sx * 8, 10, -24);
      pylonTower.rotation.y = Math.PI / 4;
      const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.9, 25, 4), goldMat);
      obelisk.position.set(24 + sx * 8, 12.5, -16);
      g.add(pylonTower, obelisk);
    }
  } else if (cityId === 'rio') {
    // 1. Corcovado Mountain Peak + Art-Deco Pedestal + Christ the Redeemer Statue
    const peakMat = new THREE.MeshStandardMaterial({ color: '#2f6f46', roughness: 0.88 });
    const rockMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.82 });
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(28, 48, 16), peakMat);
    mountain.position.y = 24;

    const statueMat = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.4, metalness: 0.14 });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 6, 10), rockMat);
    pedestal.position.y = 47.5;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.8, 17, 12), statueMat);
    body.position.y = 57.5;
    const arms = new THREE.Mesh(new THREE.BoxGeometry(17.5, 2.3, 2.3), statueMat);
    arms.position.y = 61.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.0, 12, 12), statueMat);
    head.position.y = 67;
    head.rotation.x = 0.22;
    g.add(mountain, pedestal, body, arms, head);

    // 2. Sugarloaf Mountain Granite Dome + Aerial Cableway Line & Gondola Cabin
    const sugarloaf = new THREE.Mesh(new THREE.CylinderGeometry(8, 22, 36, 16), rockMat);
    sugarloaf.position.set(34, 18, -14);
    const sugarCap = new THREE.Mesh(new THREE.SphereGeometry(8.2, 14, 12), peakMat);
    sugarCap.position.set(34, 35, -14);
    const cableCar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 2.4), glowMat);
    cableCar.position.set(17, 42, -7);
    g.add(sugarloaf, sugarCap, cableCar);

    // 3. Niemeyer Sambadrome Archway (Praça da Apoteose)
    const sambaArch = new THREE.Mesh(new THREE.TorusGeometry(14, 1.5, 10, 24, Math.PI), statueMat);
    sambaArch.position.set(-28, 1, 20);
    g.add(sambaArch);
  } else {
    // 1. Rome: Multi-Tiered Colosseum Amphitheatre with Travertine Cornices & Columns
    const travertine = new THREE.MeshStandardMaterial({ color: '#d8c3a5', roughness: 0.78 });
    const outerRing1 = new THREE.Mesh(new THREE.CylinderGeometry(25, 26, 11.5, 32, 1, true), travertine);
    outerRing1.position.y = 5.75;
    outerRing1.material.side = THREE.DoubleSide;
    const outerRing2 = new THREE.Mesh(new THREE.CylinderGeometry(24.5, 25, 11.5, 32, 1, true), travertine);
    outerRing2.position.y = 17.25;
    outerRing2.material.side = THREE.DoubleSide;
    const topWall = new THREE.Mesh(
      new THREE.CylinderGeometry(24, 24.5, 9.5, 32, 1, true, 0, Math.PI * 1.25),
      travertine
    );
    topWall.position.y = 27.5;
    topWall.material.side = THREE.DoubleSide;

    for (const ry of [11.5, 23]) {
      const cornice = new THREE.Mesh(new THREE.TorusGeometry(25.2, 0.78, 10, 36), stoneMat);
      cornice.rotation.x = Math.PI / 2;
      cornice.position.y = ry;
      g.add(cornice);
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.08, 23, 10), stoneMat);
      col.position.set(Math.cos(a) * 25.4, 11.5, Math.sin(a) * 25.4);
      g.add(col);
    }
    g.add(outerRing1, outerRing2, topWall);

    // 2. Roman Pantheon Rotunda Dome & Corinthian Portico Pediment
    const pantheonRotunda = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 13.5, 13, 24), stoneMat);
    pantheonRotunda.position.set(36, 6.5, 18);
    const pantheonDome = new THREE.Mesh(
      new THREE.SphereGeometry(13.4, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
      travertine
    );
    pantheonDome.position.set(36, 13, 18);
    const portico = new THREE.Mesh(new THREE.BoxGeometry(15, 10, 7.5), stoneMat);
    portico.position.set(36, 5, 31);
    g.add(pantheonRotunda, pantheonDome, portico);

    // 3. Roman Aqueduct Multi-Arch Viaduct & Trajan's Marble Column
    for (let a = 0; a < 4; a++) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3.2, 18, 3.6), travertine);
      pier.position.set(-36 + a * 8.5, 9, -22);
      g.add(pier);
    }
    const aqueductChannel = new THREE.Mesh(new THREE.BoxGeometry(30, 3.4, 4.0), stoneMat);
    aqueductChannel.position.set(-23.25, 19.5, -22);
    g.add(aqueductChannel);
  }

  return g;
}

/**
 * Builds rich, culturally authentic street-level props, vehicles, stalls, and architectural accents
 * along the circuit for each of the 10 world cities.
 */
function buildCityCharacteristicProps(group: THREE.Group, track: TrackData): void {
  const { city } = track;
  const halfW = city.roadWidth * 0.5;
  const propsGroup = new THREE.Group();
  group.add(propsGroup);

  const placeTrackside = (t: number, side: 1 | -1, extraDist: number, yOffset = 0, yawOffset = 0): THREE.Group => {
    const s = sampleTrackAt(track, ((t % 1) + 1) % 1);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const dist = halfW + extraDist;
    const node = new THREE.Group();
    node.position.set(
      s.point.x + s.right.x * dist * side,
      s.point.y + yOffset,
      s.point.z + s.right.z * dist * side
    );
    node.rotation.y = yaw + yawOffset;
    propsGroup.add(node);
    return node;
  };

  const darkMetal = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.35, metalness: 0.72 });
  const warmGlow = new THREE.MeshStandardMaterial({
    color: '#fef08a',
    emissive: '#f59e0b',
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#38bdf8',
    roughness: 0.12,
    metalness: 0.85,
    clearcoat: 0.9,
  });

  if (city.id === 'tokyo') {
    // 1. Glowing Red/Pink Izakaya Paper Lantern Arcades & Cyber-Neon Vertical Kanji Signboards + Vending Machines
    const lanternMat = new THREE.MeshStandardMaterial({
      color: '#ef4444',
      emissive: '#f43f5e',
      emissiveIntensity: 1.35,
      roughness: 0.3,
    });
    const neonCyanMat = new THREE.MeshStandardMaterial({
      color: '#22d3ee',
      emissive: '#06b6d4',
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
    const neonPinkMat = new THREE.MeshStandardMaterial({
      color: '#f472b6',
      emissive: '#ec4899',
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });

    // Monumental Vermilion Torii Gates spanning right over the Tokyo roadway!
    for (const gt of [0.14, 0.43, 0.71]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const torii = new THREE.Group();
      torii.position.set(s.point.x, s.point.y, s.point.z);
      torii.rotation.y = yaw;
      const span = city.roadWidth + 3.2;
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 10.5, 14), lanternMat);
        pillar.position.set(side * (halfW + 1.4), 5.25, 0);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.96, 1.2, 14), darkMetal);
        foot.position.set(side * (halfW + 1.4), 0.6, 0);
        torii.add(pillar, foot);
      }
      const kasagi = new THREE.Mesh(new THREE.BoxGeometry(span + 5.2, 0.95, 1.35), lanternMat);
      kasagi.position.set(0, 10.5, 0);
      const roofCap = new THREE.Mesh(new THREE.BoxGeometry(span + 6.4, 0.48, 1.65), darkMetal);
      roofCap.position.set(0, 11.15, 0);
      const nuki = new THREE.Mesh(new THREE.BoxGeometry(span + 2.4, 0.65, 0.85), lanternMat);
      nuki.position.set(0, 8.4, 0);
      const tablet = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.1, 0.45), warmGlow);
      tablet.position.set(0, 9.45, 0);
      torii.add(kasagi, roofCap, nuki, tablet);
      propsGroup.add(torii);
    }

    const spots = [0.015, 0.045, 0.11, 0.19, 0.29, 0.38, 0.49, 0.61, 0.72, 0.84, 0.94, 0.975];
    spots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 4.9, 0);

      // Traditional timber & neon Izakaya gate post with 3 hanging Chochin paper lanterns
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 5.4, 0.32), darkMetal);
      post.position.set(0, 2.7, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.24, 0.24), darkMetal);
      arm.position.set(-side * 1.0, 5.1, 0);
      node.add(post, arm);

      for (let l = 0; l < 3; l++) {
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.68, 12), lanternMat);
        lantern.position.set(-side * (0.45 + l * 0.65), 4.55, 0);
        node.add(lantern);
      }

      // Vertical Cyber-Neon Signboard + Japanese Smart Vending Machine
      const signMat = idx % 2 === 0 ? neonPinkMat : neonCyanMat;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.95, 4.2, 0.22), signMat);
      sign.position.set(side * 0.8, 3.8, 1.4);
      const vending = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.1, 0.85), neonCyanMat);
      vending.position.set(0, 1.05, -1.6);
      node.add(sign, vending);
    });
  } else if (city.id === 'paris') {
    // 2. Haussmann Parisian Sidewalk Bistro Café Terraces (Striped Awning Parasols, Bistro Tables) & Morris Columns
    const awningRed = new THREE.MeshStandardMaterial({ color: '#be123c', roughness: 0.6 });
    const creamMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.5 });
    const morrisGreen = new THREE.MeshStandardMaterial({ color: '#065f46', roughness: 0.45, metalness: 0.3 });

    // Golden Beaux-Arts Parisian Bridge Portal Colonnades with Pegasus/Winged Victory Finials
    for (const gt of [0.16, 0.46, 0.74]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const portal = new THREE.Group();
      portal.position.set(s.point.x, s.point.y, s.point.z);
      portal.rotation.y = yaw;
      for (const side of [-1, 1]) {
        const obelisk = new THREE.Mesh(new THREE.BoxGeometry(1.9, 11.5, 1.9), creamMat);
        obelisk.position.set(side * (halfW + 1.8), 5.75, 0);
        const statue = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 12), warmGlow);
        statue.position.set(side * (halfW + 1.8), 12.4, 0);
        portal.add(obelisk, statue);
      }
      propsGroup.add(portal);
    }

    const spots = [0.015, 0.045, 0.12, 0.21, 0.33, 0.44, 0.56, 0.68, 0.81, 0.93, 0.975];
    spots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 4.8, 0);

      // Café Terrace Umbrella + Bistro Table & Chairs
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.1, 8), darkMetal);
      pole.position.y = 1.55;
      const umbrella = new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.85, 14), idx % 2 === 0 ? awningRed : creamMat);
      umbrella.position.y = 3.1;
      const table = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 14), creamMat);
      table.position.y = 0.82;
      node.add(pole, umbrella, table);

      // Iconic Parisian Green Morris Advertising Column with Hexagonal Canopy
      if (idx % 2 === 0) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 3.6, 14), morrisGreen);
        col.position.set(0, 1.8, 3.2);
        const poster = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 14), warmGlow);
        poster.position.set(0, 1.8, 3.2);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.9, 6), morrisGreen);
        roof.position.set(0, 4.0, 3.2);
        node.add(col, poster, roof);
      }
    });
  } else if (city.id === 'london') {
    // 3. Iconic Red Double-Decker Routemaster Buses, Classic Red K2 Telephone Booths & Gothic Tower Bridge Gateways
    const londonRed = new THREE.MeshPhysicalMaterial({
      color: '#dc2626',
      roughness: 0.24,
      metalness: 0.35,
      clearcoat: 0.85,
    });
    const stoneVictorian = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.7 });
    const tireMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.85 });

    // Victorian Gothic Stone Bridge Gateway Portals across the track
    for (const gt of [0.15, 0.48, 0.72]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const gate = new THREE.Group();
      gate.position.set(s.point.x, s.point.y, s.point.z);
      gate.rotation.y = yaw;
      for (const side of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 12.5, 2.6), stoneVictorian);
        tower.position.set(side * (halfW + 1.8), 6.25, 0);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(1.9, 3.8, 4), darkMetal);
        spire.rotation.y = Math.PI / 4;
        spire.position.set(side * (halfW + 1.8), 14.4, 0);
        gate.add(tower, spire);
      }
      const walkway = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 4.8, 1.3, 1.6), darkMetal);
      walkway.position.set(0, 10.6, 0);
      gate.add(walkway);
      propsGroup.add(gate);
    }

    const busSpots = [0.02, 0.11, 0.22, 0.35, 0.52, 0.66, 0.81, 0.965];
    busSpots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 5.4, 0);

      // Double-Decker Red London Bus
      const busBody = new THREE.Mesh(new THREE.BoxGeometry(2.55, 4.15, 8.6), londonRed);
      busBody.position.y = 2.4;
      const lowerWin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 7.6), glassMat);
      lowerWin.position.y = 1.85;
      const upperWin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 7.8), glassMat);
      upperWin.position.y = 3.55;
      const destBoard = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 8.68), warmGlow);
      destBoard.position.y = 2.75;
      node.add(busBody, lowerWin, upperWin, destBoard);

      for (const wz of [-2.8, 2.8]) {
        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 2.7, 14), tireMat);
        axle.rotation.z = Math.PI / 2;
        axle.position.set(0, 0.52, wz);
        node.add(axle);
      }

      // Red British Telephone Box (K2) beside the bus stop
      const booth = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.55, 1.05), londonRed);
      booth.position.set(0, 1.28, 6.2);
      const boothGlass = new THREE.Mesh(new THREE.BoxGeometry(1.09, 1.65, 0.82), glassMat);
      boothGlass.position.set(0, 1.38, 6.2);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.68, 12, 10), londonRed);
      dome.scale.set(1, 0.45, 1);
      dome.position.set(0, 2.58, 6.2);
      node.add(booth, boothGlass, dome);
    });
  } else if (city.id === 'newyork') {
    // 4. Iconic Yellow NYC Taxi Cabs, Elevated Steel Subway Truss Overpasses & Times Square Neon Billboards
    const taxiYellow = new THREE.MeshPhysicalMaterial({
      color: '#facc15',
      roughness: 0.22,
      metalness: 0.4,
      clearcoat: 0.85,
    });
    const billboardMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      emissive: '#0284c7',
      emissiveIntensity: 1.25,
      roughness: 0.2,
    });

    // Elevated Manhattan Subway Steel Gantry Overpasses with Glowing Broadway Tickers
    for (const gt of [0.14, 0.44, 0.72]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const overpass = new THREE.Group();
      overpass.position.set(s.point.x, s.point.y, s.point.z);
      overpass.rotation.y = yaw;
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, 10.2, 1.1), darkMetal);
        col.position.set(side * (halfW + 1.5), 5.1, 0);
        overpass.add(col);
      }
      const girder = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 4.4, 1.65, 2.4), darkMetal);
      girder.position.set(0, 9.8, 0);
      const ticker = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth * 0.75, 1.2, 2.55), billboardMat);
      ticker.position.set(0, 9.8, 0);
      overpass.add(girder, ticker);
      propsGroup.add(overpass);
    }

    const taxiSpots = [0.02, 0.055, 0.15, 0.28, 0.42, 0.57, 0.71, 0.86, 0.965];
    taxiSpots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 4.9, 0);

      // NYC Yellow Cab
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.92, 4.65), taxiYellow);
      chassis.position.y = 0.72;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.78, 2.4), glassMat);
      cabin.position.set(0, 1.45, -0.15);
      const roofTop = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, 2.2), taxiYellow);
      roofTop.position.set(0, 1.86, -0.15);
      const taxiLight = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.26, 0.35), warmGlow);
      taxiLight.position.set(0, 2.02, -0.15);
      node.add(chassis, cabin, roofTop, taxiLight);

      // Times Square Broadway LED Mega-Billboard Tower behind the sidewalk
      if (idx % 2 === 0) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 11, 8), darkMetal);
        pillar.position.set(side * 2.2, 5.5, 0);
        const screen = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6.2, 4.5), billboardMat);
        screen.position.set(side * 2.2, 8.8, 0);
        node.add(pillar, screen);
      }
    });
  } else if (city.id === 'hanoi') {
    // 5. Hà Nội Phố Cổ (Old Quarter Yellow Tube Houses, Khuê Văn Các Cultural Gates, Cyclo Xích Lô, Silk Lanterns & Gánh Hàng Rong)
    const wallYellow = new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.75 });
    const tileRed = new THREE.MeshStandardMaterial({ color: '#b91c1c', roughness: 0.65 });
    const shutterGreen = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.55 });
    const bambooMat = new THREE.MeshStandardMaterial({ color: '#ca8a04', roughness: 0.8 });
    const lanternSilk = new THREE.MeshStandardMaterial({
      color: '#fb7185',
      emissive: '#f43f5e',
      emissiveIntensity: 1.3,
      roughness: 0.25,
    });

    // Overhead Silk Lantern Festival Garlands & Traditional Tam Quan / Khuê Văn Các Archways across the road
    for (const gt of [0.13, 0.38, 0.64, 0.88]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const arch = new THREE.Group();
      arch.position.set(s.point.x, s.point.y, s.point.z);
      arch.rotation.y = yaw;
      const span = city.roadWidth + 3.0;
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9.6, 1.4), wallYellow);
        col.position.set(side * (halfW + 1.4), 4.8, 0);
        const colRoof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.4, 4), tileRed);
        colRoof.rotation.y = Math.PI / 4;
        colRoof.position.set(side * (halfW + 1.4), 10.3, 0);
        arch.add(col, colRoof);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 2.4, 0.45, 0.45), tileRed);
      beam.position.set(0, 9.1, 0);
      arch.add(beam);
      // Hanging glowing silk festival lanterns across the street span
      for (let lx = -4; lx <= 4; lx++) {
        const lan = new THREE.Mesh(
          new THREE.SphereGeometry(0.42, 12, 12),
          lx % 2 === 0 ? lanternSilk : warmGlow
        );
        lan.scale.set(1, 1.3, 1);
        lan.position.set(lx * 2.2, 8.35 - Math.cos((lx / 4) * 1.1) * 0.45, 0);
        arch.add(lan);
      }
      propsGroup.add(arch);
    }

    const hanoiSpots = [0.015, 0.045, 0.09, 0.17, 0.26, 0.36, 0.47, 0.58, 0.69, 0.81, 0.91, 0.97];
    hanoiSpots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 6.2, 0);

      // Traditional Hanoi Old Quarter Tube Shophouse (Nhà Ống Phố Cổ)
      const h = 7.5 + (idx % 3) * 2.2;
      const house = new THREE.Mesh(new THREE.BoxGeometry(4.4, h, 5.2), wallYellow);
      house.position.set(side * 1.2, h * 0.5, 0);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 2.2, 4), tileRed);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(side * 1.2, h + 1.1, 0);
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.1, 4.2), shutterGreen);
      balcony.position.set(-side * 1.1, 3.8, 0);
      node.add(house, roof, balcony);

      // Hanging Silk Lanterns & Street Food Stall (Quầy Phở / Gánh Hàng Rong)
      for (const lz of [-1.6, 0, 1.6]) {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 10), idx % 2 === 0 ? lanternSilk : warmGlow);
        lantern.scale.set(1, 1.25, 1);
        lantern.position.set(-side * 1.5, 3.3, lz);
        node.add(lantern);
      }

      // Bamboo Street Vendor Stall (Gánh Hàng Rong) + Traditional Hanoi Cyclo (Xích Lô)
      const basket1 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.38, 0.45, 10), bambooMat);
      basket1.position.set(-side * 1.6, 0.3, -2.4);
      const basket2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.38, 0.45, 10), bambooMat);
      basket2.position.set(-side * 1.6, 0.3, -0.8);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.1), bambooMat);
      pole.position.set(-side * 1.6, 0.72, -1.6);
      const cycloSeat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 1.25), tileRed);
      cycloSeat.position.set(-side * 1.5, 0.65, 2.2);
      const cycloHood = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 1.1, 10, 1, false, 0, Math.PI), bambooMat);
      cycloHood.rotation.z = Math.PI / 2;
      cycloHood.position.set(-side * 1.5, 1.25, 2.0);
      node.add(basket1, basket2, pole, cycloSeat, cycloHood);
    });
  } else if (city.id === 'dubai') {
    // 6. Dubai Marina Luxury White Superyachts, Futuristic Golden Metro Archways & Arabian Wind-Tower (Barjeel) Pavilions
    const yachtWhite = new THREE.MeshPhysicalMaterial({
      color: '#f8fafc',
      roughness: 0.15,
      metalness: 0.25,
      clearcoat: 0.9,
    });
    const goldAccent = new THREE.MeshPhysicalMaterial({
      color: '#f59e0b',
      roughness: 0.2,
      metalness: 0.85,
      clearcoat: 0.8,
    });

    // Futuristic Golden Arabian Highway Arch Ribbons over the 6-lane track
    for (const gt of [0.15, 0.45, 0.73]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const arch = new THREE.Group();
      arch.position.set(s.point.x, s.point.y, s.point.z);
      arch.rotation.y = yaw;
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(halfW + 1.8, 0.55, 12, 32, Math.PI),
        goldAccent
      );
      torus.scale.set(1, 0.82, 1);
      arch.add(torus);
      propsGroup.add(arch);
    }

    // Floating Superyachts on the Marina Lagoon
    const centerX = (track.minX + track.maxX) * 0.5;
    const centerZ = (track.minZ + track.maxZ) * 0.5;
    for (let yIdx = 0; yIdx < 6; yIdx++) {
      const angle = (yIdx / 6) * Math.PI * 2 + 0.4;
      const yx = centerX + Math.cos(angle) * 48;
      const yz = centerZ + Math.sin(angle) * 46;
      if (isNearTrack(track, yx, yz, halfW + 10)) continue;
      const yacht = new THREE.Group();
      yacht.position.set(yx, -0.05, yz);
      yacht.rotation.y = angle + Math.PI * 0.5;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.8, 14.5), yachtWhite);
      hull.position.y = 0.9;
      const bow = new THREE.Mesh(new THREE.ConeGeometry(2.9, 5.2, 4), yachtWhite);
      bow.rotation.x = Math.PI / 2;
      bow.rotation.z = Math.PI / 4;
      bow.position.set(0, 0.9, 9.6);
      const deck1 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.5, 8.5), glassMat);
      deck1.position.set(0, 2.4, -0.5);
      const deck2 = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.2, 5.2), yachtWhite);
      deck2.position.set(0, 3.6, -1.2);
      const radar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 2.2, 8), goldAccent);
      radar.position.set(0, 4.9, -1.8);
      yacht.add(hull, bow, deck1, deck2, radar);
      propsGroup.add(yacht);
    }

    // Trackside Golden Arabian Arches & Barjeel Wind Towers
    for (const t of [0.02, 0.18, 0.36, 0.54, 0.72, 0.88, 0.96]) {
      const node = placeTrackside(t, 1, 5.5, 0);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.8, 9.5, 2.8), goldAccent);
      tower.position.y = 4.75;
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 12), warmGlow);
      lantern.position.y = 10.2;
      node.add(tower, lantern);
    }
  } else if (city.id === 'sydney') {
    // 7. Sydney Harbour White Racing Sailboats, Harbour Sail Canopies & Coastal Timber Cabana Pavilions
    const sailWhite = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3, side: THREE.DoubleSide });
    const hullBlue = new THREE.MeshStandardMaterial({ color: '#0284c7', roughness: 0.35, metalness: 0.3 });

    const centerX = (track.minX + track.maxX) * 0.5;
    const centerZ = (track.minZ + track.maxZ) * 0.5;
    for (let sIdx = 0; sIdx < 8; sIdx++) {
      const angle = (sIdx / 8) * Math.PI * 2 + 0.25;
      const sx = centerX + Math.cos(angle) * (40 + (sIdx % 2) * 28);
      const sz = centerZ + Math.sin(angle) * (38 + (sIdx % 2) * 24);
      if (isNearTrack(track, sx, sz, halfW + 9)) continue;

      const boat = new THREE.Group();
      boat.position.set(sx, -0.1, sz);
      boat.rotation.y = angle;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 8.2), hullBlue);
      hull.position.y = 0.55;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 11.5, 8), darkMetal);
      mast.position.y = 6.2;
      const mainSail = new THREE.Mesh(new THREE.ConeGeometry(3.2, 9.5, 3), sailWhite);
      mainSail.scale.set(0.18, 1, 1);
      mainSail.position.set(0, 6.2, -1.2);
      boat.add(hull, mast, mainSail);
      propsGroup.add(boat);
    }

    for (const t of [0.02, 0.15, 0.28, 0.42, 0.58, 0.74, 0.86, 0.96]) {
      const node = placeTrackside(t, -1, 4.9, 0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 8), darkMetal);
      pole.position.y = 1.6;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 10), hullBlue);
      canopy.position.y = 3.2;
      node.add(pole, canopy);
    }
  } else if (city.id === 'cairo') {
    // 8. Cairo Pharaonic Temple Pylon Gateways, Khan el-Khalili Bedouin Bazaar Tents & Avenue of Sphinxes
    const tentRed = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.75 });
    const sandstone = new THREE.MeshStandardMaterial({ color: '#d9a45b', roughness: 0.82 });

    // Monumental Pharaonic Sandstone Temple Gateways with Winged Sun Disc Lintels over the road
    for (const gt of [0.16, 0.46, 0.74]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const pylonGate = new THREE.Group();
      pylonGate.position.set(s.point.x, s.point.y, s.point.z);
      pylonGate.rotation.y = yaw;
      for (const side of [-1, 1]) {
        const pylon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 11.5, 4), sandstone);
        pylon.rotation.y = Math.PI / 4;
        pylon.position.set(side * (halfW + 2.0), 5.75, 0);
        pylonGate.add(pylon);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 5.5, 1.4, 2.2), sandstone);
      lintel.position.set(0, 10.6, 0);
      const sunOrb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 12), warmGlow);
      sunOrb.position.set(0, 10.8, 1.1);
      pylonGate.add(lintel, sunOrb);
      propsGroup.add(pylonGate);
    }

    const spots = [0.02, 0.055, 0.14, 0.26, 0.39, 0.54, 0.68, 0.84, 0.965];
    spots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 5.2, 0);

      // Processional Sphinx on Sandstone Plinth facing the track
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 3.8), sandstone);
      plinth.position.y = 0.7;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 2.6), sandstone);
      body.position.y = 2.0;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.1, 8), warmGlow);
      head.position.set(0, 2.9, 0.8);
      node.add(plinth, body, head);

      // Bedouin Bazaar Canopy Tent behind the sphinx
      const tent = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.4, 4), tentRed);
      tent.position.set(side * 2.6, 2.8, 0);
      tent.rotation.y = Math.PI / 4;
      const tentBase = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 3.6), sandstone);
      tentBase.position.set(side * 2.6, 0.9, 0);
      node.add(tent, tentBase);
    });
  } else if (city.id === 'rio') {
    // 9. Rio Copacabana Tropical Beach Umbrellas, Overhead Carnival Samba Rainbow Arches & Parade Floats
    const carnivalPink = new THREE.MeshStandardMaterial({
      color: '#ec4899',
      emissive: '#db2777',
      emissiveIntensity: 0.85,
      roughness: 0.3,
    });
    const carnivalGreen = new THREE.MeshStandardMaterial({
      color: '#10b981',
      emissive: '#059669',
      emissiveIntensity: 0.75,
      roughness: 0.3,
    });

    // Overhead Sambadrome Carnival Parade Rainbow Portals spanning the roadway
    for (const gt of [0.16, 0.46, 0.74]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const sambaPortal = new THREE.Group();
      sambaPortal.position.set(s.point.x, s.point.y, s.point.z);
      sambaPortal.rotation.y = yaw;
      const arch1 = new THREE.Mesh(
        new THREE.TorusGeometry(halfW + 1.4, 0.48, 12, 32, Math.PI),
        carnivalPink
      );
      arch1.scale.set(1, 0.8, 1);
      const arch2 = new THREE.Mesh(
        new THREE.TorusGeometry(halfW + 2.1, 0.42, 12, 32, Math.PI),
        warmGlow
      );
      arch2.scale.set(1, 0.8, 1);
      sambaPortal.add(arch1, arch2);
      propsGroup.add(sambaPortal);
    }

    const spots = [0.015, 0.045, 0.14, 0.25, 0.38, 0.51, 0.64, 0.78, 0.91, 0.975];
    spots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 4.8, 0);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.0, 8), darkMetal);
      pole.position.y = 1.5;
      const umbrella = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 0.95, 12),
        idx % 2 === 0 ? carnivalPink : carnivalGreen
      );
      umbrella.position.y = 3.0;
      node.add(pole, umbrella);

      if (idx % 3 === 0) {
        // Golden Carnival Sun Archway Float beside the promenade
        const sunRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.35, 12, 24), warmGlow);
        sunRing.position.set(side * 1.8, 3.6, 0);
        sunRing.rotation.y = Math.PI / 2;
        node.add(sunRing);
      }
    });
  } else {
    // 10. Rome: Classical Marble Statues, Roman Triumphal Archways across the road & Corinthian Columns
    const marbleMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.35, metalness: 0.1 });
    const travertineMat = new THREE.MeshStandardMaterial({ color: '#d8c3a5', roughness: 0.75 });

    // Monumental Roman Triumphal Arch Portals (Arch of Constantine style) spanning the circuit
    for (const gt of [0.16, 0.47, 0.75]) {
      const s = sampleTrackAt(track, gt);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const triumphArch = new THREE.Group();
      triumphArch.position.set(s.point.x, s.point.y, s.point.z);
      triumphArch.rotation.y = yaw;
      for (const side of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(2.8, 10.5, 2.4), travertineMat);
        pier.position.set(side * (halfW + 2.0), 5.25, 0);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 9.8, 14), marbleMat);
        col.position.set(side * (halfW + 0.6), 4.9, 1.1);
        triumphArch.add(pier, col);
      }
      const attic = new THREE.Mesh(new THREE.BoxGeometry(city.roadWidth + 6.8, 2.4, 2.6), travertineMat);
      attic.position.set(0, 11.2, 0);
      triumphArch.add(attic);
      propsGroup.add(triumphArch);
    }

    const spots = [0.018, 0.05, 0.15, 0.27, 0.39, 0.53, 0.67, 0.81, 0.93, 0.975];
    spots.forEach((t, idx) => {
      const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const node = placeTrackside(t, side, 4.9, 0);

      // Classical Roman Marble Column & Emperor Statue Silhouette
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.6), travertineMat);
      plinth.position.y = 0.9;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 4.2, 14), travertineMat);
      col.position.y = 3.9;
      const statueBody = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.8, 12), marbleMat);
      statueBody.position.y = 6.9;
      const statueHead = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), marbleMat);
      statueHead.position.y = 8.05;
      node.add(plinth, col, statueBody, statueHead);
    });
  }
}

/**
 * Builds Trackside Spectator Grandstands and 220+ Animated 3D Citizens (Cheering Spectators & Strolling Pedestrians)
 * using zero-GC InstancedMeshes with Blender-style rounded CapsuleGeometry anatomy and regional headwear.
 */
function buildCityCrowdAndSpectators(group: THREE.Group, track: TrackData): CityCrowdRefs {
  const { city } = track;
  const halfW = city.roadWidth * 0.5;
  const citizens: CitizenInstanceData[] = [];

  // 1. Build 8 Architectural Trackside Spectator Grandstands with Canopy Roofs
  // Explicitly placed near Start/Finish straight (0.975, 0.022, 0.055) and key corners around the expanded circuit!
  const standPlacements: Array<{ t: number; side: 1 | -1 }> = [
    { t: 0.976, side: -1 },
    { t: 0.022, side: 1 },
    { t: 0.055, side: -1 },
    { t: 0.19, side: 1 },
    { t: 0.34, side: -1 },
    { t: 0.51, side: 1 },
    { t: 0.68, side: -1 },
    { t: 0.83, side: 1 },
  ];

  const standFrameMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    roughness: 0.4,
    metalness: 0.65,
  });
  const standTierMat = new THREE.MeshStandardMaterial({
    color: '#334155',
    roughness: 0.65,
    metalness: 0.25,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: city.curbPrimary,
    emissive: city.accentHex,
    emissiveIntensity: 0.22,
    roughness: 0.35,
  });

  for (const sp of standPlacements) {
    const s = sampleTrackAt(track, sp.t);
    const trackYaw = Math.atan2(s.tangent.x, s.tangent.z);
    // Face directly inward toward the track centerline
    const faceRoadYaw = trackYaw + (sp.side === 1 ? -Math.PI / 2 : Math.PI / 2);
    const standDist = halfW + 5.6;
    const standBaseX = s.point.x + s.right.x * standDist * sp.side;
    const standBaseY = s.point.y;
    const standBaseZ = s.point.z + s.right.z * standDist * sp.side;

    const standGroup = new THREE.Group();
    standGroup.position.set(standBaseX, standBaseY, standBaseZ);
    standGroup.rotation.y = trackYaw;
    group.add(standGroup);

    // 3 Stepped Seating Tiers + Overhead Cantilever Awning Canopy
    for (let tier = 0; tier < 3; tier++) {
      const tierDepthOffset = sp.side * (tier * 1.15);
      const tierHeight = 0.55 + tier * 0.68;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.18, tierHeight, 13.5), standTierMat);
      bench.position.set(tierDepthOffset, tierHeight * 0.5, 0);
      standGroup.add(bench);

      // Populate 6 cheering 3D spectators along each tier (18 per grandstand = 144 grandstand spectators!)
      for (let slot = 0; slot < 6; slot++) {
        const alongZ = -5.4 + slot * 2.16 + ((tier % 2) * 0.45 - 0.22);
        const worldX =
          standBaseX + s.right.x * tierDepthOffset + s.tangent.x * alongZ;
        const worldZ =
          standBaseZ + s.right.z * tierDepthOffset + s.tangent.z * alongZ;
        const worldY = standBaseY + tierHeight;

        citizens.push({
          mode: 'spectator',
          baseX: worldX,
          baseY: worldY,
          baseZ: worldZ,
          yaw: faceRoadYaw + ((slot % 3) - 1) * 0.14,
          trackT: sp.t,
          walkSpeedT: 0,
          walkDir: 1,
          lateralDist: 0,
          phase: (citizens.length * 1.37) % (Math.PI * 2),
          scale: 0.92 + (citizens.length % 4) * 0.06,
          hasProp: (slot + tier) % 2 === 0,
        });
      }
    }

    // Back pillars & angled stadium roof canopy
    for (const pz of [-5.8, 0, 5.8]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5.6, 8), standFrameMat);
      pillar.position.set(sp.side * 2.8, 2.8, pz);
      standGroup.add(pillar);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.24, 14.4), canopyMat);
    roof.position.set(sp.side * 1.2, 5.5, 0);
    roof.rotation.z = -sp.side * 0.14;
    standGroup.add(roof);
  }

  // 2. Add 28 Promenade / Sidewalk Cheering Fans right along the Start/Finish Guardrail (t = 0.982 .. 0.045)
  for (let i = 0; i < 28; i++) {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const rawT = 0.982 + (i / 28) * 0.065;
    const t = rawT >= 1 ? rawT - 1 : rawT;
    const s = sampleTrackAt(track, t);
    const trackYaw = Math.atan2(s.tangent.x, s.tangent.z);
    const faceRoadYaw = trackYaw + (side === 1 ? -Math.PI / 2 : Math.PI / 2);
    const dist = halfW + 1.85 + (i % 3) * 0.35;

    citizens.push({
      mode: 'spectator',
      baseX: s.point.x + s.right.x * dist * side,
      baseY: s.point.y + 0.08,
      baseZ: s.point.z + s.right.z * dist * side,
      yaw: faceRoadYaw,
      trackT: t,
      walkSpeedT: 0,
      walkDir: 1,
      lateralDist: dist * side,
      phase: i * 0.85,
      scale: 0.96 + (i % 3) * 0.05,
      hasProp: true,
    });
  }

  // 3. Add 64 Strolling Sidewalk Pedestrians walking along the left & right boulevards around the entire expanded city circuit!
  for (let i = 0; i < 64; i++) {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const walkDir: 1 | -1 = i % 4 < 2 ? 1 : -1;
    const dist = (halfW + 2.35 + (i % 3) * 0.55) * side;
    const t = (i / 64) % 1;
    citizens.push({
      mode: 'walker',
      baseX: 0,
      baseY: 0,
      baseZ: 0,
      yaw: 0,
      trackT: t,
      walkSpeedT: 0.0048 + (i % 5) * 0.0011,
      walkDir,
      lateralDist: dist,
      phase: i * 1.15,
      scale: 0.94 + (i % 4) * 0.05,
      hasProp: i % 3 === 0,
    });
  }

  const count = citizens.length;

  // Blender-style organic rounded CapsuleGeometry & SphereGeometry anatomy for 3D Citizens
  const legsGeo = new THREE.CapsuleGeometry(0.14, 0.44, 6, 10);
  legsGeo.scale(1.15, 1, 0.85);
  legsGeo.translate(0, 0.36, 0);

  const torsoGeo = new THREE.CapsuleGeometry(0.21, 0.34, 8, 12);
  torsoGeo.scale(1.08, 1, 0.72);
  torsoGeo.translate(0, 1.04, 0);

  const headGeo = new THREE.SphereGeometry(0.21, 14, 12);
  headGeo.translate(0, 1.56, 0);

  // Culturally distinctive headwear: Conical Nón Lá in Hà Nội/Tokyo, Sun/Samba hats in Rio/Sydney/Paris, Keffiyeh/Crown in Dubai/Cairo
  const isConicalHat = city.id === 'hanoi' || city.id === 'tokyo';
  const hatGeo = isConicalHat
    ? new THREE.ConeGeometry(0.44, 0.25, 16)
    : new THREE.CylinderGeometry(0.24, 0.34, 0.16, 14);
  hatGeo.translate(0, 1.76, 0);

  // Rounded Capsule arms pivoted near the shoulders so rotating dummy pitches the arms up/down naturally!
  const leftArmGeo = new THREE.CapsuleGeometry(0.068, 0.42, 6, 10);
  leftArmGeo.translate(-0.32, 0.24, 0);

  const rightArmGeo = new THREE.CapsuleGeometry(0.068, 0.42, 6, 10);
  rightArmGeo.translate(0.32, 0.24, 0);

  // Handheld cheering glowstick / flag banner attached to right hand
  const propGeo = new THREE.BoxGeometry(0.12, 0.54, 0.34);
  propGeo.translate(0.34, 0.64, 0.1);

  const pantsMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.72 });
  const torsoMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
  const skinMat = new THREE.MeshStandardMaterial({ color: '#f1c27d', roughness: 0.55 });
  const hatColor =
    city.id === 'hanoi'
      ? '#fde68a'
      : city.id === 'dubai' || city.id === 'cairo'
      ? '#f8fafc'
      : city.id === 'rio'
      ? '#facc15'
      : city.curbPrimary;
  const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.48 });
  const propMat = new THREE.MeshStandardMaterial({
    color: city.accentHex,
    emissive: city.accentHex,
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });

  const legsInst = new THREE.InstancedMesh(legsGeo, pantsMat, count);
  const torsoInst = new THREE.InstancedMesh(torsoGeo, torsoMat, count);
  const headInst = new THREE.InstancedMesh(headGeo, skinMat, count);
  const hatInst = new THREE.InstancedMesh(hatGeo, hatMat, count);
  const leftArmInst = new THREE.InstancedMesh(leftArmGeo, torsoMat, count);
  const rightArmInst = new THREE.InstancedMesh(rightArmGeo, torsoMat, count);
  const propInst = new THREE.InstancedMesh(propGeo, propMat, count);

  const allMeshes = [legsInst, torsoInst, headInst, hatInst, leftArmInst, rightArmInst, propInst];
  for (const m of allMeshes) {
    m.frustumCulled = false;
    group.add(m);
  }

  // Assign vibrant city-themed outfit colors per citizen
  const palette =
    city.id === 'hanoi'
      ? ['#ef4444', '#f59e0b', '#10b981', '#ec4899', '#38bdf8', '#fde047']
      : city.id === 'tokyo'
      ? ['#f43f5e', '#22d3ee', '#a855f7', '#facc15', '#38bdf8', '#fb7185']
      : city.id === 'rio'
      ? ['#22c55e', '#facc15', '#38bdf8', '#ec4899', '#f97316']
      : [city.accentHex, city.curbPrimary, '#38bdf8', '#f59e0b', '#ec4899', '#22c55e', '#f8fafc'];

  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    c.set(palette[i % palette.length]);
    torsoInst.setColorAt(i, c);
    leftArmInst.setColorAt(i, c);
    rightArmInst.setColorAt(i, c);
  }
  if (torsoInst.instanceColor) torsoInst.instanceColor.needsUpdate = true;
  if (leftArmInst.instanceColor) leftArmInst.instanceColor.needsUpdate = true;
  if (rightArmInst.instanceColor) rightArmInst.instanceColor.needsUpdate = true;

  return {
    citizens,
    legsInst,
    torsoInst,
    headInst,
    hatInst,
    leftArmInst,
    rightArmInst,
    propInst,
  };
}

// Module-scoped scratch Object3D for zero-GC per-frame crowd animation
const _crowdDummy = new THREE.Object3D();
const _armDummy = new THREE.Object3D();

function updateCityCrowdInternal(crowd: CityCrowdRefs, track: TrackData, elapsedSec: number): void {
  const { citizens, legsInst, torsoInst, headInst, hatInst, leftArmInst, rightArmInst, propInst } = crowd;
  const len = citizens.length;

  for (let i = 0; i < len; i++) {
    const cit = citizens[i];
    let x = cit.baseX;
    let y = cit.baseY;
    let z = cit.baseZ;
    let yaw = cit.yaw;
    let armWavePitch = 0;

    if (cit.mode === 'spectator') {
      // Excited jumping & cheering rhythm
      const jump = Math.max(0, Math.sin(elapsedSec * 5.2 + cit.phase)) * 0.26;
      y += jump;
      yaw += Math.sin(elapsedSec * 2.8 + cit.phase) * 0.18;
      armWavePitch = Math.sin(elapsedSec * 9.5 + cit.phase) * 0.55;
    } else {
      // Strolling pedestrian walking smoothly along the city boulevard sidewalk
      const rawT = (cit.trackT + elapsedSec * cit.walkSpeedT * cit.walkDir) % 1;
      const t = rawT < 0 ? rawT + 1 : rawT;
      const s = sampleTrackAt(track, t);
      x = s.point.x + s.right.x * cit.lateralDist;
      z = s.point.z + s.right.z * cit.lateralDist;
      const strideBob = Math.abs(Math.sin(elapsedSec * 7.5 + cit.phase)) * 0.09;
      y = s.point.y + 0.08 + strideBob;
      const trackYaw = Math.atan2(s.tangent.x, s.tangent.z);
      yaw = cit.walkDir === 1 ? trackYaw : trackYaw + Math.PI;
      armWavePitch = Math.sin(elapsedSec * 7.5 + cit.phase) * 0.45;
    }

    _crowdDummy.position.set(x, y, z);
    _crowdDummy.rotation.set(0, yaw, 0);
    _crowdDummy.scale.setScalar(cit.scale);
    _crowdDummy.updateMatrix();

    legsInst.setMatrixAt(i, _crowdDummy.matrix);
    torsoInst.setMatrixAt(i, _crowdDummy.matrix);
    headInst.setMatrixAt(i, _crowdDummy.matrix);
    hatInst.setMatrixAt(i, _crowdDummy.matrix);

    // Articulated shoulder-height arms (spectators raise arms overhead cheering; walkers swing arms)
    _armDummy.position.set(x, y + 1.24 * cit.scale, z);
    if (cit.mode === 'spectator') {
      _armDummy.rotation.set(armWavePitch, yaw, 0);
    } else {
      _armDummy.rotation.set(Math.PI + armWavePitch, yaw, 0);
    }
    _armDummy.scale.setScalar(cit.scale);
    _armDummy.updateMatrix();
    leftArmInst.setMatrixAt(i, _armDummy.matrix);
    rightArmInst.setMatrixAt(i, _armDummy.matrix);

    if (cit.hasProp && cit.mode === 'spectator') {
      propInst.setMatrixAt(i, _armDummy.matrix);
    } else {
      _armDummy.scale.setScalar(0);
      _armDummy.updateMatrix();
      propInst.setMatrixAt(i, _armDummy.matrix);
    }
  }

  legsInst.instanceMatrix.needsUpdate = true;
  torsoInst.instanceMatrix.needsUpdate = true;
  headInst.instanceMatrix.needsUpdate = true;
  hatInst.instanceMatrix.needsUpdate = true;
  leftArmInst.instanceMatrix.needsUpdate = true;
  rightArmInst.instanceMatrix.needsUpdate = true;
  propInst.instanceMatrix.needsUpdate = true;
}

export function updateCityCrowd(refs: CityWorldRefs, track: TrackData, elapsedSec: number): void {
  if (!refs.crowd) return;
  updateCityCrowdInternal(refs.crowd, track, elapsedSec);
}

/**
 * Exports the full procedural Blender-subdivision S-Class Kart + Articulated Driver rig
 * (or chassis-only / driver-only sub-rigs) to a binary .GLB file for Blender 4.x workflows
 * and instant in-game re-importing.
 */
async function exportObjectToGLB(target: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      target,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: 'model/gltf-binary' }));
        } else {
          const json = JSON.stringify(result, null, 2);
          resolve(new Blob([json], { type: 'model/gltf+json' }));
        }
      },
      (error) => reject(error),
      { binary: true }
    );
  });
}

export async function exportKartToBlenderGLB(
  preset: RacerPreset,
  part: 'full' | 'kart' | 'driver' = 'full'
): Promise<Blob> {
  const rig = createKartAndDriver(preset);
  let kartOnly: THREE.Group | null = null;
  try {
    if (part === 'driver') {
      return await exportObjectToGLB(rig.defaultDriverGroup);
    }
    if (part === 'kart') {
      kartOnly = new THREE.Group();
      kartOnly.add(rig.defaultKartGroup);
      kartOnly.add(rig.defaultWheelsGroup);
      return await exportObjectToGLB(kartOnly);
    }
    return await exportObjectToGLB(rig.root);
  } finally {
    disposeObject3D(rig.root);
    if (kartOnly) disposeObject3D(kartOnly);
  }
}


