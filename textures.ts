import * as THREE from 'three';

export function createRoadTexture(
  roadHex: string,
  curbPrimary: string,
  curbSecondary: string,
  accentHex: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base asphalt with subtle cross-road tonal gradient (slightly darker in center crown)
  const baseGrad = ctx.createLinearGradient(0, 0, 512, 0);
  baseGrad.addColorStop(0, roadHex);
  baseGrad.addColorStop(0.22, '#1f2937');
  baseGrad.addColorStop(0.5, roadHex);
  baseGrad.addColorStop(0.78, '#1f2937');
  baseGrad.addColorStop(1, roadHex);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Fine asphalt aggregate & micro-pebble grain
  for (let i = 0; i < 6500; i++) {
    const x = (i * 73) % 512;
    const y = (i * 197 + ((i * 29) % 43)) % 512;
    const isLight = i % 3 === 0;
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.085)';
    ctx.fillRect(x, y, (i % 2) + 1, (i % 3) + 1);
  }

  // Dual polished tire-wear racing groove tracks + rubber skid streaks
  const grooveGradL = ctx.createLinearGradient(95, 0, 195, 0);
  grooveGradL.addColorStop(0, 'rgba(0,0,0,0)');
  grooveGradL.addColorStop(0.5, 'rgba(9,13,22,0.24)');
  grooveGradL.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grooveGradL;
  ctx.fillRect(95, 0, 100, 512);

  const grooveGradR = ctx.createLinearGradient(317, 0, 417, 0);
  grooveGradR.addColorStop(0, 'rgba(0,0,0,0)');
  grooveGradR.addColorStop(0.5, 'rgba(9,13,22,0.24)');
  grooveGradR.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grooveGradR;
  ctx.fillRect(317, 0, 100, 512);

  // Subtle longitudinal micro-striations (road paver texture)
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 44; x < 468; x += 14) {
    ctx.fillRect(x, 0, 1, 512);
  }

  // FIA beveled apex rumble curbs along outer edges
  const curbW = 36;
  const stripes = 8;
  const stripeH = 512 / stripes;
  for (let i = 0; i < stripes; i++) {
    const y0 = i * stripeH;
    ctx.fillStyle = i % 2 === 0 ? curbPrimary : curbSecondary;
    ctx.fillRect(0, y0, curbW, stripeH);
    ctx.fillRect(512 - curbW, y0, curbW, stripeH);

    // 3D beveled highlight & mortar shadow seam on each curb block
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, y0, curbW, 3);
    ctx.fillRect(512 - curbW, y0, curbW, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, y0 + stripeH - 3, curbW, 3);
    ctx.fillRect(512 - curbW, y0 + stripeH - 3, curbW, 3);
  }

  // Concrete drainage gutter & inner shadow next to curb
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(curbW, 0, 5, 512);
  ctx.fillRect(512 - curbW - 5, 0, 5, 512);

  // Crisp double-Reflective FIA boundary lines
  ctx.fillStyle = 'rgba(248,250,252,0.92)';
  ctx.fillRect(curbW + 7, 0, 7, 512);
  ctx.fillRect(512 - curbW - 14, 0, 7, 512);

  // Glowing LED/Reflective accent strips inside the shoulder line
  ctx.fillStyle = accentHex;
  ctx.globalAlpha = 0.65;
  ctx.fillRect(curbW + 17, 0, 4, 512);
  ctx.fillRect(512 - curbW - 21, 0, 4, 512);
  ctx.globalAlpha = 1;

  // Center dashed racing lane line + subtle cat's-eye reflector dots
  for (let y = 14; y < 512; y += 64) {
    ctx.fillStyle = 'rgba(248,250,252,0.78)';
    ctx.fillRect(252, y, 8, 36);
    ctx.fillStyle = accentHex;
    ctx.fillRect(254, y + 46, 4, 6);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Normal map for asphalt micro-grain + beveled curb block seams
 * (Linear space / NoColorSpace)
 */
export function createAsphaltNormalTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Flat normal base (128, 128, 255)
  ctx.fillStyle = 'rgb(128, 128, 255)';
  ctx.fillRect(0, 0, 256, 256);

  // Micro-bump noise for asphalt surface pores
  for (let i = 0; i < 4200; i++) {
    const x = (i * 53) % 256;
    const y = (i * 131 + ((i * 19) % 37)) % 256;
    const nx = 112 + ((i * 17) % 33);
    const ny = 112 + ((i * 23) % 33);
    ctx.fillStyle = `rgb(${nx}, ${ny}, 248)`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Curb bevel normal ridges along left/right edges
  const curbW = 18;
  const stripes = 8;
  const stripeH = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    const y0 = i * stripeH;
    ctx.fillStyle = 'rgb(128, 175, 240)';
    ctx.fillRect(0, y0, curbW, 2);
    ctx.fillRect(256 - curbW, y0, curbW, 2);
    ctx.fillStyle = 'rgb(128, 82, 240)';
    ctx.fillRect(0, y0 + stripeH - 2, curbW, 2);
    ctx.fillRect(256 - curbW, y0 + stripeH - 2, curbW, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Woven 2x2 twill carbon-fiber texture for automotive splitters, wings & diffusers
 */
let cachedCarbonTex: THREE.CanvasTexture | null = null;
export function createCarbonFiberTexture(): THREE.CanvasTexture {
  if (cachedCarbonTex) return cachedCarbonTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, 64, 64);

  const cell = 8;
  for (let y = 0; y < 64; y += cell) {
    for (let x = 0; x < 64; x += cell) {
      const diag = ((x + y) / cell) % 2 === 0;
      ctx.fillStyle = diag ? '#273244' : '#0f172a';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      ctx.fillStyle = diag ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(x + 1, y + 1, cell - 3, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  cachedCarbonTex = tex;
  return tex;
}

/**
 * Tire tread & sidewall groove texture for realistic racing slicks
 */
let cachedTireTex: THREE.CanvasTexture | null = null;
export function createTireTreadTexture(): THREE.CanvasTexture {
  if (cachedTireTex) return cachedTireTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#141923';
  ctx.fillRect(0, 0, 128, 256);

  // Longitudinal circumferential drainage grooves
  ctx.fillStyle = '#090d14';
  ctx.fillRect(28, 0, 8, 256);
  ctx.fillRect(60, 0, 8, 256);
  ctx.fillRect(92, 0, 8, 256);

  // Diagonal semi-slick sipes
  ctx.strokeStyle = '#090d14';
  ctx.lineWidth = 4;
  for (let y = -16; y < 272; y += 22) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(54, y + 14);
    ctx.moveTo(124, y);
    ctx.lineTo(74, y + 14);
    ctx.stroke();
  }

  // Subtle rubber sheen highlight along center crown
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(38, 0, 20, 256);
  ctx.fillRect(70, 0, 20, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cachedTireTex = tex;
  return tex;
}

/**
 * Terrain surface texture (grass, stone plazas, desert dunes, urban concrete)
 */
export function createTerrainTexture(baseHex: string, cityId: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  const isSand = cityId === 'cairo' || cityId === 'dubai';
  const isUrban = cityId === 'tokyo' || cityId === 'newyork' || cityId === 'london';

  if (isSand) {
    // Wind-rippled desert sand dunes
    for (let y = 0; y < 256; y += 8) {
      ctx.fillStyle = y % 16 === 0 ? 'rgba(255,248,220,0.08)' : 'rgba(120,65,15,0.08)';
      ctx.fillRect(0, y, 256, 4);
    }
  } else if (isUrban) {
    // Architectural urban slate / concrete grid tiles
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
  }

  // Organic micro-dappled variation
  for (let i = 0; i < 2400; i++) {
    const x = (i * 67) % 256;
    const y = (i * 149 + ((i * 13) % 29)) % 256;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x, y, 3, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  return tex;
}

export function createStartLineTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cols = 16;
  const rows = 4;
  const cw = 512 / cols;
  const rh = 128 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(c * cw, r * rh, cw, rh);
    }
  }
  // Crisp metallic gold/cyan racing border lines
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, 0, 512, 5);
  ctx.fillRect(0, 123, 512, 5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

export function createBoostPadTexture(accentHex: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#061e33';
  ctx.fillRect(0, 0, 256, 512);

  // Energy grid background
  ctx.strokeStyle = 'rgba(56,189,248,0.16)';
  ctx.lineWidth = 1;
  for (let y = 0; y < 512; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Glowing side rails
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(6, 0, 14, 512);
  ctx.fillRect(236, 0, 14, 512);
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(10, 0, 6, 512);
  ctx.fillRect(240, 0, 6, 512);

  // Quad glowing forward chevrons with hot core
  for (let i = 0; i < 4; i++) {
    const yBase = 52 + i * 116;
    ctx.beginPath();
    ctx.moveTo(36, yBase + 66);
    ctx.lineTo(128, yBase);
    ctx.lineTo(220, yBase + 66);
    ctx.lineTo(220, yBase + 98);
    ctx.lineTo(128, yBase + 34);
    ctx.lineTo(36, yBase + 98);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#22d3ee' : accentHex;
    ctx.fill();

    // Inner white-hot core highlight
    ctx.beginPath();
    ctx.moveTo(58, yBase + 64);
    ctx.lineTo(128, yBase + 14);
    ctx.lineTo(198, yBase + 64);
    ctx.lineTo(198, yBase + 76);
    ctx.lineTo(128, yBase + 26);
    ctx.lineTo(58, yBase + 76);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 61);
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.85)');
  grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.48)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBuildingFacadeTexture(
  baseHex: string,
  windowHex: string,
  neonMode: boolean,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base architectural facade
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 512);

  // Subtle vertical structural mullions & floor spandrel bands
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (let r = 0; r < 16; r++) {
    ctx.fillRect(0, r * 32, 256, 4);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let c = 0; c <= 8; c++) {
    ctx.fillRect(c * 32 - 1, 0, 2, 512);
  }

  const cols = 8;
  const rows = 16;
  const padX = 6;
  const padY = 6;
  const w = (256 - padX * (cols + 1)) / cols;
  const h = (512 - padY * (rows + 1)) / rows;

  // Deterministic pseudo-random window lighting + penthouse & ground commercial lobby
  let seed = baseHex.split('').reduce((a, ch) => a + ch.charCodeAt(0) * 19, 37);
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let r = 0; r < rows; r++) {
    const isTopMechanical = r === 0;
    const isGroundLobby = r === rows - 1;
    for (let c = 0; c < cols; c++) {
      const x = padX + c * (w + padX);
      const y = padY + r * (h + padY);

      if (isTopMechanical) {
        ctx.fillStyle = neonMode ? windowHex : 'rgba(15,23,42,0.85)';
        ctx.fillRect(x, y + 4, w, h - 6);
        continue;
      }

      const prob = isGroundLobby ? 0.85 : neonMode ? 0.68 : 0.54;
      const lit = nextRand() < prob;
      if (lit) {
        const warmShift = nextRand() > 0.65;
        ctx.fillStyle =
          neonMode && warmShift
            ? '#f472b6'
            : !neonMode && warmShift
            ? '#fde68a'
            : windowHex;
        ctx.fillRect(x, y, w, h);

        // Interior curtain/ceiling gradient for realistic glass depth
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + 2, y + 1, w - 4, 3);
      } else {
        // Dark reflective curtain-wall glass pane
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.fillRect(x + 1, y + 1, w * 0.45, h - 2);
      }
    }
  }

  // Vertical neon signage band on nocturnal cities
  if (neonMode) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.fillRect(122, 42, 12, 180);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(125, 48, 6, 168);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  return tex;
}

export function createSkyDomeTexture(topHex: string, horizonHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, topHex);
  grad.addColorStop(0.46, horizonHex);
  grad.addColorStop(0.55, '#fef3c7');
  grad.addColorStop(0.62, horizonHex);
  grad.addColorStop(1, horizonHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);

  // Subtle upper-atmosphere cloud wisps
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 28; i++) {
    const y = 36 + ((i * 19) % 88);
    const x = (i * 37) % 100;
    ctx.beginPath();
    ctx.ellipse(x + 14, y, 22, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Multi-lobe radial cloud puff texture for 3D volumetric low-altitude fog & mist banks
 */
export function createVolumetricFogTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);

  const lobes: Array<[number, number, number, number, number]> = [
    [128, 68, 108, 48, 0.52],
    [82, 72, 74, 38, 0.44],
    [176, 70, 76, 40, 0.44],
    [114, 54, 68, 34, 0.38],
    [148, 58, 64, 32, 0.36],
  ];

  for (const [cx, cy, rx, ry, alpha] of lobes) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, rx);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.45, `rgba(241, 245, 249, ${alpha * 0.65})`);
    grad.addColorStop(0.78, `rgba(226, 232, 240, ${alpha * 0.25})`);
    grad.addColorStop(1, 'rgba(226, 232, 240, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

