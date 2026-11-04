import * as THREE from "three";

export interface PbrTextureBundle {
  map: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  bumpMap: THREE.Texture | null;
}

export interface ProceduralMaterialBank {
  agedOak: THREE.MeshStandardMaterial;
  tarredOak: THREE.MeshStandardMaterial;
  forgedIron: THREE.MeshStandardMaterial;
  polishedBrass: THREE.MeshStandardMaterial;
  gothicBrick: THREE.MeshStandardMaterial;
  fieldGranite: THREE.MeshStandardMaterial;
  opusEmplectum: THREE.MeshStandardMaterial;
  slingLeather: THREE.MeshStandardMaterial;
  tentCanvas: THREE.MeshStandardMaterial;
}

let cachedBank: ProceduralMaterialBank | null = null;
let ssrFallbackBank: ProceduralMaterialBank | null = null;

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2d(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2d(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = x - fx;
  const ty = y - fy;
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);

  const x0 = ((fx % periodX) + periodX) % periodX;
  const x1 = (x0 + 1) % periodX;
  const y0 = ((fy % periodY) + periodY) % periodY;
  const y1 = (y0 + 1) % periodY;

  const n00 = hash2d(x0, y0, seed);
  const n10 = hash2d(x1, y0, seed);
  const n01 = hash2d(x0, y1, seed);
  const n11 = hash2d(x1, y1, seed);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

function fbmTileable(u: number, v: number, baseFreqX: number, baseFreqY: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = baseFreqX;
  let fy = baseFreqY;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2d(u * fx, v * fy, fx, fy, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

function configureTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeCanvasPair(size: number): {
  colorCanvas: HTMLCanvasElement;
  roughCanvas: HTMLCanvasElement;
  bumpCanvas: HTMLCanvasElement;
  colorData: ImageData;
  roughData: ImageData;
  bumpData: ImageData;
  putAll: () => void;
} {
  const colorCanvas = document.createElement("canvas");
  const roughCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  colorCanvas.width = roughCanvas.width = bumpCanvas.width = size;
  colorCanvas.height = roughCanvas.height = bumpCanvas.height = size;

  const cCtx = colorCanvas.getContext("2d")!;
  const rCtx = roughCanvas.getContext("2d")!;
  const bCtx = bumpCanvas.getContext("2d")!;

  const colorData = cCtx.createImageData(size, size);
  const roughData = rCtx.createImageData(size, size);
  const bumpData = bCtx.createImageData(size, size);

  return {
    colorCanvas,
    roughCanvas,
    bumpCanvas,
    colorData,
    roughData,
    bumpData,
    putAll: () => {
      cCtx.putImageData(colorData, 0, 0);
      rCtx.putImageData(roughData, 0, 0);
      bCtx.putImageData(bumpData, 0, 0);
    },
  };
}

function writeGrayPixel(data: Uint8ClampedArray, idx: number, v: number): void {
  const b = clampByte(v);
  data[idx] = b;
  data[idx + 1] = b;
  data[idx + 2] = b;
  data[idx + 3] = 255;
}

function buildOakTextures(tarred: boolean): PbrTextureBundle {
  const size = 512;
  const { colorCanvas, roughCanvas, bumpCanvas, colorData, roughData, bumpData, putAll } =
    makeCanvasPair(size);
  const cd = colorData.data;
  const rd = roughData.data;
  const bd = bumpData.data;
  const seed = tarred ? 4409 : 1362;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    // Ciemne zabrudzenia ciesielskie i smolne przy czopach / końcach belek
    const endDist = Math.min(v, 1 - v);
    const tenonGrime = Math.max(0, 1 - endDist / 0.14) ** 1.7;

    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const warp = fbmTileable(u, v, 4, 2, 3, seed) * 0.18;
      const fine = fbmTileable(u, v, 32, 8, 3, seed + 31);
      const ringCoord = (u + warp) * 18.0;
      const ringWave = Math.sin(ringCoord * Math.PI * 2) * 0.5 + 0.5;
      const lateWood = Math.pow(ringWave, 2.4);
      const pores = fbmTileable(u, v, 64, 16, 2, seed + 77);

      // Sęk ciesielski
      const ku = ((u - 0.37 + 1) % 1) - 0.5;
      const kv = ((v - 0.54 + 1) % 1) - 0.5;
      const knotDist = Math.hypot(ku * 2.4, kv * 1.1);
      const knotMask = Math.max(0, 1 - knotDist / 0.16);
      const knotRings = knotMask > 0 ? Math.sin(knotDist * 75) * 0.5 + 0.5 : 0;

      let shade = 0.62 + lateWood * 0.28 + (fine - 0.5) * 0.18 - (pores > 0.72 ? 0.12 : 0);
      shade -= knotMask * (0.28 - knotRings * 0.12);
      shade *= 1 - tenonGrime * 0.36;

      if (tarred) {
        const pitchPatch = fbmTileable(u, v, 6, 6, 3, seed + 211);
        const tarGloss = pitchPatch > 0.56 ? (pitchPatch - 0.56) * 2.2 : 0;
        const baseR = 66 * shade * (1 - tarGloss * 0.45);
        const baseG = 48 * shade * (1 - tarGloss * 0.48);
        const baseB = 35 * shade * (1 - tarGloss * 0.42);
        cd[idx] = clampByte(baseR);
        cd[idx + 1] = clampByte(baseG);
        cd[idx + 2] = clampByte(baseB);
        cd[idx + 3] = 255;

        const rough = 212 - lateWood * 22 - tarGloss * 95 + tenonGrime * 18;
        const bump = 118 + lateWood * 48 - (pores > 0.72 ? 32 : 0) - knotMask * 25;
        writeGrayPixel(rd, idx, rough);
        writeGrayPixel(bd, idx, bump);
      } else {
        const baseR = 146 * shade;
        const baseG = 104 * shade;
        const baseB = 64 * shade;
        cd[idx] = clampByte(baseR);
        cd[idx + 1] = clampByte(baseG);
        cd[idx + 2] = clampByte(baseB);
        cd[idx + 3] = 255;

        const rough = 216 - lateWood * 26 + tenonGrime * 24 + (pores > 0.72 ? 16 : 0);
        const bump = 112 + lateWood * 56 - (pores > 0.72 ? 36 : 0) - knotMask * 30;
        writeGrayPixel(rd, idx, rough);
        writeGrayPixel(bd, idx, bump);
      }
    }
  }

  putAll();
  return {
    map: configureTexture(colorCanvas, true, 1, 2),
    roughnessMap: configureTexture(roughCanvas, false, 1, 2),
    bumpMap: configureTexture(bumpCanvas, false, 1, 2),
  };
}

function buildForgedIronTextures(): PbrTextureBundle {
  const size = 256;
  const { colorCanvas, roughCanvas, bumpCanvas, colorData, roughData, bumpData, putAll } =
    makeCanvasPair(size);
  const cd = colorData.data;
  const rd = roughData.data;
  const bd = bumpData.data;

  // Młotkowane wgniecenia kowalskie (komórkowy rozkład kraterów młotka)
  const rng = createSeededRng(1410);
  const hammerPts: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < 68; i++) {
    hammerPts.push({
      x: rng(),
      y: rng(),
      r: 0.055 + rng() * 0.055,
    });
  }

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      let dimple = 0;
      for (let i = 0; i < hammerPts.length; i++) {
        const p = hammerPts[i];
        let dx = Math.abs(u - p.x);
        let dy = Math.abs(v - p.y);
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const d = Math.hypot(dx, dy);
        if (d < p.r) {
          const t = 1 - d / p.r;
          dimple = Math.max(dimple, t * t);
        }
      }

      const scaleNoise = fbmTileable(u, v, 12, 12, 3, 881);
      const soot = fbmTileable(u, v, 5, 5, 2, 991);
      const sheen = 0.72 + dimple * 0.24 + (scaleNoise - 0.5) * 0.2 - soot * 0.14;

      cd[idx] = clampByte(74 * sheen);
      cd[idx + 1] = clampByte(78 * sheen);
      cd[idx + 2] = clampByte(86 * sheen);
      cd[idx + 3] = 255;

      const rough = 128 - dimple * 38 + soot * 36 + (scaleNoise - 0.5) * 28;
      const bump = 142 - dimple * 64 + (scaleNoise - 0.5) * 26;
      writeGrayPixel(rd, idx, rough);
      writeGrayPixel(bd, idx, bump);
    }
  }

  putAll();
  return {
    map: configureTexture(colorCanvas, true, 2, 2),
    roughnessMap: configureTexture(roughCanvas, false, 2, 2),
    bumpMap: configureTexture(bumpCanvas, false, 2, 2),
  };
}

function buildPolishedBrassTextures(): PbrTextureBundle {
  const size = 256;
  const { colorCanvas, roughCanvas, bumpCanvas, colorData, roughData, bumpData, putAll } =
    makeCanvasPair(size);
  const cd = colorData.data;
  const rd = roughData.data;
  const bd = bumpData.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const brush = fbmTileable(u, v, 32, 4, 3, 2026);
      const patina = fbmTileable(u, v, 6, 6, 2, 2099);
      const glow = 0.88 + (brush - 0.5) * 0.14 - patina * 0.08;

      cd[idx] = clampByte(238 * glow);
      cd[idx + 1] = clampByte(186 * glow);
      cd[idx + 2] = clampByte(78 * glow);
      cd[idx + 3] = 255;

      writeGrayPixel(rd, idx, 54 + patina * 28 + (brush - 0.5) * 18);
      writeGrayPixel(bd, idx, 128 + (brush - 0.5) * 24);
    }
  }

  putAll();
  return {
    map: configureTexture(colorCanvas, true, 1, 1),
    roughnessMap: configureTexture(roughCanvas, false, 1, 1),
    bumpMap: configureTexture(bumpCanvas, false, 1, 1),
  };
}

function buildGothicBrickTextures(): PbrTextureBundle {
  // Czerwona cegła gotycka "palcówka" w wątku gotyckim (wozówka + główka) z zaprawą wapienną
  const size = 512;
  const { colorCanvas, roughCanvas, bumpCanvas, colorData, roughData, bumpData, putAll } =
    makeCanvasPair(size);
  const cd = colorData.data;
  const rd = roughData.data;
  const bd = bumpData.data;

  const rows = 8;
  const mortarV = 0.13;
  const mortarU = 0.018;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const rowFloat = v * rows;
    const rowIdx = Math.floor(rowFloat);
    const rowLocalV = rowFloat - rowIdx;

    // Wątek gotycki: w każdym rzędzie 3 moduły (wozówka 2/3 + główka 1/3 = 1 jednostka powtórzeniowa * 3)
    const patternShift = (rowIdx % 2) * 0.5;

    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const clayNoise = fbmTileable(u, v, 16, 16, 3, 1309);
      const fingerGrooves = Math.sin((v * rows * Math.PI * 3.0) + clayNoise * 2.1) * 0.5 + 0.5;
      const mortarJitter = (clayNoise - 0.5) * 0.025;

      const unitsPerRow = 3;
      const unitFloat = ((u * unitsPerRow + patternShift) % unitsPerRow + unitsPerRow) % unitsPerRow;
      const unitIdx = Math.floor(unitFloat);
      const f = unitFloat - unitIdx;

      // W obrębie modułu: [0 .. 0.667] wozówka, [0.667 .. 1.0] główka wypalana mocniej (zendrówka)
      const isHeader = f > 0.6667;
      const brickSubIdx = unitIdx * 2 + (isHeader ? 1 : 0);
      const localU = isHeader ? (f - 0.6667) / 0.3333 : f / 0.6667;
      const uMargin = isHeader ? mortarU * 3.0 : mortarU * 1.5;

      const inHorizontalMortar =
        rowLocalV < mortarV + mortarJitter || rowLocalV > 1 - mortarV + mortarJitter;
      const inVerticalMortar =
        localU < uMargin + mortarJitter * 0.8 || localU > 1 - uMargin + mortarJitter * 0.8;

      if (inHorizontalMortar || inVerticalMortar) {
        // Jasna gruboziarnista zaprawa wapienno-piaskowa
        const sand = fbmTileable(u, v, 48, 48, 2, 1399);
        const mShade = 0.76 + (sand - 0.5) * 0.22;
        cd[idx] = clampByte(206 * mShade);
        cd[idx + 1] = clampByte(196 * mShade);
        cd[idx + 2] = clampByte(175 * mShade);
        cd[idx + 3] = 255;

        writeGrayPixel(rd, idx, 236);
        writeGrayPixel(bd, idx, 62 + sand * 26);
      } else {
        const brickRnd = hash2d(brickSubIdx, rowIdx, 701);
        // Niektóre główki to ciemne szkliwione zendrówki układane w romby krzyżackie!
        const clinker = isHeader && brickRnd > 0.62;
        const tone = 0.82 + brickRnd * 0.32 + (clayNoise - 0.5) * 0.22 + fingerGrooves * 0.07;

        if (clinker) {
          cd[idx] = clampByte(72 * tone);
          cd[idx + 1] = clampByte(46 * tone);
          cd[idx + 2] = clampByte(42 * tone);
        } else {
          cd[idx] = clampByte(174 * tone);
          cd[idx + 1] = clampByte(68 * tone + brickRnd * 14);
          cd[idx + 2] = clampByte(46 * tone);
        }
        cd[idx + 3] = 255;

        const rough = clinker ? 148 + clayNoise * 35 : 204 + (clayNoise - 0.5) * 34;
        const bump = 158 + fingerGrooves * 28 + (clayNoise - 0.5) * 32;
        writeGrayPixel(rd, idx, rough);
        writeGrayPixel(bd, idx, bump);
      }
    }
  }

  putAll();
  return {
    map: configureTexture(colorCanvas, true, 1, 1),
    roughnessMap: configureTexture(roughCanvas, false, 1, 1),
    bumpMap: configureTexture(bumpCanvas, false, 1, 1),
  };
}

function buildGraniteTextures(opusEmplectum: boolean): PbrTextureBundle {
  const size = 256;
  const { colorCanvas, roughCanvas, bumpCanvas, colorData, roughData, bumpData, putAll } =
    makeCanvasPair(size);
  const cd = colorData.data;
  const rd = roughData.data;
  const bd = bumpData.data;

  const rng = createSeededRng(opusEmplectum ? 3313 : 1919);
  const stones: Array<{ x: number; y: number; r: number; tint: number }> = [];
  if (opusEmplectum) {
    for (let i = 0; i < 34; i++) {
      stones.push({
        x: rng(),
        y: rng(),
        r: 0.08 + rng() * 0.08,
        tint: rng(),
      });
    }
  }

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const crystal = fbmTileable(u, v, 32, 32, 3, 505);
      const macro = fbmTileable(u, v, 6, 6, 3, 607);
      const mica = hash2d(x, y, 709) > 0.92 ? 0.18 : 0;

      if (opusEmplectum) {
        // Rdzeń muru opus emplectum: kamienie polne zatopione w białej zaprawie wapiennej
        let bestMask = 0;
        let stoneTint = 0.5;
        for (let i = 0; i < stones.length; i++) {
          const s = stones[i];
          let dx = Math.abs(u - s.x);
          let dy = Math.abs(v - s.y);
          if (dx > 0.5) dx = 1 - dx;
          if (dy > 0.5) dy = 1 - dy;
          const d = Math.hypot(dx, dy) + (macro - 0.5) * 0.035;
          if (d < s.r) {
            const m = Math.min(1, (s.r - d) / 0.025);
            if (m > bestMask) {
              bestMask = m;
              stoneTint = s.tint;
            }
          }
        }

        const mortarR = 210 * (0.85 + crystal * 0.2);
        const mortarG = 200 * (0.85 + crystal * 0.2);
        const mortarB = 180 * (0.85 + crystal * 0.2);

        const stR = (118 + stoneTint * 42) * (0.78 + crystal * 0.35);
        const stG = (112 + stoneTint * 30) * (0.78 + crystal * 0.35);
        const stB = (108 + stoneTint * 28) * (0.78 + crystal * 0.35);

        cd[idx] = clampByte(mortarR + (stR - mortarR) * bestMask);
        cd[idx + 1] = clampByte(mortarG + (stG - mortarG) * bestMask);
        cd[idx + 2] = clampByte(mortarB + (stB - mortarB) * bestMask);
        cd[idx + 3] = 255;

        writeGrayPixel(rd, idx, 232 - bestMask * 32);
        writeGrayPixel(bd, idx, 84 + bestMask * 88 + (crystal - 0.5) * 32);
      } else {
        // Ciosany granit / głaz narzutowy (szaro-różowe skalenie, kwarc i ciemny biotyt)
        const shade = 0.66 + macro * 0.34 + (crystal - 0.5) * 0.32 + mica;
        const feldspar = crystal > 0.62 ? 14 : 0;
        cd[idx] = clampByte(138 * shade + feldspar);
        cd[idx + 1] = clampByte(132 * shade + feldspar * 0.35);
        cd[idx + 2] = clampByte(126 * shade);
        cd[idx + 3] = 255;

        writeGrayPixel(rd, idx, 206 - mica * 140 + (crystal - 0.5) * 36);
        writeGrayPixel(bd, idx, 122 + (macro - 0.5) * 72 + (crystal - 0.5) * 54);
      }
    }
  }

  putAll();
  return {
    map: configureTexture(colorCanvas, true, 2, 2),
    roughnessMap: configureTexture(roughCanvas, false, 2, 2),
    bumpMap: configureTexture(bumpCanvas, false, 2, 2),
  };
}

function buildWovenFabricTextures(leather: boolean): PbrTextureBundle {
  const size = 256;
  const { colorCanvas, roughCanvas, bumpCanvas, colorData, roughData, bumpData, putAll } =
    makeCanvasPair(size);
  const cd = colorData.data;
  const rd = roughData.data;
  const bd = bumpData.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;
      const n = fbmTileable(u, v, 16, 16, 3, leather ? 411 : 511);

      if (leather) {
        const pebble = fbmTileable(u, v, 48, 48, 2, 433);
        const s = 0.72 + (n - 0.5) * 0.25 + (pebble - 0.5) * 0.2;
        cd[idx] = clampByte(112 * s);
        cd[idx + 1] = clampByte(68 * s);
        cd[idx + 2] = clampByte(40 * s);
        cd[idx + 3] = 255;
        writeGrayPixel(rd, idx, 184 + (pebble - 0.5) * 38);
        writeGrayPixel(bd, idx, 126 + (pebble - 0.5) * 52);
      } else {
        const weave = ((x >> 1) ^ (y >> 1)) & 1 ? 0.06 : -0.06;
        const s = 0.88 + (n - 0.5) * 0.16 + weave;
        cd[idx] = clampByte(228 * s);
        cd[idx + 1] = clampByte(214 * s);
        cd[idx + 2] = clampByte(184 * s);
        cd[idx + 3] = 255;
        writeGrayPixel(rd, idx, 226);
        writeGrayPixel(bd, idx, 128 + weave * 180);
      }
    }
  }

  putAll();
  return {
    map: configureTexture(colorCanvas, true, 2, 2),
    roughnessMap: configureTexture(roughCanvas, false, 2, 2),
    bumpMap: configureTexture(bumpCanvas, false, 2, 2),
  };
}

function createSsrFallbackBank(): ProceduralMaterialBank {
  return {
    agedOak: new THREE.MeshStandardMaterial({ color: "#7a5333", roughness: 0.82, metalness: 0.05 }),
    tarredOak: new THREE.MeshStandardMaterial({ color: "#3d2b1f", roughness: 0.74, metalness: 0.08 }),
    forgedIron: new THREE.MeshStandardMaterial({ color: "#434850", roughness: 0.38, metalness: 0.85 }),
    polishedBrass: new THREE.MeshStandardMaterial({
      color: "#eab344",
      roughness: 0.22,
      metalness: 0.88,
      emissive: "#6b470a",
      emissiveIntensity: 0.22,
    }),
    gothicBrick: new THREE.MeshStandardMaterial({ color: "#a5422d", roughness: 0.84, metalness: 0.04 }),
    fieldGranite: new THREE.MeshStandardMaterial({ color: "#85807b", roughness: 0.82, metalness: 0.08 }),
    opusEmplectum: new THREE.MeshStandardMaterial({ color: "#bdb39f", roughness: 0.9, metalness: 0.03 }),
    slingLeather: new THREE.MeshStandardMaterial({ color: "#683e24", roughness: 0.74, metalness: 0.05 }),
    tentCanvas: new THREE.MeshStandardMaterial({
      color: "#dfd1b4",
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  };
}

/**
 * Zwraca keszowany bank proceduralnych materiałów PBR (bezpieczny pod SSR).
 */
export function getProceduralMaterials(): ProceduralMaterialBank {
  if (typeof document === "undefined") {
    if (!ssrFallbackBank) {
      ssrFallbackBank = createSsrFallbackBank();
    }
    return ssrFallbackBank;
  }

  if (cachedBank) {
    return cachedBank;
  }

  const oakTex = buildOakTextures(false);
  const tarOakTex = buildOakTextures(true);
  const ironTex = buildForgedIronTextures();
  const brassTex = buildPolishedBrassTextures();
  const brickTex = buildGothicBrickTextures();
  const graniteTex = buildGraniteTextures(false);
  const emplectumTex = buildGraniteTextures(true);
  const leatherTex = buildWovenFabricTextures(true);
  const canvasTex = buildWovenFabricTextures(false);

  cachedBank = {
    agedOak: new THREE.MeshStandardMaterial({
      map: oakTex.map,
      roughnessMap: oakTex.roughnessMap,
      bumpMap: oakTex.bumpMap,
      bumpScale: 0.038,
      roughness: 0.84,
      metalness: 0.04,
    }),
    tarredOak: new THREE.MeshStandardMaterial({
      map: tarOakTex.map,
      roughnessMap: tarOakTex.roughnessMap,
      bumpMap: tarOakTex.bumpMap,
      bumpScale: 0.042,
      roughness: 0.72,
      metalness: 0.08,
    }),
    forgedIron: new THREE.MeshStandardMaterial({
      map: ironTex.map,
      roughnessMap: ironTex.roughnessMap,
      bumpMap: ironTex.bumpMap,
      bumpScale: 0.032,
      roughness: 0.38,
      metalness: 0.85,
    }),
    polishedBrass: new THREE.MeshStandardMaterial({
      map: brassTex.map,
      roughnessMap: brassTex.roughnessMap,
      bumpMap: brassTex.bumpMap,
      bumpScale: 0.016,
      roughness: 0.22,
      metalness: 0.88,
      emissive: new THREE.Color("#7c5310"),
      emissiveIntensity: 0.24,
    }),
    gothicBrick: new THREE.MeshStandardMaterial({
      map: brickTex.map,
      roughnessMap: brickTex.roughnessMap,
      bumpMap: brickTex.bumpMap,
      bumpScale: 0.055,
      roughness: 0.86,
      metalness: 0.04,
    }),
    fieldGranite: new THREE.MeshStandardMaterial({
      map: graniteTex.map,
      roughnessMap: graniteTex.roughnessMap,
      bumpMap: graniteTex.bumpMap,
      bumpScale: 0.05,
      roughness: 0.82,
      metalness: 0.08,
    }),
    opusEmplectum: new THREE.MeshStandardMaterial({
      map: emplectumTex.map,
      roughnessMap: emplectumTex.roughnessMap,
      bumpMap: emplectumTex.bumpMap,
      bumpScale: 0.065,
      roughness: 0.9,
      metalness: 0.03,
    }),
    slingLeather: new THREE.MeshStandardMaterial({
      map: leatherTex.map,
      roughnessMap: leatherTex.roughnessMap,
      bumpMap: leatherTex.bumpMap,
      bumpScale: 0.025,
      roughness: 0.76,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    tentCanvas: new THREE.MeshStandardMaterial({
      map: canvasTex.map,
      roughnessMap: canvasTex.roughnessMap,
      bumpMap: canvasTex.bumpMap,
      bumpScale: 0.018,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  };

  return cachedBank;
}

/**
 * Tworzy fazowaną (ośmiokątną w przekroju) belkę ciesielską o długości 1 wzdłuż osi Y
 * lub zwężającą się belkę główną wzdłuż osi X — zero ostrych plastikowych krawędzi BoxGeometry!
 */
export function createChamferedTimberGeometry(chamferRatio = 0.14): THREE.BufferGeometry {
  // Jednostkowy sześcian [-0.5..0.5]^3 ze ściętymi krawędziami podłużnymi (wzdłuż Y)
  const c = 0.5 - chamferRatio;
  const h = 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-c, -h);
  shape.lineTo(c, -h);
  shape.lineTo(h, -c);
  shape.lineTo(h, c);
  shape.lineTo(c, h);
  shape.lineTo(-c, h);
  shape.lineTo(-h, c);
  shape.lineTo(-h, -c);
  shape.closePath();

  const extrude = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
    steps: 1,
  });
  extrude.center();
  // Obracamy tak, aby oś podłużna belki biegła wzdłuż lokalnej osi Y (wygodne dla setFromUnitVectors!)
  extrude.rotateX(Math.PI / 2);
  extrude.computeVertexNormals();
  return extrude;
}

/**
 * Tworzy zwężającą się główną belkę dębową trebusza wzdłuż osi X:
 * od x = -shortArmM (gruby koniec przy skrzyni) przez x = 0 (oś główna) do x = +longArmM (smukły czubek pod palec).
 */
export function createTaperedMainBeamGeometry(
  shortArmM: number,
  longArmM: number
): THREE.BufferGeometry {
  const sections: Array<{ x: number; wy: number; wz: number }> = [
    { x: -shortArmM - 0.35, wy: 0.62, wz: 0.54 },
    { x: -shortArmM, wy: 0.68, wz: 0.58 },
    { x: -0.65, wy: 0.74, wz: 0.62 },
    { x: 0.0, wy: 0.76, wz: 0.64 },
    { x: 0.75, wy: 0.72, wz: 0.6 },
    { x: longArmM * 0.45, wy: 0.5, wz: 0.44 },
    { x: longArmM * 0.8, wy: 0.35, wz: 0.32 },
    { x: longArmM, wy: 0.25, wz: 0.24 },
  ];

  // 8 wierzchołków fazowanego przekroju w płaszczyźnie YZ
  const ringProfile: Array<[number, number]> = [
    [-0.36, -0.5],
    [0.36, -0.5],
    [0.5, -0.36],
    [0.5, 0.36],
    [0.36, 0.5],
    [-0.36, 0.5],
    [-0.5, 0.36],
    [-0.5, -0.36],
  ];

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const totalLen = longArmM + shortArmM + 0.35;

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const vCoord = (sec.x + shortArmM + 0.35) / totalLen;
    for (let p = 0; p < 8; p++) {
      const [py, pz] = ringProfile[p];
      positions.push(sec.x, py * sec.wy, pz * sec.wz);
      uvs.push(p / 8, vCoord * 4);
    }
  }

  for (let s = 0; s < sections.length - 1; s++) {
    const baseA = s * 8;
    const baseB = (s + 1) * 8;
    for (let p = 0; p < 8; p++) {
      const pn = (p + 1) % 8;
      const a0 = baseA + p;
      const a1 = baseA + pn;
      const b0 = baseB + p;
      const b1 = baseB + pn;
      indices.push(a0, b0, b1, a0, b1, a1);
    }
  }

  // Zaślepki na obu końcach belki
  const startCenterIdx = positions.length / 3;
  positions.push(sections[0].x, 0, 0);
  uvs.push(0.5, 0);
  for (let p = 0; p < 8; p++) {
    indices.push(startCenterIdx, (p + 1) % 8, p);
  }

  const endRingBase = (sections.length - 1) * 8;
  const endCenterIdx = positions.length / 3;
  positions.push(sections[sections.length - 1].x, 0, 0);
  uvs.push(0.5, 1);
  for (let p = 0; p < 8; p++) {
    indices.push(endCenterIdx, endRingBase + p, endRingBase + ((p + 1) % 8));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Łączy tablicę statycznych BufferGeometry (o tym samym materiale) w pojedynczą geometrię,
 * redukując dziesiątki drobnych meshów do 1 draw calla WebGL.
 */
export function mergeStaticGeometries(
  parts: Array<{
    geometry: THREE.BufferGeometry;
    matrix?: THREE.Matrix4;
    color?: THREE.ColorRepresentation;
  }>,
  withVertexColors = false
): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];
  let totalVertices = 0;

  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (part.matrix) {
      g.applyMatrix4(part.matrix);
    }
    if (!g.getAttribute("normal")) {
      g.computeVertexNormals();
    }
    const count = g.getAttribute("position").count;
    totalVertices += count;
    prepared.push(g);
  }

  const posOut = new Float32Array(totalVertices * 3);
  const normOut = new Float32Array(totalVertices * 3);
  const uvOut = new Float32Array(totalVertices * 2);
  const colOut = withVertexColors ? new Float32Array(totalVertices * 3) : null;
  const tmpColor = new THREE.Color();

  let offset = 0;
  for (let i = 0; i < prepared.length; i++) {
    const g = prepared[i];
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const norm = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const count = pos.count;

    posOut.set(pos.array as Float32Array, offset * 3);
    normOut.set(norm.array as Float32Array, offset * 3);
    if (uv) {
      uvOut.set(uv.array as Float32Array, offset * 2);
    }
    if (colOut) {
      tmpColor.set(parts[i].color ?? "#ffffff");
      for (let v = 0; v < count; v++) {
        const base = (offset + v) * 3;
        colOut[base] = tmpColor.r;
        colOut[base + 1] = tmpColor.g;
        colOut[base + 2] = tmpColor.b;
      }
    }

    offset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(posOut, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normOut, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uvOut, 2));
  if (colOut) {
    merged.setAttribute("color", new THREE.BufferAttribute(colOut, 3));
  }
  merged.computeBoundingSphere();
  return merged;
}

