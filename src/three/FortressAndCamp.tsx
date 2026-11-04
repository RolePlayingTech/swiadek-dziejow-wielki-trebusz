"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type {
  ShotSimulationResult,
  SiegeMission,
  TrebuchetConfig,
} from "@/types/trebuchet";
import {
  createChamferedTimberGeometry,
  getProceduralMaterials,
  mergeStaticGeometries,
} from "./proceduralMaterials";

export interface FortressAndCampProps {
  mission: SiegeMission;
  config: TrebuchetConfig;
  activeResult: ShotSimulationResult | null;
  playbackTimeS: number;
  isFiring: boolean;
}

interface DestructibleBlock {
  /** Lokalna pozycja względem grupy zamku */
  lx: number;
  ly: number;
  lz: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  seed: number;
  r: number;
  g: number;
  b: number;
}

function pseudoRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Oblicza profil wysokości terenu oblężniczego [m] w funkcji współrzędnej X:
 * - Wzgórze oblężnicze pod trebuszem i obozem (x <= 15 m): y ~ 0
 * - Fosa zamkowa z wodą na [castleX - 18 .. castleX - 5]: zagłębienie do -2.4 m
 * - Skarpa podzamcza pod fundamentem zamku: wzniesienie do +0.6 m
 */
export function getTerrainHeightAtX(x: number, castleDistanceM: number): number {
  const moatCenter = castleDistanceM - 11.5;
  const distMoat = Math.abs(x - moatCenter);
  if (distMoat < 7.5) {
    const t = distMoat / 7.5;
    const smooth = t * t * (3 - 2 * t);
    return -2.35 * (1 - smooth);
  }
  if (x > castleDistanceM - 4.0) {
    const ramp = Math.min(1, (x - (castleDistanceM - 4.0)) / 3.5);
    return ramp * 0.45;
  }
  // Delikatna rzeźba przedpola
  return Math.sin(x * 0.045) * 0.14 * Math.min(1, Math.max(0, (x - 12) / 25));
}

export function FortressAndCamp({
  mission,
  config,
  activeResult,
  playbackTimeS,
  isFiring,
}: FortressAndCampProps) {
  const mats = useMemo(() => getProceduralMaterials(), []);
  const timberGeo = useMemo(() => createChamferedTimberGeometry(0.14), []);
  const unitBoxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const dustSphereGeo = useMemo(() => new THREE.DodecahedronGeometry(0.55, 0), []);

  // Przesunięcie zamku w osi Z i X tak, by aktywna strefa celu leżała dokładnie w płaszczyźnie strzału z = 0!
  const castleLayout = useMemo(() => {
    const isGdaniskoTarget =
      mission.targetZone === "gdanisko_wykusz" || activeResult?.outcome === "gdanisko_hit";
    if (isGdaniskoTarget) {
      // Gdanisko wystaje o 8.5 m przed lico głównej kurtyny nad fosę (lokalne x = -8.5, z = +9.5)
      return {
        groupX: mission.castleDistanceM + 8.5,
        groupZ: -9.5,
      };
    }
    if (mission.targetZone === "wieza_bramna") {
      // Wieża bramna ma lico wysunięte o 1.4 m przed kurtynę (lokalne x = -1.4, z = -10.5)
      return {
        groupX: mission.castleDistanceM + 1.4,
        groupZ: 10.5,
      };
    }
    return {
      groupX: mission.castleDistanceM,
      groupZ: 0,
    };
  }, [mission.castleDistanceM, mission.targetZone, activeResult?.outcome]);

  // 1. Jednolita siatka terenu oblężniczego z kolorami wierzchołków (błoto pod blidą, łąka, fosa, skarpa) — 1 draw call!
  const terrainGeo = useMemo(() => {
    const segX = 110;
    const segZ = 28;
    const minX = -85;
    const maxX = Math.max(320, mission.castleDistanceM + 85);
    const widthX = maxX - minX;
    const depthZ = 150;

    const geo = new THREE.PlaneGeometry(widthX, depthZ, segX, segZ);
    geo.rotateX(-Math.PI * 0.5);
    geo.translate(minX + widthX * 0.5, 0, 0);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      let vy = getTerrainHeightAtX(vx, castleLayout.groupX);

      // Wzgórza dalekiego horyzontu na bokach sceny (|z| > 34 m)
      const sideFactor = Math.max(0, (Math.abs(vz) - 32) / 42);
      vy += sideFactor * sideFactor * (3.8 + Math.sin(vx * 0.04 + vz * 0.05) * 1.9);

      // Płaski ubity plac pod samym trebuszem (-12..+8, |z| < 4.5)
      const padMask =
        Math.max(0, 1 - Math.abs(vx + 2) / 12) * Math.max(0, 1 - Math.abs(vz) / 5.5);
      vy = vy * (1 - padMask);
      pos.setY(i, vy);

      const n = pseudoRand(vx * 1.7 + vz * 2.3);
      if (vy < -0.55) {
        // Mokre muliste dno i brzegi fosy
        c.setRGB(0.18 + n * 0.04, 0.16 + n * 0.04, 0.13 + n * 0.03);
      } else if (padMask > 0.35 || (vx > -36 && vx < -16 && Math.abs(vz) < 8)) {
        // Rozjeżdżona ziemia ciesielska pod blidą i obozem
        c.setRGB(0.27 + n * 0.05, 0.21 + n * 0.04, 0.14 + n * 0.03);
      } else {
        // Jesienno-zmierzchowa murawa pruska
        c.setRGB(0.22 + n * 0.06, 0.27 + n * 0.06, 0.15 + n * 0.04);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [castleLayout.groupX, mission.castleDistanceM]);

  // 2. Generacja niszczalnych cegieł gotyckich (ok. 390 instancji) oraz belek hurdycji i Gdaniska (ok. 96 instancji)
  const { bricks, timbers } = useMemo(() => {
    const brickList: DestructibleBlock[] = [];
    const timberList: DestructibleBlock[] = [];
    let seed = 101;

    const pushBrick = (
      lx: number,
      ly: number,
      lz: number,
      sx: number,
      sy: number,
      sz: number,
      ry = 0
    ) => {
      const rnd = pseudoRand(seed++);
      const clinker = rnd > 0.84;
      brickList.push({
        lx,
        ly,
        lz,
        sx,
        sy,
        sz,
        ry,
        seed: seed * 1.37,
        r: clinker ? 0.48 : 0.86 + rnd * 0.22,
        g: clinker ? 0.34 : 0.42 + rnd * 0.12,
        b: clinker ? 0.32 : 0.34 + rnd * 0.08,
      });
    };

    const pushTimber = (
      lx: number,
      ly: number,
      lz: number,
      sx: number,
      sy: number,
      sz: number,
      ry = 0
    ) => {
      const rnd = pseudoRand(seed++);
      timberList.push({
        lx,
        ly,
        lz,
        sx,
        sy,
        sz,
        ry,
        seed: seed * 1.91,
        r: 0.78 + rnd * 0.2,
        g: 0.72 + rnd * 0.18,
        b: 0.66 + rnd * 0.15,
      });
    };

    // A) Lico głównej kurtyny ceglanej (z = -7.2 .. +7.2 m, y = 3.6 .. 13.6 m) + blanki (krenelaż)
    for (let row = 0; row < 10; row++) {
      const ly = 4.0 + row * 0.96;
      const stagger = (row % 2) * 0.6;
      for (let col = 0; col < 12; col++) {
        const lz = -6.9 + col * 1.22 + stagger * 0.5;
        pushBrick(0.15, ly, lz, 0.95, 0.9, 1.16);
      }
    }
    // Blanki na koronie muru
    for (let m = 0; m < 8; m++) {
      const lz = -6.6 + m * 1.88;
      pushBrick(0.15, 14.1, lz, 0.95, 1.15, 1.05);
    }

    // B) Drewniane HURDYCJE (wysunięty ganek obronny na z = -6.8 .. +6.8 m, y = 12.6 .. 15.6 m)
    for (let i = 0; i < 11; i++) {
      const lz = -6.5 + i * 1.3;
      // Belki wspornikowe (kroksztyny dębowe wysunięte przed mur)
      pushTimber(-0.45, 12.35, lz, 0.24, 0.24, 1.85, Math.PI * 0.5);
      // Zastrzały podpierające hurdycję
      pushTimber(-0.55, 11.75, lz, 0.2, 1.35, 0.2);
      // Deskowanie czołowe hurdycji ze strzelnicami
      pushTimber(-1.08, 13.45, lz, 0.22, 1.65, 1.22);
      // Krokwie stromego dachu gontowego nad hurdycją
      pushTimber(-0.35, 14.95, lz, 0.2, 1.95, 0.22);
    }

    // C) WIEŻA BRAMNA (lokalne z = -10.5 m, wysunięta do x = -1.4 m, wysokość do 23.5 m!)
    for (let row = 0; row < 14; row++) {
      const ly = 3.8 + row * 1.18;
      for (let col = 0; col < 5; col++) {
        const lz = -13.3 + col * 1.4;
        // Zostawiamy ostrołukowy przejazd bramny na dole w środku (ly < 7.8, |lz + 10.5| < 1.5)
        if (ly < 7.8 && Math.abs(lz + 10.5) < 1.3) continue;
        pushBrick(-1.15, ly, lz, 1.05, 1.12, 1.34);
      }
    }
    // Krenelaż i szczyt wieży bramnej
    for (let col = 0; col < 5; col++) {
      pushBrick(-1.15, 20.6, -13.3 + col * 1.4, 1.1, 1.25, 1.1);
      pushTimber(-0.2, 21.8, -13.3 + col * 1.4, 0.26, 2.2, 0.26);
    }

    // D) GDANISKO (wieża ustępowa Zakonu Krzyżackiego na arkadzie nad fosą! Lokalne z = +9.5 m, x = -8.5 .. 0 m)
    // Filar Gdaniska w fosie i wykusz ceglany (x = -8.2 m, y = 0.5 .. 14.8 m)
    for (let row = 0; row < 12; row++) {
      const ly = 1.2 + row * 1.12;
      for (let col = 0; col < 4; col++) {
        const lz = 7.7 + col * 1.2;
        pushBrick(-8.0, ly, lz, 1.15, 1.06, 1.14);
      }
    }
    // Ceglany ganek arkadowy łączący kurtynę (x = 0) z Gdaniskiem (x = -8.0 m) ponad lustrem fosy!
    for (let step = 0; step < 6; step++) {
      const lx = -1.1 - step * 1.15;
      const archRise = Math.sin(((step + 0.5) / 6) * Math.PI) * 1.9;
      // Łuk arkady
      pushBrick(lx, 6.4 + archRise, 8.2, 1.1, 0.95, 0.85);
      pushBrick(lx, 6.4 + archRise, 10.8, 1.1, 0.95, 0.85);
      // Kryty korytarz ganku do Gdaniska (y = 9.6 .. 12.6 m)
      pushBrick(lx, 9.8, 9.5, 1.12, 1.4, 3.1);
      pushBrick(lx, 11.3, 9.5, 1.12, 1.4, 3.1);
      pushTimber(lx, 12.9, 9.5, 0.24, 1.8, 0.28);
    }
    // Drewniany wykusz ustępowy na szczycie Gdaniska zawieszony wprost nad wodą fosy!
    for (let c = 0; c < 4; c++) {
      const lz = 7.8 + c * 1.15;
      pushTimber(-9.05, 12.8, lz, 0.28, 2.1, 1.08);
      pushTimber(-8.65, 11.4, lz, 0.22, 1.35, 0.22);
      pushTimber(-8.3, 15.1, lz, 0.24, 2.4, 0.24);
    }

    return { bricks: brickList, timbers: timberList };
  }, []);

  // Referencje do InstancedMesh cegieł, belek hurdycji i chmury odłamków/pyłu/iskier
  const brickMeshRef = useRef<THREE.InstancedMesh>(null);
  const timberMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);
  const targetRingRef = useRef<THREE.Group>(null);
  const cauldronFlyRef = useRef<THREE.Group>(null);
  const campTentTiltRef = useRef<THREE.Group>(null);
  const steamGroupRef = useRef<THREE.Group>(null);
  const bannerFlagRef = useRef<THREE.Mesh>(null);
  const campFlagRef = useRef<THREE.Mesh>(null);

  const PARTICLE_COUNT = 96;

  // Inicjalizacja kolorów instancji cegieł i belek
  useEffect(() => {
    const bMesh = brickMeshRef.current;
    if (bMesh) {
      const col = new THREE.Color();
      for (let i = 0; i < bricks.length; i++) {
        col.setRGB(bricks[i].r, bricks[i].g, bricks[i].b);
        bMesh.setColorAt(i, col);
      }
      if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
    }

    const tMesh = timberMeshRef.current;
    if (tMesh) {
      const col = new THREE.Color();
      for (let i = 0; i < timbers.length; i++) {
        col.setRGB(timbers[i].r, timbers[i].g, timbers[i].b);
        tMesh.setColorAt(i, col);
      }
      if (tMesh.instanceColor) tMesh.instanceColor.needsUpdate = true;
    }
  }, [bricks, timbers]);

  // Pre-kalkulacja które cegły i belki zostają wyrwane dla bieżącego wyniku strzału
  const impactPlan = useMemo(() => {
    if (!activeResult) {
      return { brickHits: new Map<number, number>(), timberHits: new Map<number, number>() };
    }
    const isCastleHit =
      activeResult.outcome === "direct_target" ||
      activeResult.outcome === "gdanisko_hit" ||
      activeResult.outcome === "wall_hit";

    if (!isCastleHit) {
      return { brickHits: new Map<number, number>(), timberHits: new Map<number, number>() };
    }

    const ix = activeResult.impactDistanceM;
    const iy = activeResult.impactHeightM;
    const iz = 0;
    const desiredTotal = Math.max(24, Math.min(110, activeResult.bricksDislodged * 2 + 22));
    const blastRadius = config.projectileId === "glaz_145" ? 5.6 : 4.6;

    const scoredBricks: Array<{ idx: number; dist: number }> = [];
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      const wx = castleLayout.groupX + b.lx;
      const wy = b.ly;
      const wz = castleLayout.groupZ + b.lz;
      const d = Math.hypot((wx - ix) * 0.75, wy - iy, (wz - iz) * 0.9);
      if (d <= blastRadius) {
        scoredBricks.push({ idx: i, dist: d });
      }
    }
    scoredBricks.sort((a, b) => a.dist - b.dist);

    const brickHits = new Map<number, number>();
    const maxB = Math.min(scoredBricks.length, desiredTotal);
    for (let i = 0; i < maxB; i++) {
      brickHits.set(scoredBricks[i].idx, 1 - scoredBricks[i].dist / (blastRadius + 0.5));
    }

    const timberHits = new Map<number, number>();
    for (let i = 0; i < timbers.length; i++) {
      const tb = timbers[i];
      const wx = castleLayout.groupX + tb.lx;
      const wy = tb.ly;
      const wz = castleLayout.groupZ + tb.lz;
      const d = Math.hypot((wx - ix) * 0.75, wy - iy, (wz - iz) * 0.9);
      if (d <= blastRadius * 1.08) {
        timberHits.set(i, 1 - d / (blastRadius * 1.15));
      }
    }

    return { brickHits, timberHits };
  }, [activeResult, bricks, timbers, castleLayout.groupX, castleLayout.groupZ, config.projectileId]);

  // Aktualizacja rozprysku cegieł, belek, chmury pyłu wapiennego i komediowego trafienia w kocioł z grochówką!
  useFrame((state) => {
    const tClock = state.clock.elapsedTime;

    // Powiewanie chorągwi i pulsowanie mosiężnego celownika strefy misji
    if (targetRingRef.current) {
      const pulse = 1 + Math.sin(tClock * 3.2) * 0.06;
      targetRingRef.current.scale.setScalar(pulse);
    }
    if (bannerFlagRef.current) {
      bannerFlagRef.current.rotation.y = Math.sin(tClock * 3.8 + mission.windSpeedMs * 0.3) * 0.22;
    }
    if (campFlagRef.current) {
      campFlagRef.current.rotation.y = Math.sin(tClock * 3.4) * 0.25;
    }

    // Para znad kotła z grochówką w obozie
    if (steamGroupRef.current) {
      steamGroupRef.current.children.forEach((child, idx) => {
        const cycle = (tClock * 0.55 + idx * 0.33) % 1;
        child.position.y = 1.15 + cycle * 2.1;
        child.position.x = Math.sin(tClock * 1.8 + idx) * 0.22 + cycle * config.windSpeedMs * 0.06;
        const s = 0.35 + cycle * 0.75;
        child.scale.setScalar(s);
      });
    }

    const hasImpacted =
      Boolean(activeResult) &&
      (isFiring || playbackTimeS > 0) &&
      playbackTimeS >= (activeResult?.impactTimeS ?? Infinity);
    const dtImpact =
      hasImpacted && activeResult ? Math.max(0, playbackTimeS - activeResult.impactTimeS) : 0;

    // Aktualizacja macierzy cegieł
    const bMesh = brickMeshRef.current;
    if (bMesh) {
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const euler = new THREE.Euler();
      const scl = new THREE.Vector3();

      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        const power = dtImpact > 0 ? impactPlan.brickHits.get(i) : undefined;
        let wx = castleLayout.groupX + b.lx;
        let wy = b.ly;
        let wz = castleLayout.groupZ + b.lz;

        if (power !== undefined && dtImpact > 0) {
          const r1 = pseudoRand(b.seed + 1);
          const r2 = pseudoRand(b.seed + 2);
          const r3 = pseudoRand(b.seed + 3);
          const speed = (6.5 + power * 13.5) * (0.65 + r1 * 0.7);
          const vx = -speed * (0.55 + r2 * 0.65);
          const vy0 = (3.5 + power * 8.5) * (0.4 + r3 * 0.85);
          const vz = (r1 - 0.5) * speed * 1.35;

          const tSim = Math.min(dtImpact, 4.5);
          wx += vx * tSim;
          wz += vz * tSim;
          wy = b.ly + vy0 * tSim - 0.5 * 9.81 * tSim * tSim;

          const groundY = getTerrainHeightAtX(wx, castleLayout.groupX) + 0.35;
          if (wy < groundY) {
            const over = groundY - wy;
            wy = groundY + Math.min(1.6, over * 0.28) * Math.exp(-tSim * 0.9);
          }

          euler.set(tSim * (r1 - 0.5) * 9, b.ry + tSim * (r2 - 0.5) * 8, tSim * (r3 - 0.5) * 10);
        } else {
          euler.set(0, b.ry, 0);
        }

        pos.set(wx, wy, wz);
        quat.setFromEuler(euler);
        scl.set(b.sx, b.sy, b.sz);
        m.compose(pos, quat, scl);
        bMesh.setMatrixAt(i, m);
      }
      bMesh.instanceMatrix.needsUpdate = true;
    }

    // Aktualizacja macierzy belek hurdycji i wykusza Gdaniska
    const tMesh = timberMeshRef.current;
    if (tMesh) {
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const euler = new THREE.Euler();
      const scl = new THREE.Vector3();

      for (let i = 0; i < timbers.length; i++) {
        const tb = timbers[i];
        const power = dtImpact > 0 ? impactPlan.timberHits.get(i) : undefined;
        let wx = castleLayout.groupX + tb.lx;
        let wy = tb.ly;
        let wz = castleLayout.groupZ + tb.lz;

        if (power !== undefined && dtImpact > 0) {
          const r1 = pseudoRand(tb.seed + 5);
          const r2 = pseudoRand(tb.seed + 7);
          const r3 = pseudoRand(tb.seed + 11);
          const speed = (7.5 + power * 14.0) * (0.6 + r2 * 0.75);
          const vx = -speed * (0.5 + r1 * 0.6);
          const vy0 = (4.2 + power * 9.2) * (0.45 + r3 * 0.75);
          const vz = (r2 - 0.5) * speed * 1.45;

          const tSim = Math.min(dtImpact, 4.5);
          wx += vx * tSim;
          wz += vz * tSim;
          wy = tb.ly + vy0 * tSim - 0.5 * 9.81 * tSim * tSim;

          const groundY = getTerrainHeightAtX(wx, castleLayout.groupX) + 0.25;
          if (wy < groundY) {
            wy = groundY + Math.min(1.2, (groundY - wy) * 0.24) * Math.exp(-tSim);
          }
          euler.set(tSim * (r3 - 0.5) * 11, tb.ry + tSim * 5, tSim * (r1 - 0.5) * 9);
        } else {
          euler.set(0, tb.ry, 0);
        }

        pos.set(wx, wy, wz);
        quat.setFromEuler(euler);
        scl.set(tb.sx, tb.sy, tb.sz);
        m.compose(pos, quat, scl);
        tMesh.setMatrixAt(i, m);
      }
      tMesh.instanceMatrix.needsUpdate = true;
    }

    // Chmura pyłu wapiennego / iskier smolnych / rozbryzgu wody lub grochówki!
    const pMesh = particleMeshRef.current;
    if (pMesh) {
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      const col = new THREE.Color();

      if (!hasImpacted || !activeResult || dtImpact <= 0 || dtImpact > 5.0) {
        m.makeScale(0.0001, 0.0001, 0.0001);
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pMesh.setMatrixAt(i, m);
        }
        pMesh.instanceMatrix.needsUpdate = true;
      } else {
        const ix = activeResult.impactDistanceM;
        const iy = Math.max(0.2, activeResult.impactHeightM);
        const isBackfire = activeResult.outcome === "camp_backfire";
        const isMoat = activeResult.outcome === "short_moat";
        const isPitch = config.projectileId === "smola_85";

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const r1 = pseudoRand(i * 3.1 + 1);
          const r2 = pseudoRand(i * 5.7 + 2);
          const r3 = pseudoRand(i * 8.3 + 3);
          const isSpark = (isPitch || isBackfire) && i % 3 === 0;

          const angleAz = r1 * Math.PI * 2;
          const radial = (isSpark ? 9.5 : 5.8) * (0.25 + r2 * 0.95);
          const vx = Math.cos(angleAz) * radial - (isBackfire ? 0 : 2.2);
          const vz = Math.sin(angleAz) * radial;
          const vy0 = (isSpark ? 11.5 : isMoat ? 9.5 : 6.2) * (0.35 + r3);

          const drag = isSpark ? 1 : Math.exp(-dtImpact * 0.55);
          const px = ix + vx * dtImpact * drag;
          const pz = vz * dtImpact * drag;
          const py = Math.max(
            0.15,
            iy + vy0 * dtImpact - 0.5 * (isSpark || isMoat ? 9.81 : 3.2) * dtImpact * dtImpact
          );

          const fade = Math.max(0.001, 1 - dtImpact / (isSpark ? 2.6 : 4.2));
          const sizeP = isSpark
            ? (0.22 + r1 * 0.25) * fade
            : (0.65 + dtImpact * 1.45 * (0.5 + r2 * 0.6)) * fade;

          pos.set(px, py, pz);
          quat.setFromEuler(new THREE.Euler(dtImpact * r1 * 4, dtImpact * r2 * 4, 0));
          scl.setScalar(sizeP);
          m.compose(pos, quat, scl);
          pMesh.setMatrixAt(i, m);

          if (isSpark) {
            col.setRGB(1.0, 0.45 + r3 * 0.45, 0.08);
          } else if (isBackfire && i % 2 === 0) {
            // Para i krople grochówki!
            col.setRGB(0.88, 0.9, 0.78);
          } else if (isMoat) {
            col.setRGB(0.68, 0.84, 0.92);
          } else {
            // Jasny pył wapienny i ceglany
            col.setRGB(0.84 - r1 * 0.14, 0.77 - r1 * 0.18, 0.68 - r1 * 0.18);
          }
          pMesh.setColorAt(i, col);
        }
        pMesh.instanceMatrix.needsUpdate = true;
        if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
      }
    }

    // Komediowa fizyka żeliwnego kotła i namiotu przy trafieniu wstecznym (camp_backfire)!
    const isCampHit =
      hasImpacted && activeResult?.outcome === "camp_backfire" && dtImpact > 0;
    if (cauldronFlyRef.current) {
      if (isCampHit) {
        const tC = Math.min(dtImpact, 3.8);
        const flyY = Math.max(0, 11.5 * tC - 0.5 * 9.81 * tC * tC);
        cauldronFlyRef.current.position.set(-tC * 2.6, 0.68 + flyY, tC * 0.8);
        cauldronFlyRef.current.rotation.set(tC * 6.5, tC * 3.2, tC * 8.4);
      } else {
        cauldronFlyRef.current.position.set(0, 0.68, 0);
        cauldronFlyRef.current.rotation.set(0, 0, 0);
      }
    }
    if (campTentTiltRef.current) {
      campTentTiltRef.current.rotation.z = isCampHit
        ? Math.min(0.42, dtImpact * 1.4)
        : 0;
    }
  });

  // Pozycja obozu i kotła z grochówką (gdy gracz strzela wstecz, kocioł ustawia się idealnie w punkcie uderzenia!)
  const cauldronWorldX =
    activeResult?.outcome === "camp_backfire"
      ? THREE.MathUtils.clamp(activeResult.impactDistanceM, -42, -13)
      : -24.5;

  const moatCenterX = castleLayout.groupX - 11.5;

  // Zespolone geometrie statyczne zamku i obozu (utrzymują całą scenę poniżej 26 draw calli!)
  const castleStaticGeos = useMemo(() => {
    const mk = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
      new THREE.Matrix4()
        .makeTranslation(x, y, z)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));

    const graniteParts = [
      { geometry: new THREE.BoxGeometry(5.4, 3.9, 44), matrix: mk(2.2, 1.85, -1.5) },
      { geometry: new THREE.BoxGeometry(3.4, 4.2, 5.2), matrix: mk(-8.0, -0.35, 9.5) },
    ];
    const graniteGeo = mergeStaticGeometries(graniteParts);
    graniteParts.forEach((p) => p.geometry.dispose());

    const emplectumParts = [
      { geometry: new THREE.BoxGeometry(2.9, 10.2, 15.6), matrix: mk(1.95, 8.8, 0) },
      { geometry: new THREE.BoxGeometry(4.4, 18.5, 6.8), matrix: mk(1.8, 11.5, -10.5) },
      { geometry: new THREE.BoxGeometry(2.2, 13.2, 4.2), matrix: mk(-7.65, 7.8, 9.5) },
    ];
    const emplectumGeo = mergeStaticGeometries(emplectumParts);
    emplectumParts.forEach((p) => p.geometry.dispose());

    const brickParts = [
      { geometry: new THREE.BoxGeometry(3.6, 10.2, 9.5), matrix: mk(2.2, 8.6, -18.5) },
      { geometry: new THREE.BoxGeometry(3.6, 10.2, 11.5), matrix: mk(2.2, 8.6, 15.8) },
      { geometry: new THREE.CylinderGeometry(2.7, 3.0, 19, 8), matrix: mk(1.8, 9.5, -22.5) },
      { geometry: new THREE.CylinderGeometry(2.7, 3.0, 19, 8), matrix: mk(1.8, 9.5, 21.0) },
    ];
    const brickWingsGeo = mergeStaticGeometries(brickParts);
    brickParts.forEach((p) => p.geometry.dispose());

    const accentParts: Array<{
      geometry: THREE.BufferGeometry;
      matrix: THREE.Matrix4;
      color: string;
    }> = [
      { geometry: new THREE.ConeGeometry(3.2, 5.6, 8), matrix: mk(1.8, 21.6, -22.5), color: "#6e281a" },
      { geometry: new THREE.ConeGeometry(3.2, 5.6, 8), matrix: mk(1.8, 21.6, 21.0), color: "#6e281a" },
      {
        geometry: new THREE.ConeGeometry(5.1, 6.4, 4),
        matrix: mk(1.4, 23.6, -10.5, 0, Math.PI * 0.25, 0),
        color: "#7c2b1b",
      },
      {
        geometry: new THREE.ConeGeometry(3.55, 4.5, 4),
        matrix: mk(-8.0, 16.6, 9.5, 0, Math.PI * 0.25, 0),
        color: "#752819",
      },
      { geometry: new THREE.BoxGeometry(7.4, 1.35, 3.25), matrix: mk(-3.8, 13.1, 9.5), color: "#6b2517" },
      { geometry: new THREE.BoxGeometry(1.1, 5.8, 2.6), matrix: mk(-0.45, 4.4, -10.5), color: "#120d0a" },
      { geometry: new THREE.BoxGeometry(0.12, 4.6, 0.92), matrix: mk(-0.72, 14.6, -12.6), color: "#e7e0d2" },
      { geometry: new THREE.BoxGeometry(0.12, 4.6, 0.92), matrix: mk(-0.72, 14.6, -10.5), color: "#e7e0d2" },
      { geometry: new THREE.BoxGeometry(0.12, 4.6, 0.92), matrix: mk(-0.72, 14.6, -8.4), color: "#e7e0d2" },
    ];
    const roofsAndNichesGeo = mergeStaticGeometries(accentParts, true);
    accentParts.forEach((p) => p.geometry.dispose());

    return { graniteGeo, emplectumGeo, brickWingsGeo, roofsAndNichesGeo };
  }, []);

  const campStaticGeos = useMemo(() => {
    const mk = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
      new THREE.Matrix4()
        .makeTranslation(x, y, z)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));

    const canvasParts = [
      { geometry: new THREE.CylinderGeometry(2.2, 2.4, 2.8, 8), matrix: mk(-33.5, 1.4, 4.2) },
      { geometry: new THREE.ConeGeometry(2.35, 2.35, 4), matrix: mk(-21.2, 1.15, 4.6, 0, Math.PI * 0.25, 0) },
    ];
    const campCanvasGeo = mergeStaticGeometries(canvasParts);
    canvasParts.forEach((p) => p.geometry.dispose());

    const colorParts = [
      { geometry: new THREE.ConeGeometry(2.45, 2.0, 8), matrix: mk(-33.5, 3.75, 4.2), color: "#b45309" },
      ...[-3.2, -1.6, 1.6, 3.2].map((pz, idx) => ({
        geometry: new THREE.BoxGeometry(0.12, 1.55, 0.78),
        matrix: mk(-18.2, 0.78, pz, 0, 0, -0.24),
        color: idx % 2 === 0 ? "#991b1b" : "#b45309",
      })),
    ];
    const campAccentsGeo = mergeStaticGeometries(colorParts, true);
    colorParts.forEach((p) => p.geometry.dispose());

    const boulderParts = [-0.6, 0, 0.65].map((ox) => ({
      geometry: new THREE.DodecahedronGeometry(0.32, 1),
      matrix: mk(-19.1 + ox, 0.32, 3.4),
    }));
    const campBouldersGeo = mergeStaticGeometries(boulderParts);
    boulderParts.forEach((p) => p.geometry.dispose());

    const logParts = [0, 1.05, 2.1].map((rot) => ({
      geometry: new THREE.CylinderGeometry(0.11, 0.11, 1.55, 6),
      matrix: mk(0, 0.14, 0, Math.PI * 0.5, 0, rot),
    }));
    const fireLogsGeo = mergeStaticGeometries(logParts);
    logParts.forEach((p) => p.geometry.dispose());

    const tripodParts = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((ang) => ({
      geometry: new THREE.CylinderGeometry(0.045, 0.055, 2.55, 6),
      matrix: mk(
        Math.cos(ang) * 0.62,
        1.15,
        Math.sin(ang) * 0.62,
        Math.sin(ang) * 0.42,
        0,
        -Math.cos(ang) * 0.42
      ),
    }));
    const tripodGeo = mergeStaticGeometries(tripodParts);
    tripodParts.forEach((p) => p.geometry.dispose());

    const cauldronParts = [
      { geometry: new THREE.CylinderGeometry(0.68, 0.48, 0.86, 14), matrix: mk(0, 0, 0) },
      { geometry: new THREE.TorusGeometry(0.68, 0.06, 8, 18), matrix: mk(0, 0.42, 0, Math.PI * 0.5, 0, 0) },
    ];
    const cauldronIronGeo = mergeStaticGeometries(cauldronParts);
    cauldronParts.forEach((p) => p.geometry.dispose());

    const bannerCrossParts = [
      { geometry: new THREE.BoxGeometry(0.05, 1.25, 1.9), matrix: mk(0, 0, 0.95), color: "#f5f2eb" },
      { geometry: new THREE.BoxGeometry(0.07, 0.95, 0.24), matrix: mk(0, 0, 0.85), color: "#18181b" },
      { geometry: new THREE.BoxGeometry(0.07, 0.24, 0.95), matrix: mk(0, 0, 0.85), color: "#18181b" },
    ];
    const teutonicBannerGeo = mergeStaticGeometries(bannerCrossParts, true);
    bannerCrossParts.forEach((p) => p.geometry.dispose());

    return {
      campCanvasGeo,
      campAccentsGeo,
      campBouldersGeo,
      fireLogsGeo,
      tripodGeo,
      cauldronIronGeo,
      teutonicBannerGeo,
    };
  }, []);

  return (
    <group name="fortress-and-camp-environment">
      {/* === 1. RZEŹBA TERENU I FOSA Z WODĄ === */}
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.94} metalness={0.02} />
      </mesh>

      {/* Tafla ciemnej wody w fosie przed zamkiem krzyżackim */}
      <mesh
        position={[moatCenterX, -0.82, 0]}
        rotation={[-Math.PI * 0.5, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[12.5, 136]} />
        <meshStandardMaterial
          color="#17303a"
          roughness={0.14}
          metalness={0.62}
        />
      </mesh>

      {/* === 2. MONUMENTALNY ZAMEK KRZYŻACKI Z CZERWONEJ CEGŁY (+X) === */}
      <group position={[castleLayout.groupX, 0, castleLayout.groupZ]}>
        {/* Zespolona podmurówka granitowa i filar Gdaniska w fosie (1 draw call!) */}
        <mesh
          geometry={castleStaticGeos.graniteGeo}
          material={mats.fieldGranite}
          castShadow
          receiveShadow
        />

        {/* Zespolony rdzeń murów w technice OPUS EMPLECTUM (1 draw call!) */}
        <mesh
          geometry={castleStaticGeos.emplectumGeo}
          material={mats.opusEmplectum}
          castShadow
          receiveShadow
        />

        {/* Zespolone skrzydła boczne i baszty narożne z czerwonej cegły (1 draw call!) */}
        <mesh
          geometry={castleStaticGeos.brickWingsGeo}
          material={mats.gothicBrick}
          castShadow
          receiveShadow
        />

        {/* Zespolone dachy ceramiczne, ostrołukowe białe blendy i brama (1 draw call!) */}
        <mesh geometry={castleStaticGeos.roofsAndNichesGeo} castShadow>
          <meshStandardMaterial vertexColors roughness={0.82} />
        </mesh>

        {/* Kuta brona w przejeździe bramnym + dach gontowy nad hurdycjami */}
        <mesh position={[-0.85, 5.6, -10.5]} material={mats.forgedIron}>
          <boxGeometry args={[0.14, 3.4, 2.4]} />
        </mesh>
        <mesh position={[-0.25, 15.15, 0]} rotation={[0, 0, 0.35]} material={mats.tarredOak} castShadow>
          <boxGeometry args={[2.4, 0.35, 15.2]} />
        </mesh>

        {/* Pochodnie strażnicze na murach zamku */}
        <pointLight position={[-2.2, 13.5, -4.5]} color="#ff7b24" intensity={6} distance={26} decay={2} />
        <pointLight position={[-9.2, 12.2, 9.5]} color="#ff7b24" intensity={5} distance={22} decay={2} />
      </group>

      {/* InstancedMesh niszczalnych cegieł zamkowych (~390 szt. — 1 draw call!) */}
      <instancedMesh
        ref={brickMeshRef}
        args={[unitBoxGeo, mats.gothicBrick, bricks.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* InstancedMesh niszczalnych dębowych belek hurdycji i wykusza Gdaniska (~96 szt. — 1 draw call!) */}
      <instancedMesh
        ref={timberMeshRef}
        args={[timberGeo, mats.tarredOak, timbers.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* InstancedMesh chmury pyłu wapiennego / iskier smolnych / rozbryzgu grochówki (1 draw call!) */}
      <instancedMesh
        ref={particleMeshRef}
        args={[dustSphereGeo, undefined, PARTICLE_COUNT]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffffff" transparent opacity={0.86} />
      </instancedMesh>

      {/* === 3. MOSIĘŻNY PIERŚCIEŃ CELOWNICZY I CHORĄGIEW AKTYWNEJ STREFY MISJI === */}
      <group
        position={[mission.castleDistanceM - 0.65, mission.targetCenterYM, 0]}
      >
        <group ref={targetRingRef} rotation={[0, Math.PI * 0.5, 0]}>
          <mesh>
            <torusGeometry args={[Math.max(2.1, mission.targetRadiusM * 0.55), 0.14, 10, 32]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.82} />
          </mesh>
        </group>

        <group position={[0.4, Math.max(2.8, mission.targetRadiusM * 0.65), 0]}>
          <mesh position={[0, 1.8, 0]} material={mats.agedOak}>
            <cylinderGeometry args={[0.06, 0.08, 3.6, 6]} />
          </mesh>
          <mesh
            ref={bannerFlagRef}
            position={[0, 3.0, 0]}
            geometry={campStaticGeos.teutonicBannerGeo}
          >
            <meshStandardMaterial vertexColors roughness={0.85} />
          </mesh>
        </group>
      </group>

      {/* === 4. POLSKO-LITEWSKI OBÓZ OBLĘŻNICZY ZA PLECAMI TREBUSZA (x = -18..-38 m) === */}
      <group name="polish-lithuanian-siege-camp">
        {/* Zespolone namioty boczne, dachy, pawęże i zapasowe głazy (3 draw calle zamiast 14!) */}
        <mesh
          geometry={campStaticGeos.campCanvasGeo}
          material={mats.tentCanvas}
          castShadow
          receiveShadow
        />
        <mesh geometry={campStaticGeos.campAccentsGeo} castShadow>
          <meshStandardMaterial vertexColors roughness={0.82} />
        </mesh>
        <mesh
          geometry={campStaticGeos.campBouldersGeo}
          material={mats.fieldGranite}
          castShadow
        />

        {/* Namiot rycerski #1 (blisko kotła — przechyla się komediowo po samobóju!) */}
        <group ref={campTentTiltRef} position={[cauldronWorldX - 3.6, 0, -3.4]}>
          <mesh position={[0, 1.55, 0]} material={mats.tentCanvas} castShadow receiveShadow>
            <cylinderGeometry args={[2.55, 2.75, 3.1, 10]} />
          </mesh>
          <mesh position={[0, 4.15, 0]} castShadow>
            <coneGeometry args={[2.75, 2.25, 10]} />
            <meshStandardMaterial color="#991b1b" roughness={0.82} />
          </mesh>
          <mesh ref={campFlagRef} position={[0.75, 5.65, 0]}>
            <boxGeometry args={[1.5, 0.55, 0.04]} />
            <meshStandardMaterial color="#dc2626" emissive="#450a0a" emissiveIntensity={0.25} />
          </mesh>
        </group>

        {/* OGNISKO OBOZOWE I WIELKI ŻELIWNY KOCIOŁ Z GROCHÓWKĄ (cel komediowych strzałów wstecznych 0°–7°!) */}
        <group position={[cauldronWorldX, 0, 0]}>
          <mesh geometry={campStaticGeos.fireLogsGeo} material={mats.tarredOak} />
          <mesh position={[0, 0.26, 0]}>
            <dodecahedronGeometry args={[0.42, 0]} />
            <meshBasicMaterial color="#ff6b00" />
          </mesh>
          <pointLight
            position={[0, 1.1, 0]}
            color="#ff7a18"
            intensity={9}
            distance={22}
            decay={2}
          />

          <mesh geometry={campStaticGeos.tripodGeo} material={mats.forgedIron} castShadow />

          {/* Wielki żeliwny kocioł z grochówką (wylatuje w powietrze przy camp_backfire!) */}
          <group ref={cauldronFlyRef} position={[0, 0.68, 0]}>
            <mesh geometry={campStaticGeos.cauldronIronGeo} material={mats.forgedIron} castShadow />
            <mesh position={[0, 0.36, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
              <circleGeometry args={[0.62, 14]} />
              <meshStandardMaterial
                color="#9ca644"
                roughness={0.35}
                emissive="#4a5319"
                emissiveIntensity={0.35}
              />
            </mesh>
          </group>

          {/* Unoszące się kłęby pary znad grochówki */}
          <group ref={steamGroupRef}>
            {[0, 1].map((idx) => (
              <mesh key={idx} position={[0, 1.3 + idx * 0.6, 0]}>
                <dodecahedronGeometry args={[0.28, 0]} />
                <meshBasicMaterial
                  color="#f1f5f9"
                  transparent
                  opacity={0.22}
                  depthWrite={false}
                />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
