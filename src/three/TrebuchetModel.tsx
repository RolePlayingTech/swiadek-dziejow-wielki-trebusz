"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type {
  ProjectileTypeId,
  ShotSimulationResult,
  SimKeyframe,
  TrebuchetConfig,
} from "@/types/trebuchet";
import {
  createChamferedTimberGeometry,
  createTaperedMainBeamGeometry,
  getProceduralMaterials,
  mergeStaticGeometries,
} from "./proceduralMaterials";

export const AXLE_HEIGHT_M = 11.4;
export const TOTAL_BEAM_LENGTH_M = 15.9;
const DEFAULT_LONG_ARM_M = 12.75;
const DEFAULT_SHORT_ARM_M = TOTAL_BEAM_LENGTH_M - DEFAULT_LONG_ARM_M; // 3.15 m

export interface SampledTrebuchetPose {
  t: number;
  longArmM: number;
  shortArmM: number;
  thetaLongRad: number;
  angularVelRadS: number;
  tipX: number;
  tipY: number;
  shortTipX: number;
  shortTipY: number;
  worldBoxX: number;
  worldBoxY: number;
  boxTiltRad: number;
  projX: number;
  projY: number;
  projVx: number;
  projVy: number;
  attachedToSling: boolean;
  ringSlideProgress: number;
}

function getProjectileVisualRadius(id: ProjectileTypeId): number {
  switch (id) {
    case "granit_65":
      return 0.28;
    case "granit_100":
      return 0.34;
    case "glaz_145":
      return 0.41;
    case "smola_85":
      return 0.36;
  }
}

function unwrapAngle(prev: number, next: number): number {
  let diff = next - prev;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return prev + diff;
}

/**
 * Interpoluje stan kinematyczny trebusza i pocisku dla dowolnej chwili `playbackTimeS`,
 * zachowując pełną spójność z `SimKeyframe` z silnika fizycznego oraz zapewniając
 * analityczną pozę spoczynkową, gdy `activeResult === null`.
 */
export function sampleTrebuchetPose(
  activeResult: ShotSimulationResult | null,
  playbackTimeS: number,
  config: TrebuchetConfig,
  isFiring: boolean
): SampledTrebuchetPose {
  const projRadius = getProjectileVisualRadius(config.projectileId);

  if (!activeResult || activeResult.frames.length === 0) {
    const longArmM = DEFAULT_LONG_ARM_M;
    const shortArmM = DEFAULT_SHORT_ARM_M;
    const tipY = 1.75;
    const dy = tipY - AXLE_HEIGHT_M;
    const tipX = -Math.sqrt(Math.max(1, longArmM * longArmM - dy * dy));
    const thetaLongRad = Math.atan2(dy, tipX);
    const shortTipX = -shortArmM * Math.cos(thetaLongRad);
    const shortTipY = AXLE_HEIGHT_M - shortArmM * Math.sin(thetaLongRad);

    const hangerLen = 2.65;
    const worldBoxX = config.hingedCounterweight
      ? shortTipX
      : shortTipX + Math.sin(thetaLongRad) * hangerLen;
    const worldBoxY = config.hingedCounterweight
      ? shortTipY - hangerLen
      : shortTipY - Math.cos(thetaLongRad) * hangerLen;
    const boxTiltRad = config.hingedCounterweight ? 0 : thetaLongRad + Math.PI * 0.5;

    const projY = projRadius + 0.08;
    const horizSling = Math.sqrt(
      Math.max(0.5, config.slingLengthM * config.slingLengthM - (tipY - projY) * (tipY - projY))
    );
    const projX = tipX + horizSling;

    return {
      t: 0,
      longArmM,
      shortArmM,
      thetaLongRad,
      angularVelRadS: 0,
      tipX,
      tipY,
      shortTipX,
      shortTipY,
      worldBoxX,
      worldBoxY,
      boxTiltRad,
      projX,
      projY,
      projVx: 0,
      projVy: 0,
      attachedToSling: true,
      ringSlideProgress: 0,
    };
  }

  const frames = activeResult.frames;
  const f0 = frames[0];
  const rawLongArm = Math.hypot(f0.tipX, f0.tipY - AXLE_HEIGHT_M);
  const longArmM =
    Number.isFinite(rawLongArm) && rawLongArm > 8 && rawLongArm < 14.5
      ? rawLongArm
      : DEFAULT_LONG_ARM_M;
  const shortArmM = Math.max(2.1, TOTAL_BEAM_LENGTH_M - longArmM);

  // Detekcja czy boxY jest względem osi (0, axleHeightM) zgodnie z typem, czy w układzie świata
  let minRawBoxY = Infinity;
  for (let i = 0; i < frames.length; i += Math.max(1, Math.floor(frames.length / 16))) {
    if (frames[i].boxY < minRawBoxY) minRawBoxY = frames[i].boxY;
  }
  const boxYOffset = minRawBoxY < 2.2 ? AXLE_HEIGHT_M : 0;

  const targetT = !isFiring && playbackTimeS <= 0 ? 0 : Math.max(0, playbackTimeS);

  let lo = 0;
  let hi = frames.length - 1;
  if (targetT >= frames[hi].t) {
    lo = hi;
  } else {
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= targetT) lo = mid;
      else hi = mid;
    }
  }

  const a: SimKeyframe = frames[lo];
  const b: SimKeyframe = frames[hi];
  const span = b.t - a.t;
  const alpha = span > 1e-6 ? Math.min(1, Math.max(0, (targetT - a.t) / span)) : 0;

  const thetaA = Math.atan2(a.tipY - AXLE_HEIGHT_M, a.tipX);
  const thetaBRaw = Math.atan2(b.tipY - AXLE_HEIGHT_M, b.tipX);
  const thetaB = unwrapAngle(thetaA, thetaBRaw);
  const thetaLongRad = thetaA + (thetaB - thetaA) * alpha;
  const angularVelRadS = span > 1e-5 ? (thetaB - thetaA) / span : 0;

  const tipX = longArmM * Math.cos(thetaLongRad);
  const tipY = AXLE_HEIGHT_M + longArmM * Math.sin(thetaLongRad);
  const shortTipX = -shortArmM * Math.cos(thetaLongRad);
  const shortTipY = AXLE_HEIGHT_M - shortArmM * Math.sin(thetaLongRad);

  const worldBoxX = a.boxX + (b.boxX - a.boxX) * alpha;
  const worldBoxY = a.boxY + (b.boxY - a.boxY) * alpha + boxYOffset;

  // Kąt nachylenia zawiesia skrzyni wynika jednoznacznie z wektora od czopa krótkiego ramienia do środka skrzyni
  const hangerDx = worldBoxX - shortTipX;
  const hangerDy = worldBoxY - shortTipY;
  const boxTiltRad = config.hingedCounterweight
    ? Math.atan2(hangerDx, -hangerDy)
    : thetaLongRad + Math.PI * 0.5;

  const projX = a.projX + (b.projX - a.projX) * alpha;
  const projY = Math.max(projRadius * 0.65, a.projY + (b.projY - a.projY) * alpha);
  const projVx = a.projVx + (b.projVx - a.projVx) * alpha;
  const projVy = a.projVy + (b.projVy - a.projVy) * alpha;
  const attachedToSling = alpha < 0.5 ? a.attachedToSling : b.attachedToSling;

  // Postęp zsuwania się pierścienia po palcu spustowym tuż przed wypięciem
  const relT = Math.max(0.05, activeResult.releaseTimeS);
  const ringSlideProgress = attachedToSling
    ? Math.pow(Math.min(1, Math.max(0, (targetT - relT * 0.55) / (relT * 0.45))), 2.2)
    : 1;

  return {
    t: targetT,
    longArmM,
    shortArmM,
    thetaLongRad,
    angularVelRadS,
    tipX,
    tipY,
    shortTipX,
    shortTipY,
    worldBoxX,
    worldBoxY,
    boxTiltRad,
    projX,
    projY,
    projVx,
    projVy,
    attachedToSling,
    ringSlideProgress,
  };
}

interface StrutSpec {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  wx: number;
  wz: number;
}

interface IronPartSpec {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface TrebuchetModelProps {
  config: TrebuchetConfig;
  activeResult: ShotSimulationResult | null;
  playbackTimeS: number;
  isFiring: boolean;
  showVectors: boolean;
  hasInteracted: boolean;
  isProngZoom: boolean;
  onChangeProngAngle: (angleDeg: number) => void;
  onChangeCounterweight: (massKg: number) => void;
  onPullTrigger: () => void;
  onFirstInteract?: () => void;
  onDragStateChange?: (dragging: boolean) => void;
}

const UP_VEC = new THREE.Vector3(0, 1, 0);

function buildStrutMatrix(spec: StrutSpec, out: THREE.Matrix4): void {
  const start = new THREE.Vector3(spec.ax, spec.ay, spec.az);
  const end = new THREE.Vector3(spec.bx, spec.by, spec.bz);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dir = end.clone().sub(start);
  const len = Math.max(0.001, dir.length());
  dir.divideScalar(len);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP_VEC, dir);
  const scale = new THREE.Vector3(spec.wx, len, spec.wz);
  out.compose(mid, quat, scale);
}

export function TrebuchetModel({
  config,
  activeResult,
  playbackTimeS,
  isFiring,
  showVectors,
  hasInteracted,
  isProngZoom,
  onChangeProngAngle,
  onChangeCounterweight,
  onPullTrigger,
  onFirstInteract,
  onDragStateChange,
}: TrebuchetModelProps) {
  const { camera, gl, size } = useThree();
  const mats = useMemo(() => getProceduralMaterials(), []);

  // Rozpoznajemy rzeczywiste długości ramion z pierwszej klatki fizyki
  const armDims = useMemo(() => {
    if (activeResult && activeResult.frames.length > 0) {
      const f0 = activeResult.frames[0];
      const rawLong = Math.hypot(f0.tipX, f0.tipY - AXLE_HEIGHT_M);
      if (Number.isFinite(rawLong) && rawLong > 8 && rawLong < 14.5) {
        return {
          longArmM: rawLong,
          shortArmM: Math.max(2.1, TOTAL_BEAM_LENGTH_M - rawLong),
        };
      }
    }
    return { longArmM: DEFAULT_LONG_ARM_M, shortArmM: DEFAULT_SHORT_ARM_M };
  }, [activeResult]);

  // Geometrie bazowe (keszowane w useMemo)
  const timberGeo = useMemo(() => createChamferedTimberGeometry(0.14), []);
  const mainBeamGeo = useMemo(
    () => createTaperedMainBeamGeometry(armDims.shortArmM, armDims.longArmM),
    [armDims.longArmM, armDims.shortArmM]
  );
  const ironBoxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const boulderGeo = useMemo(() => new THREE.DodecahedronGeometry(1, 1), []);

  // Specyfikacja wszystkich dębowych belek kozłów A-kształtnych (ZERO poprzeczki zderzakowej!)
  const { frameTimbers, frameIronParts } = useMemo(() => {
    const timbers: StrutSpec[] = [];
    const irons: IronPartSpec[] = [];
    const sideZs = [-1.42, 1.42];

    for (const z of sideZs) {
      // Główna płoza wzdłużna na ziemi
      timbers.push({ ax: -11.4, ay: 0.24, az: z, bx: 7.4, by: 0.24, bz: z, wx: 0.46, wz: 0.46 });
      // Pionowy słup królewski pod osią (y = 0.35 .. 11.55)
      timbers.push({ ax: 0, ay: 0.3, az: z, bx: 0, by: AXLE_HEIGHT_M + 0.15, bz: z, wx: 0.44, wz: 0.44 });
      // Przednia i tylna noga główna kozła A-kształtnego
      timbers.push({ ax: 5.8, ay: 0.3, az: z, bx: 0.18, by: AXLE_HEIGHT_M, bz: z, wx: 0.42, wz: 0.42 });
      timbers.push({ ax: -6.2, ay: 0.3, az: z, bx: -0.18, by: AXLE_HEIGHT_M, bz: z, wx: 0.42, wz: 0.42 });
      // Zastrzały pomocnicze w płaszczyźnie bocznej kozła
      timbers.push({ ax: 3.4, ay: 0.3, az: z, bx: 0, by: 7.1, bz: z, wx: 0.3, wz: 0.3 });
      timbers.push({ ax: -3.6, ay: 0.3, az: z, bx: 0, by: 7.1, bz: z, wx: 0.3, wz: 0.3 });
      // Poziomy rygiel boczny (wyłącznie w płaszczyźnie bocznej z = ±1.42 m!)
      timbers.push({ ax: -3.15, ay: 5.2, az: z, bx: 3.0, by: 5.2, bz: z, wx: 0.28, wz: 0.28 });
      // Zastrzał boczny przeciwprzechyłowy na zewnątrz (do z = ±3.05 m)
      const zOut = z > 0 ? 3.05 : -3.05;
      timbers.push({ ax: 0, ay: 7.6, az: z, bx: 0, by: 0.22, bz: zOut, wx: 0.32, wz: 0.32 });
      timbers.push({ ax: 0, ay: 0.2, az: z, bx: 0, by: 0.2, bz: zOut + (z > 0 ? 0.3 : -0.3), wx: 0.36, wz: 0.36 });
      // Słupki tylnego kołowrotu naciągowego (x = -10.8 m — poza promieniem obrotu belki!)
      timbers.push({ ax: -10.8, ay: 0.3, az: z, bx: -10.8, by: 2.05, bz: z, wx: 0.34, wz: 0.34 });
      timbers.push({ ax: -9.4, ay: 0.3, az: z, bx: -10.8, by: 1.85, bz: z, wx: 0.26, wz: 0.26 });

      // Kute okucia łożyska górnego na szczycie kozła (y = 11.4 m)
      irons.push({ px: 0, py: AXLE_HEIGHT_M + 0.16, pz: z, rx: 0, ry: 0, rz: 0, sx: 0.92, sy: 0.42, sz: 0.54 });
      // Dolne klamry ciesielskie przy stopach nóg
      irons.push({ px: 5.65, py: 0.45, pz: z, rx: 0, ry: 0, rz: 0.42, sx: 0.58, sy: 0.32, sz: 0.5 });
      irons.push({ px: -6.05, py: 0.45, pz: z, rx: 0, ry: 0, rz: -0.42, sx: 0.58, sy: 0.32, sz: 0.5 });
      irons.push({ px: 0, py: 5.2, pz: z, rx: 0, ry: 0, rz: 0, sx: 0.54, sy: 0.48, sz: 0.5 });

      // Rzędy kutych nitów na słupie i nogach
      for (let h = 1.4; h <= 10.6; h += 1.55) {
        const zRivet = z + (z > 0 ? 0.24 : -0.24);
        irons.push({ px: 0, py: h, pz: zRivet, rx: 0, ry: 0, rz: 0, sx: 0.09, sy: 0.09, sz: 0.09 });
        const legX = (1 - h / AXLE_HEIGHT_M) * 5.6;
        irons.push({ px: legX, py: h, pz: zRivet, rx: 0, ry: 0, rz: 0, sx: 0.08, sy: 0.08, sz: 0.08 });
        irons.push({ px: -legX * 1.05, py: h, pz: zRivet, rx: 0, ry: 0, rz: 0, sx: 0.08, sy: 0.08, sz: 0.08 });
      }
    }

    // Poprzeczne podwaliny wyłącznie na poziomie gruntu (y = 0.18 m — pełny prześwit w pionie!)
    for (const xSleeper of [-11.0, -8.2, -5.6, 5.4, 7.1]) {
      timbers.push({
        ax: xSleeper,
        ay: 0.18,
        az: -1.68,
        bx: xSleeper,
        by: 0.18,
        bz: 1.68,
        wx: 0.38,
        wz: 0.38,
      });
    }

    // Koryto ślizgowe procy na ziemi (z = 0, y = 0.07 m) + niskie burty boczne
    timbers.push({ ax: -10.4, ay: 0.06, az: 0, bx: 5.8, by: 0.06, bz: 0, wx: 0.1, wz: 0.92 });
    timbers.push({ ax: -10.4, ay: 0.15, az: -0.48, bx: 5.8, by: 0.15, bz: -0.48, wx: 0.2, wz: 0.14 });
    timbers.push({ ax: -10.4, ay: 0.15, az: 0.48, bx: 5.8, by: 0.15, bz: 0.48, wx: 0.2, wz: 0.14 });

    // Wał kołowrotu naciągowego z tyłu (x = -10.8 m, y = 1.45 m) + drągi pokrętne
    timbers.push({ ax: -10.8, ay: 1.45, az: -1.55, bx: -10.8, by: 1.45, bz: 1.55, wx: 0.38, wz: 0.38 });
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 4 + 0.3;
      const dy = Math.sin(ang) * 0.95;
      const dx = Math.cos(ang) * 0.95;
      timbers.push({
        ax: -10.8 - dx,
        ay: 1.45 - dy,
        az: -0.95,
        bx: -10.8 + dx,
        by: 1.45 + dy,
        bz: -0.95,
        wx: 0.1,
        wz: 0.1,
      });
      timbers.push({
        ax: -10.8 - dx,
        ay: 1.45 - dy,
        az: 0.95,
        bx: -10.8 + dx,
        by: 1.45 + dy,
        bz: 0.95,
        wx: 0.1,
        wz: 0.1,
      });
    }

    // Zębatka zapadkowa kołowrotu (x = -10.8 m, z = 1.22 m)
    for (let t = 0; t < 12; t++) {
      const a = (t / 12) * Math.PI * 2;
      irons.push({
        px: -10.8 + Math.cos(a) * 0.42,
        py: 1.45 + Math.sin(a) * 0.42,
        pz: 1.22,
        rx: 0,
        ry: 0,
        rz: a + 0.35,
        sx: 0.16,
        sy: 0.12,
        sz: 0.08,
      });
    }
    // Zapadka stalowa
    irons.push({ px: -10.35, py: 1.78, pz: 1.22, rx: 0, ry: 0, rz: -0.5, sx: 0.55, sy: 0.09, sz: 0.09 });

    return { frameTimbers: timbers, frameIronParts: irons };
  }, []);

  // InstancedMesh referencje dla statycznej ramy i kamieni w skrzyni
  const frameTimberMeshRef = useRef<THREE.InstancedMesh>(null);
  const frameIronMeshRef = useRef<THREE.InstancedMesh>(null);
  const stonePileMeshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = frameTimberMeshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < frameTimbers.length; i++) {
      buildStrutMatrix(frameTimbers[i], m);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [frameTimbers]);

  useEffect(() => {
    const mesh = frameIronMeshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (let i = 0; i < frameIronParts.length; i++) {
      const p = frameIronParts[i];
      pos.set(p.px, p.py, p.pz);
      euler.set(p.rx, p.ry, p.rz);
      quat.setFromEuler(euler);
      scl.set(p.sx, p.sy, p.sz);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [frameIronParts]);

  // Sterta granitowych głazów wewnątrz skrzyni przeciwwagi (poziom rośnie z 3t..16t!)
  const STONE_COUNT = 38;
  const stoneSeeds = useMemo(() => {
    const arr: Array<{
      layer: number;
      nx: number;
      nz: number;
      rx: number;
      ry: number;
      rz: number;
      baseScale: number;
      shade: number;
    }> = [];
    for (let i = 0; i < STONE_COUNT; i++) {
      const layer = Math.floor(i / 6); // 0..6 warstw
      const slot = i % 6;
      const nx = ((slot % 3) - 1) * 0.56 + Math.sin(i * 1.9) * 0.16;
      const nz = (Math.floor(slot / 3) - 0.5) * 0.64 + Math.cos(i * 2.7) * 0.12;
      arr.push({
        layer,
        nx,
        nz,
        rx: (i * 0.73) % Math.PI,
        ry: (i * 1.37) % Math.PI,
        rz: (i * 2.11) % Math.PI,
        baseScale: 0.25 + (i % 4) * 0.035,
        shade: 0.75 + ((i * 29) % 10) * 0.032,
      });
    }
    return arr;
  }, []);

  useEffect(() => {
    const mesh = stonePileMeshRef.current;
    if (!mesh) return;
    const massNorm = Math.min(1, Math.max(0, (config.counterweightMassKg - 3000) / (16000 - 3000)));
    const visibleCount = Math.max(8, Math.round(8 + massNorm * (STONE_COUNT - 8)));
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();

    for (let i = 0; i < STONE_COUNT; i++) {
      const s = stoneSeeds[i];
      if (i >= visibleCount) {
        m.makeScale(0.0001, 0.0001, 0.0001);
        mesh.setMatrixAt(i, m);
      } else {
        const yBase = -0.78 + (s.layer / 6) * (0.45 + massNorm * 1.25);
        pos.set(s.nx, yBase, s.nz);
        euler.set(s.rx, s.ry, s.rz);
        quat.setFromEuler(euler);
        const grow = 0.86 + massNorm * 0.24;
        scl.set(s.baseScale * 1.18 * grow, s.baseScale * 0.88 * grow, s.baseScale * 1.05 * grow);
        m.compose(pos, quat, scl);
        mesh.setMatrixAt(i, m);
      }
      col.setRGB(s.shade * 0.62, s.shade * 0.6, s.shade * 0.58);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [config.counterweightMassKg, stoneSeeds]);

  // Dynamiczna geometria wygiętego żelaznego palca spustowego (0° = prosto, 80° = mocny hak!)
  const prongGeometry = useMemo(() => {
    const angleRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(config.prongAngleDeg, 0, 80));
    const prongLen = 0.96;
    const pts: THREE.Vector3[] = [];
    const segs = 12;

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      if (angleRad < 0.015) {
        pts.push(new THREE.Vector3(t * prongLen, 0, 0));
      } else {
        // Zagięcie zgodne z kierunkiem ruchu wskazówek zegara (w lokalnym układzie belki to -Y? Sprawdźmy!)
        // Belka w chwili strzału obraca się ZGODNIE z ruchem wskazówek zegara w płaszczyźnie XY (dTheta/dt < 0? Zaraz zweryfikujemy!):
        // Sprawdźmy znak! W spoczynku tip = (-8.3, 1.75), theta = -131° (-2.30 rad).
        // Podczas strzału czubek leci w lewo-górę: (-12.75, 11.4) -> theta = ±180°, potem na szczyt (0, 24.15) -> theta = +90° (+1.57 rad),
        // potem w prawo (castle +X): (+9, 20) -> theta = +42°!
        // Zatem theta maleje: -131° -> -180° (+180°) -> +90° -> +45°!
        // W lokalnym układzie belki, gdzie +X to kierunek wzdłuż długiego ramienia na zewnątrz,
        // na szczycie (theta = +90°): lokalne +X wskazuje w górę (0, +1), a lokalne -Y wskazuje w stronę zamku (+1, 0)!
        // Zatem wygięcie palca W PRZÓD (w stronę zamku na zenicie, czyli zgodnie z ruchem belki) to lokalne -Y!
        const R = prongLen / angleRad;
        const phi = t * angleRad;
        pts.push(new THREE.Vector3(R * Math.sin(phi), -R * (1 - Math.cos(phi)), 0));
      }
    }

    const curve = new THREE.CatmullRomCurve3(pts);
    // Zwężający się kuty róg (budujemy ręcznie pierścienie wzdłuż krzywej)
    const radialSegs = 8;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const frames = curve.computeFrenetFrames(segs, false);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const r = 0.088 * (1 - t * 0.62) + 0.018;
      const N = frames.normals[i];
      const B = frames.binormals[i];

      for (let j = 0; j <= radialSegs; j++) {
        const theta = (j / radialSegs) * Math.PI * 2;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const nx = cos * N.x + sin * B.x;
        const ny = cos * N.y + sin * B.y;
        const nz = cos * N.z + sin * B.z;
        positions.push(p.x + r * nx, p.y + r * ny, p.z + r * nz);
        normals.push(nx, ny, nz);
        uvs.push(j / radialSegs, t);
      }
    }

    const stride = radialSegs + 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radialSegs; j++) {
        const a = i * stride + j;
        const b = (i + 1) * stride + j;
        const c = (i + 1) * stride + (j + 1);
        const d = i * stride + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }, [config.prongAngleDeg]);

  // Stany interakcji dotykowych 3D
  const [hoveredPart, setHoveredPart] = useState<"prong" | "trigger" | "box" | null>(null);
  const [draggingPart, setDraggingPart] = useState<"prong" | "trigger" | "box" | null>(null);
  const [triggerPullProgress, setTriggerPullProgress] = useState(0);

  const dragStartRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startValue: number;
    tangentScreenX: number;
    tangentScreenY: number;
    hasFiredTrigger: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (draggingPart) {
      document.body.style.cursor = "grabbing";
    } else if (hoveredPart && !isFiring) {
      document.body.style.cursor = hoveredPart === "trigger" ? "pointer" : "grab";
    } else {
      document.body.style.cursor = "";
    }
    return () => {
      document.body.style.cursor = "";
    };
  }, [hoveredPart, draggingPart, isFiring]);

  const setActiveDrag = (next: "prong" | "trigger" | "box" | null) => {
    setDraggingPart(next);
    onDragStateChange?.(next !== null);
  };

  // Referencje grup animowanych w 60 FPS przez useFrame (zero re-renderów Reacta w trakcie lotu!)
  const beamGroupRef = useRef<THREE.Group>(null);
  const boxGroupRef = useRef<THREE.Group>(null);
  const hangerLeftRef = useRef<THREE.Mesh>(null);
  const hangerRightRef = useRef<THREE.Mesh>(null);
  const prongHitMeshRef = useRef<THREE.Mesh>(null);
  const triggerGroupRef = useRef<THREE.Group>(null);
  const triggerHitMeshRef = useRef<THREE.Mesh>(null);
  const triggerPulseGroupRef = useRef<THREE.Group>(null);
  const boxHitMeshRef = useRef<THREE.Mesh>(null);

  const slingFixedRopeRef = useRef<THREE.Mesh>(null);
  const slingRingRopeRef = useRef<THREE.Mesh>(null);
  const slingRingMeshRef = useRef<THREE.Mesh>(null);
  const pouchMeshRef = useRef<THREE.Mesh>(null);
  const projectileGroupRef = useRef<THREE.Group>(null);
  const holdDownRopeRef = useRef<THREE.Mesh>(null);

  // Wektory fizyczne 3D
  const velArrowGroupRef = useRef<THREE.Group>(null);
  const tensionArrowGroupRef = useRef<THREE.Group>(null);
  const releaseArrowGroupRef = useRef<THREE.Group>(null);

  // Stan wahadła pustej procy po wypięciu pocisku
  const loosePouchAngleRef = useRef(-Math.PI * 0.5);
  const loosePouchVelRef = useRef(0);
  const lastPoseRef = useRef<SampledTrebuchetPose | null>(null);

  const orientCylinderBetween = (
    mesh: THREE.Mesh | null,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    thickness: number
  ) => {
    if (!mesh) return;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.max(0.01, Math.hypot(dx, dy, dz));
    mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    mesh.quaternion.setFromUnitVectors(UP_VEC, dir);
    mesh.scale.set(thickness, len, thickness);
  };

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    const pose = sampleTrebuchetPose(activeResult, playbackTimeS, config, isFiring);
    lastPoseRef.current = pose;

    // 1. Obrót głównej belki dębowej wokół osi (0, 11.4, 0)
    if (beamGroupRef.current) {
      beamGroupRef.current.position.set(0, AXLE_HEIGHT_M, 0);
      beamGroupRef.current.rotation.set(0, 0, pose.thetaLongRad);
    }

    // 2. Pozycja i wahanie skrzyni przeciwwagi + ramiona zawiesia
    if (boxGroupRef.current) {
      boxGroupRef.current.position.set(pose.worldBoxX, pose.worldBoxY, 0);
      boxGroupRef.current.rotation.set(0, 0, pose.boxTiltRad);
    }
    orientCylinderBetween(
      hangerLeftRef.current,
      pose.shortTipX,
      pose.shortTipY,
      -0.58,
      pose.worldBoxX,
      pose.worldBoxY + 0.55,
      -0.58,
      0.16
    );
    orientCylinderBetween(
      hangerRightRef.current,
      pose.shortTipX,
      pose.shortTipY,
      0.58,
      pose.worldBoxX,
      pose.worldBoxY + 0.55,
      0.58,
      0.16
    );

    // 3. Skalowanie niewidzialnych hitMesh (>= 56 px w przestrzeni ekranu na 375x667!)
    const pxToWorldAt = (wx: number, wy: number, wz: number, minPixels: number): number => {
      const dist = camera.position.distanceTo(new THREE.Vector3(wx, wy, wz));
      const vFovRad =
        camera instanceof THREE.PerspectiveCamera
          ? THREE.MathUtils.degToRad(camera.fov)
          : 0.45;
      const worldHeight = 2 * dist * Math.tan(vFovRad * 0.5);
      const worldPerPx = worldHeight / Math.max(320, size.height);
      return Math.max(0.32, Math.min(1.65, worldPerPx * minPixels * 0.5));
    };

    if (prongHitMeshRef.current) {
      const rProng = pxToWorldAt(pose.tipX, pose.tipY, 0, 62);
      prongHitMeshRef.current.scale.setScalar(rProng);
    }
    if (boxHitMeshRef.current) {
      const rBox = Math.max(1.35, pxToWorldAt(pose.worldBoxX, pose.worldBoxY, 0, 64));
      boxHitMeshRef.current.scale.setScalar(rBox);
    }

    // 4. Położenie pierścienia spustowego na wygiętym palcu w układzie świata
    const prongAngleRad = THREE.MathUtils.degToRad(config.prongAngleDeg);
    const prongLen = 0.96;
    const slideT = pose.ringSlideProgress;
    let localRingX = slideT * prongLen;
    let localRingY = 0;
    if (prongAngleRad >= 0.015) {
      const R = prongLen / prongAngleRad;
      const phi = slideT * prongAngleRad;
      localRingX = R * Math.sin(phi);
      localRingY = -R * (1 - Math.cos(phi));
    }
    const cosB = Math.cos(pose.thetaLongRad);
    const sinB = Math.sin(pose.thetaLongRad);
    const worldProngRingX = pose.tipX + localRingX * cosB - localRingY * sinB;
    const worldProngRingY = pose.tipY + localRingX * sinB + localRingY * cosB;

    // Stałe ucho liny procy tuż pod czubkiem belki
    const fixedEyeX = pose.tipX - 0.22 * cosB + 0.14 * sinB;
    const fixedEyeY = pose.tipY - 0.22 * sinB - 0.14 * cosB;

    // 5. Liny procy, skórzany kosz i pocisk
    if (pose.attachedToSling) {
      // Inicjalizujemy kąt luźnej procy pod fazę po wypięciu
      loosePouchAngleRef.current = Math.atan2(pose.projY - fixedEyeY, pose.projX - fixedEyeX);
      loosePouchVelRef.current = pose.angularVelRadS * 0.85;

      orientCylinderBetween(
        slingFixedRopeRef.current,
        fixedEyeX,
        fixedEyeY,
        -0.09,
        pose.projX,
        pose.projY,
        -0.12,
        0.045
      );
      orientCylinderBetween(
        slingRingRopeRef.current,
        worldProngRingX,
        worldProngRingY,
        0.06,
        pose.projX,
        pose.projY,
        0.12,
        0.045
      );

      if (slingRingMeshRef.current) {
        slingRingMeshRef.current.position.set(worldProngRingX, worldProngRingY, 0.04);
        slingRingMeshRef.current.rotation.set(Math.PI * 0.5, pose.thetaLongRad - prongAngleRad * slideT, 0);
      }

      if (pouchMeshRef.current) {
        const slingAng = Math.atan2(pose.projY - pose.tipY, pose.projX - pose.tipX);
        const rVis = getProjectileVisualRadius(config.projectileId);
        pouchMeshRef.current.position.set(
          pose.projX + Math.cos(slingAng) * (rVis * 0.45),
          pose.projY + Math.sin(slingAng) * (rVis * 0.45),
          0
        );
        pouchMeshRef.current.rotation.set(0, 0, slingAng + Math.PI * 0.5);
      }
    } else {
      // Po wypięciu pierścienia: pusta proca smaga powietrze na końcu długiego ramienia!
      const g = 9.81;
      const effLen = Math.max(4.5, config.slingLengthM * 0.68);
      const angAcc = -(g / effLen) * Math.cos(loosePouchAngleRef.current) - loosePouchVelRef.current * 1.35;
      loosePouchVelRef.current += angAcc * dt;
      loosePouchAngleRef.current += loosePouchVelRef.current * dt;

      const emptyPouchX = fixedEyeX + Math.cos(loosePouchAngleRef.current) * effLen;
      const emptyPouchY = Math.max(0.2, fixedEyeY + Math.sin(loosePouchAngleRef.current) * effLen);
      const looseRingX = emptyPouchX + Math.cos(loosePouchAngleRef.current - 0.35) * (effLen * 0.45);
      const looseRingY = Math.max(0.18, emptyPouchY + Math.sin(loosePouchAngleRef.current - 0.35) * (effLen * 0.45));

      orientCylinderBetween(
        slingFixedRopeRef.current,
        fixedEyeX,
        fixedEyeY,
        -0.06,
        emptyPouchX,
        emptyPouchY,
        0,
        0.042
      );
      orientCylinderBetween(
        slingRingRopeRef.current,
        emptyPouchX,
        emptyPouchY,
        0,
        looseRingX,
        looseRingY,
        0.05,
        0.038
      );

      if (slingRingMeshRef.current) {
        slingRingMeshRef.current.position.set(looseRingX, looseRingY, 0.05);
        slingRingMeshRef.current.rotation.set(state.clock.elapsedTime * 5, state.clock.elapsedTime * 3, 0);
      }
      if (pouchMeshRef.current) {
        pouchMeshRef.current.position.set(emptyPouchX, emptyPouchY, 0);
        pouchMeshRef.current.rotation.set(0, 0, loosePouchAngleRef.current + Math.PI * 0.5);
      }
    }

    // Pozycja i obrót samego pocisku (kuli granitowej lub płonącej beczki smolnej!)
    if (projectileGroupRef.current) {
      projectileGroupRef.current.position.set(pose.projX, pose.projY, 0);
      if (isFiring && playbackTimeS > 0) {
        const spin = playbackTimeS * (pose.attachedToSling ? 3.2 : 8.5);
        projectileGroupRef.current.rotation.set(spin * 0.4, spin * 0.25, -spin);
      } else {
        projectileGroupRef.current.rotation.set(0.2, 0.4, 0.1);
      }
    }

    // 6. Czerwono-mosiężny sznur spustowy i przetyczka naciągowa (widoczne w spoczynku!)
    const catchBeamDist = Math.max(3.5, pose.longArmM - 2.35);
    const catchX = catchBeamDist * cosB;
    const catchY = AXLE_HEIGHT_M + catchBeamDist * sinB;

    if (triggerGroupRef.current) {
      triggerGroupRef.current.visible = !isFiring;
      if (!isFiring) {
        triggerGroupRef.current.position.set(catchX, catchY, 0.56);
        const rTrig = pxToWorldAt(catchX, catchY - 0.55, 0.56, 62);
        if (triggerHitMeshRef.current) {
          triggerHitMeshRef.current.scale.setScalar(rTrig);
        }
        if (triggerPulseGroupRef.current) {
          const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.2) * 0.075;
          triggerPulseGroupRef.current.scale.setScalar(
            hoveredPart === "trigger" || draggingPart === "trigger" ? 1.15 : pulse
          );
          triggerPulseGroupRef.current.position.y = -triggerPullProgress * 0.48;
        }
      }
    }

    if (holdDownRopeRef.current) {
      holdDownRopeRef.current.visible = !isFiring;
      if (!isFiring) {
        orientCylinderBetween(
          holdDownRopeRef.current,
          catchX,
          catchY,
          0,
          -10.8,
          1.45,
          0,
          0.055
        );
      }
    }

    // 7. Wektory fizyczne 3D (gdy showVectors === true)
    if (showVectors) {
      // Styczny wektor prędkości czubka belki (ruch zgodny ze wskazówkami zegara = [sinB, -cosB]? Sprawdźmy!)
      // Gdy theta maleje (z -131° przez -180° do +90°), d/dt(cos, sin) = (-sin, cos) * dTheta/dt.
      // Ponieważ dTheta/dt < 0 (ruch clockwise), kierunek ruchu czubka to (+sinB, -cosB)!
      const tanX = sinB;
      const tanY = -cosB;
      const speedMag = isFiring
        ? Math.min(4.8, Math.max(1.1, Math.abs(pose.angularVelRadS) * 0.95))
        : 2.6;

      if (velArrowGroupRef.current) {
        velArrowGroupRef.current.visible = true;
        velArrowGroupRef.current.position.set(pose.tipX, pose.tipY, 0.25);
        velArrowGroupRef.current.rotation.set(0, 0, Math.atan2(tanY, tanX) - Math.PI * 0.5);
        velArrowGroupRef.current.scale.set(1, speedMag / 2.4, 1);
      }

      if (tensionArrowGroupRef.current) {
        tensionArrowGroupRef.current.visible = pose.attachedToSling;
        if (pose.attachedToSling) {
          const tx = pose.tipX - pose.projX;
          const ty = pose.tipY - pose.projY;
          tensionArrowGroupRef.current.position.set(pose.projX, pose.projY, 0.25);
          tensionArrowGroupRef.current.rotation.set(0, 0, Math.atan2(ty, tx) - Math.PI * 0.5);
          const massFactor = 0.8 + ((config.counterweightMassKg - 3000) / 13000) * 0.85;
          tensionArrowGroupRef.current.scale.set(1, massFactor, 1);
        }
      }

      if (releaseArrowGroupRef.current) {
        releaseArrowGroupRef.current.visible = true;
        // Przewidywany lub aktualny wektor wyrzutu pocisku
        let relAngRad = THREE.MathUtils.degToRad(42);
        if (activeResult) {
          const forwardSign = activeResult.impactDistanceM < 0 ? -1 : 1;
          const deg = THREE.MathUtils.clamp(activeResult.releaseAngleDeg, -85, 89);
          relAngRad =
            forwardSign < 0
              ? Math.PI - THREE.MathUtils.degToRad(Math.abs(deg))
              : THREE.MathUtils.degToRad(deg);
        } else {
          // Przybliżenie z kąta palca: 0° -> ~112° (wstecz!), 38° -> ~43°, 80° -> -18° (w ziemię!)
          const estDeg = 112 - config.prongAngleDeg * 1.65;
          relAngRad = THREE.MathUtils.degToRad(estDeg);
        }
        const anchorX = !isFiring || pose.attachedToSling ? pose.tipX : pose.projX;
        const anchorY = !isFiring || pose.attachedToSling ? pose.tipY : pose.projY;
        const dirAngle = !isFiring || pose.attachedToSling ? relAngRad : Math.atan2(pose.projVy, pose.projVx);

        releaseArrowGroupRef.current.position.set(anchorX, anchorY, 0.32);
        releaseArrowGroupRef.current.rotation.set(0, 0, dirAngle - Math.PI * 0.5);
      }
    } else {
      if (velArrowGroupRef.current) velArrowGroupRef.current.visible = false;
      if (tensionArrowGroupRef.current) tensionArrowGroupRef.current.visible = false;
      if (releaseArrowGroupRef.current) releaseArrowGroupRef.current.visible = false;
    }
  });

  // Handlery przeciągania 3D z setPointerCapture (1 palec na 375x667 i mysz na desktopie!)
  const captureCanvasPointer = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    try {
      (e.target as unknown as { setPointerCapture?: (id: number) => void })?.setPointerCapture?.(
        e.pointerId
      );
    } catch {
      // Ignoruj, jeśli syntetyczny target R3F nie ma metody DOM
    }
    try {
      gl.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Bezpieczny fallback
    }
  };

  const releaseCanvasPointer = (pointerId: number) => {
    try {
      gl.domElement.releasePointerCapture(pointerId);
    } catch {
      // Bezpieczny fallback
    }
  };

  const handleProngPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (isFiring) return;
    captureCanvasPointer(e);
    onFirstInteract?.();

    const pose = lastPoseRef.current ?? sampleTrebuchetPose(activeResult, 0, config, false);
    // Projektujemy czubek belki oraz kierunek zginania palca (lokalne -Y belki) na ekran,
    // aby przeciąganie wzdłuż wizualnego wygięcia palca działało intuicyjnie z każdego kąta kamery!
    const p0 = new THREE.Vector3(pose.tipX, pose.tipY, 0).project(camera);
    const bendDirWorld = new THREE.Vector3(
      pose.tipX + Math.sin(pose.thetaLongRad),
      pose.tipY - Math.cos(pose.thetaLongRad),
      0
    ).project(camera);

    let sx = (bendDirWorld.x - p0.x) * (size.width * 0.5);
    let sy = -(bendDirWorld.y - p0.y) * (size.height * 0.5);
    const len = Math.hypot(sx, sy);
    if (len > 1e-3) {
      sx /= len;
      sy /= len;
    } else {
      sx = 0.7;
      sy = -0.7;
    }

    dragStartRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startValue: config.prongAngleDeg,
      tangentScreenX: sx,
      tangentScreenY: sy,
      hasFiredTrigger: false,
    };
    setActiveDrag("prong");
  };

  const handleBoxPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (isFiring) return;
    captureCanvasPointer(e);
    onFirstInteract?.();
    dragStartRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startValue: config.counterweightMassKg,
      tangentScreenX: 0,
      tangentScreenY: -1,
      hasFiredTrigger: false,
    };
    setActiveDrag("box");
  };

  const handleTriggerPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (isFiring) return;
    captureCanvasPointer(e);
    onFirstInteract?.();
    dragStartRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startValue: 0,
      tangentScreenX: 0,
      tangentScreenY: 1,
      hasFiredTrigger: false,
    };
    setTriggerPullProgress(0.25);
    setActiveDrag("trigger");
  };

  // Globalne nasłuchiwanie pointermove / pointerup podczas aktywnego przeciągania uchwytu 3D
  useEffect(() => {
    if (!draggingPart) return;

    const onMove = (ev: PointerEvent) => {
      const st = dragStartRef.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      const dx = ev.clientX - st.startClientX;
      const dy = ev.clientY - st.startClientY;

      if (draggingPart === "prong") {
        const projectedPx = dx * st.tangentScreenX + dy * st.tangentScreenY;
        const sensitivity = isProngZoom ? 0.48 : 0.68;
        const nextDeg = Math.round(
          THREE.MathUtils.clamp(st.startValue + projectedPx * sensitivity, 0, 80)
        );
        onChangeProngAngle(nextDeg);
      } else if (draggingPart === "box") {
        // Przeciągnięcie w górę podnosi stertę głazów w skrzyni (3000..16000 kg)
        const deltaKg = -dy * 75;
        const stepped = Math.round((st.startValue + deltaKg) / 250) * 250;
        const clamped = THREE.MathUtils.clamp(stepped, 3000, 16000);
        onChangeCounterweight(clamped);
      } else if (draggingPart === "trigger") {
        const pull = THREE.MathUtils.clamp(dy / 44, 0, 1);
        setTriggerPullProgress(Math.max(0.2, pull));
        if (dy > 38 && !st.hasFiredTrigger) {
          st.hasFiredTrigger = true;
          setTriggerPullProgress(0);
          releaseCanvasPointer(st.pointerId);
          dragStartRef.current = null;
          setActiveDrag(null);
          onPullTrigger();
        }
      }
    };

    const onUp = (ev: PointerEvent) => {
      const st = dragStartRef.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      const dist = Math.hypot(ev.clientX - st.startClientX, ev.clientY - st.startClientY);

      if (draggingPart === "trigger" && !st.hasFiredTrigger) {
        // Zarówno kliknięcie, jak i pociągnięcie sznura w dół zwalnia machinę!
        if (dist < 42 || ev.clientY - st.startClientY > 8) {
          st.hasFiredTrigger = true;
          onPullTrigger();
        }
      }

      setTriggerPullProgress(0);
      releaseCanvasPointer(st.pointerId);
      dragStartRef.current = null;
      setActiveDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    draggingPart,
    isProngZoom,
    onChangeCounterweight,
    onChangeProngAngle,
    onPullTrigger,
  ]);

  const prongHighlighted = hoveredPart === "prong" || draggingPart === "prong" || isProngZoom;
  const showProtractor =
    !isFiring && (draggingPart === "prong" || hoveredPart === "prong" || isProngZoom || !hasInteracted);
  const isIncendiary = config.projectileId === "smola_85";
  const projVisualRadius = getProjectileVisualRadius(config.projectileId);
  const isBackfireDanger = config.prongAngleDeg <= 9;

  // Zespolone geometrie statyczne redukujące liczbę draw calli poniżej 25 w całej scenie!
  const beamCollarsGeo = useMemo(() => {
    const xs = [-armDims.shortArmM, -1.35, -0.45, 0.45, 2.6, 6.2, 9.8, armDims.longArmM - 0.18];
    const parts = xs.map((bx) => {
      const t = Math.max(0, bx / armDims.longArmM);
      const h = bx < 0 ? 0.72 : 0.72 * (1 - t * 0.62);
      const w = bx < 0 ? 0.62 : 0.62 * (1 - t * 0.6);
      const m = new THREE.Matrix4().makeTranslation(bx, 0, 0);
      return { geometry: new THREE.BoxGeometry(0.14, h, w), matrix: m };
    });
    const merged = mergeStaticGeometries(parts);
    parts.forEach((p) => p.geometry.dispose());
    return merged;
  }, [armDims.longArmM, armDims.shortArmM]);

  const rigidLockBarsGeo = useMemo(() => {
    const parts: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }> = [];
    for (const zSide of [-0.64, 0.64]) {
      const mBar = new THREE.Matrix4()
        .makeTranslation(0, 0, zSide)
        .multiply(new THREE.Matrix4().makeRotationZ(0.66));
      parts.push({ geometry: new THREE.BoxGeometry(0.18, 2.75, 0.14), matrix: mBar });
      const mClamp = new THREE.Matrix4().makeTranslation(0.42, 0.85, zSide);
      parts.push({ geometry: new THREE.BoxGeometry(0.34, 0.34, 0.24), matrix: mClamp });
    }
    const merged = mergeStaticGeometries(parts);
    parts.forEach((p) => p.geometry.dispose());
    return merged;
  }, []);

  const protractorTicksGeo = useMemo(() => {
    const degs = [0, 10, 20, 30, 40, 50, 60, 70, 80];
    const parts = degs.map((deg) => {
      const rad = -THREE.MathUtils.degToRad(deg);
      const rMid = deg % 20 === 0 ? 1.34 : 1.29;
      const m = new THREE.Matrix4()
        .makeTranslation(Math.cos(rad) * rMid, Math.sin(rad) * rMid, 0.01)
        .multiply(new THREE.Matrix4().makeRotationZ(rad));
      return {
        geometry: new THREE.BoxGeometry(deg % 20 === 0 ? 0.18 : 0.1, 0.032, 0.02),
        matrix: m,
        color: deg <= 10 ? "#f87171" : "#fef08a",
      };
    });
    const merged = mergeStaticGeometries(parts, true);
    parts.forEach((p) => p.geometry.dispose());
    return merged;
  }, []);

  const chestOakGeo = useMemo(() => {
    const gBody = new THREE.BoxGeometry(2.35, 1.95, 1.65);
    const mBody = new THREE.Matrix4().makeTranslation(0, -0.22, 0);
    const gBottom = new THREE.BoxGeometry(1.15, 1.15, 1.58);
    const mBottom = new THREE.Matrix4()
      .makeTranslation(0, -1.32, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI * 0.25));
    const merged = mergeStaticGeometries([
      { geometry: gBody, matrix: mBody },
      { geometry: gBottom, matrix: mBottom },
    ]);
    gBody.dispose();
    gBottom.dispose();
    return merged;
  }, []);

  const chestStrapsGeo = useMemo(() => {
    const parts = [-0.95, 0, 0.95].map((xBand) => ({
      geometry: new THREE.BoxGeometry(0.12, 2.04, 1.73),
      matrix: new THREE.Matrix4().makeTranslation(xBand, -0.22, 0),
    }));
    const merged = mergeStaticGeometries(parts);
    parts.forEach((p) => p.geometry.dispose());
    return merged;
  }, []);

  const triggerBrassGeo = useMemo(() => {
    const gPin = new THREE.CylinderGeometry(0.075, 0.075, 0.62, 10);
    const mPin = new THREE.Matrix4().makeRotationX(Math.PI * 0.5);
    const gRing = new THREE.TorusGeometry(0.18, 0.042, 8, 18);
    const mRing = new THREE.Matrix4().makeTranslation(0, -0.08, 0.26);
    const gCap = new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10);
    const mCap = new THREE.Matrix4().makeTranslation(0, -1.08, 0.26);
    const merged = mergeStaticGeometries([
      { geometry: gPin, matrix: mPin },
      { geometry: gRing, matrix: mRing },
      { geometry: gCap, matrix: mCap },
    ]);
    gPin.dispose();
    gRing.dispose();
    gCap.dispose();
    return merged;
  }, []);

  const triggerCrimsonCordGeo = useMemo(() => {
    const gRope = new THREE.CylinderGeometry(0.048, 0.042, 0.96, 8);
    const mRope = new THREE.Matrix4().makeTranslation(0, -0.58, 0.26);
    const gTassel = new THREE.ConeGeometry(0.14, 0.32, 10);
    const mTassel = new THREE.Matrix4().makeTranslation(0, -1.24, 0.26);
    const merged = mergeStaticGeometries([
      { geometry: gRope, matrix: mRope },
      { geometry: gTassel, matrix: mTassel },
    ]);
    gRope.dispose();
    gTassel.dispose();
    return merged;
  }, []);

  const cueArrowGeo = useMemo(() => {
    const gArc = new THREE.TorusGeometry(0.42, 0.036, 8, 16, 1.35);
    const mArc = new THREE.Matrix4().makeRotationZ(-0.35);
    const gHead = new THREE.ConeGeometry(0.13, 0.28, 10);
    const mHead = new THREE.Matrix4()
      .makeTranslation(0.12, -0.44, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI + 0.22));
    const merged = mergeStaticGeometries([
      { geometry: gArc, matrix: mArc },
      { geometry: gHead, matrix: mHead },
    ]);
    gArc.dispose();
    gHead.dispose();
    return merged;
  }, []);

  const vectorArrowGeo = useMemo(() => {
    const gShaft = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8);
    const mShaft = new THREE.Matrix4().makeTranslation(0, 1.2, 0);
    const gHead = new THREE.ConeGeometry(0.19, 0.45, 10);
    const mHead = new THREE.Matrix4().makeTranslation(0, 2.58, 0);
    const merged = mergeStaticGeometries([
      { geometry: gShaft, matrix: mShaft },
      { geometry: gHead, matrix: mHead },
    ]);
    gShaft.dispose();
    gHead.dispose();
    return merged;
  }, []);

  return (
    <group name="historical-trebuchet-root">
      {/* 1. Statyczna dębowa konstrukcja kozłów A-kształtnych, płóz, koryta i kołowrotu (1 draw call!) */}
      <instancedMesh
        ref={frameTimberMeshRef}
        args={[timberGeo, mats.agedOak, frameTimbers.length]}
        castShadow
        receiveShadow
      />

      {/* 2. Kute żelazne obejmy, łożyska, zębatka i nity (1 draw call!) */}
      <instancedMesh
        ref={frameIronMeshRef}
        args={[ironBoxGeo, mats.forgedIron, frameIronParts.length]}
        castShadow
        receiveShadow
      />

      {/* 3. Główna stalowa oś obrotu na wysokości 11.4 m */}
      <mesh
        position={[0, AXLE_HEIGHT_M, 0]}
        rotation={[Math.PI * 0.5, 0, 0]}
        material={mats.forgedIron}
        castShadow
      >
        <cylinderGeometry args={[0.15, 0.15, 3.55, 14]} />
      </mesh>

      {/* 4. Główna zwężająca się dębowa belka wahliwa (swobodny przelot przez pion!) */}
      <group ref={beamGroupRef} position={[0, AXLE_HEIGHT_M, 0]}>
        <mesh geometry={mainBeamGeo} material={mats.agedOak} castShadow receiveShadow />

        {/* Zespolone kute żelazne opaski wzmacniające belkę główną (1 draw call!) */}
        <mesh geometry={beamCollarsGeo} material={mats.forgedIron} castShadow />

        {/* Gdy skrzynia jest ZABLOKOWANA NA SZTYWNO (hingedCounterweight === false):
            zespolone czerwono-stalowe rygle zastrzałowe spinające belkę na sztywno ze skrzynią! */}
        {!config.hingedCounterweight && (
          <mesh
            position={[-armDims.shortArmM * 0.62, -1.15, 0]}
            geometry={rigidLockBarsGeo}
            castShadow
          >
            <meshStandardMaterial
              color="#992a1e"
              metalness={0.78}
              roughness={0.34}
              emissive="#4a0f08"
              emissiveIntensity={0.35}
            />
          </mesh>
        )}

        {/* === UCHWYT DOTYKOWY #1: Żelazno-mosiężny Palec Spustowy (0°..80°) na czubku belki === */}
        <group position={[armDims.longArmM, 0, 0]}>
          {/* Mosiężna tuleja osadcza palca */}
          <mesh
            position={[-0.08, 0, 0]}
            rotation={[0, 0, Math.PI * 0.5]}
            material={mats.polishedBrass}
            castShadow
          >
            <cylinderGeometry args={[0.145, 0.165, 0.28, 12]} />
          </mesh>

          {/* Wyginający się dynamicznie palec spustowy */}
          <mesh geometry={prongGeometry} castShadow>
            <meshStandardMaterial
              map={mats.polishedBrass.map}
              roughnessMap={mats.polishedBrass.roughnessMap}
              bumpMap={mats.polishedBrass.bumpMap}
              bumpScale={0.016}
              color={prongHighlighted ? "#ffd978" : "#eab344"}
              metalness={0.88}
              roughness={0.2}
              emissive={isBackfireDanger ? "#b91c1c" : "#9a6410"}
              emissiveIntensity={prongHighlighted ? 0.62 : hasInteracted ? 0.28 : 0.46}
            />
          </mesh>

          {/* Łuk kątomierza 3D (0°..80°) widoczny podczas regulacji / zbliżenia */}
          {showProtractor && (
            <group position={[0, 0, 0.18]}>
              <mesh rotation={[0, 0, -THREE.MathUtils.degToRad(80)]}>
                <ringGeometry args={[1.18, 1.28, 28, 1, 0, THREE.MathUtils.degToRad(80)]} />
                <meshBasicMaterial
                  color="#fde68a"
                  transparent
                  opacity={draggingPart === "prong" || isProngZoom ? 0.72 : 0.34}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
              <mesh rotation={[0, 0, -THREE.MathUtils.degToRad(9)]}>
                <ringGeometry args={[1.15, 1.31, 8, 1, 0, THREE.MathUtils.degToRad(9)]} />
                <meshBasicMaterial
                  color="#ef4444"
                  transparent
                  opacity={draggingPart === "prong" || isProngZoom ? 0.85 : 0.45}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
              <mesh geometry={protractorTicksGeo}>
                <meshBasicMaterial
                  vertexColors
                  transparent
                  opacity={draggingPart === "prong" || isProngZoom ? 0.9 : 0.45}
                />
              </mesh>
              <mesh
                position={[
                  Math.cos(-THREE.MathUtils.degToRad(config.prongAngleDeg)) * 0.72,
                  Math.sin(-THREE.MathUtils.degToRad(config.prongAngleDeg)) * 0.72,
                  0.02,
                ]}
                rotation={[0, 0, -THREE.MathUtils.degToRad(config.prongAngleDeg)]}
              >
                <boxGeometry args={[1.44, 0.045, 0.025]} />
                <meshBasicMaterial color={isBackfireDanger ? "#ef4444" : "#fbbf24"} />
              </mesh>
            </group>
          )}

          {/* Powiększony niewidzialny hitMesh (>= 62 px ekranowo) do chwytania jednym palcem! */}
          <mesh
            ref={prongHitMeshRef}
            position={[0.38, -0.12, 0]}
            onPointerOver={(e) => {
              e.stopPropagation();
              if (!isFiring) setHoveredPart("prong");
            }}
            onPointerOut={() => {
              if (hoveredPart === "prong") setHoveredPart(null);
            }}
            onPointerDown={handleProngPointerDown}
          >
            <sphereGeometry args={[1, 10, 10]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        </group>
      </group>

      {/* 5. Ramiona zawiesia skrzyni przeciwwagi */}
      <mesh ref={hangerLeftRef} material={mats.forgedIron} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
      </mesh>
      <mesh ref={hangerRightRef} material={mats.forgedIron} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
      </mesh>

      {/* 6. Drewniana okuta skrzynia przeciwwagi ze stertą kamieni (3t..16t) + uchwyt 3D */}
      <group ref={boxGroupRef}>
        <mesh geometry={chestOakGeo} material={mats.tarredOak} castShadow receiveShadow />
        <mesh geometry={chestStrapsGeo} material={mats.forgedIron} castShadow />
        {(hoveredPart === "box" || draggingPart === "box") && !isFiring && (
          <mesh position={[0, 0.78, 0]}>
            <boxGeometry args={[2.46, 0.12, 1.78]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.85} />
          </mesh>
        )}

        <instancedMesh
          ref={stonePileMeshRef}
          args={[boulderGeo, mats.fieldGranite, STONE_COUNT]}
          position={[0, 0.35, 0]}
          castShadow
          receiveShadow
        />

        <mesh
          ref={boxHitMeshRef}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (!isFiring) setHoveredPart("box");
          }}
          onPointerOut={() => {
            if (hoveredPart === "box") setHoveredPart(null);
          }}
          onPointerDown={handleBoxPointerDown}
        >
          <sphereGeometry args={[1, 10, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>

      {/* 7. Lina naciągowa łącząca belkę z kołowrotem oraz UCHWYT #2: Sznur i Przetyczka Spustowa */}
      <mesh ref={holdDownRopeRef} material={mats.slingLeather}>
        <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
      </mesh>

      <group ref={triggerGroupRef}>
        <group ref={triggerPulseGroupRef}>
          <mesh geometry={triggerBrassGeo} material={mats.polishedBrass} castShadow />
          <mesh geometry={triggerCrimsonCordGeo} castShadow>
            <meshStandardMaterial
              color="#dc2626"
              roughness={0.55}
              emissive="#7f1d1d"
              emissiveIntensity={hoveredPart === "trigger" || draggingPart === "trigger" ? 0.75 : 0.38}
            />
          </mesh>

          {!hasInteracted && (
            <mesh position={[0.42, -0.68, 0.32]} geometry={cueArrowGeo}>
              <meshBasicMaterial color="#fbbf24" />
            </mesh>
          )}
        </group>

        <mesh
          ref={triggerHitMeshRef}
          position={[0, -0.62, 0.22]}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (!isFiring) setHoveredPart("trigger");
          }}
          onPointerOut={() => {
            if (hoveredPart === "trigger") setHoveredPart(null);
          }}
          onPointerDown={handleTriggerPointerDown}
        >
          <sphereGeometry args={[1, 10, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>

      {/* 8. Liny procy, kuty pierścień spustowy, skórzany kosz i pocisk */}
      <mesh ref={slingFixedRopeRef} material={mats.tentCanvas} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
      </mesh>
      <mesh ref={slingRingRopeRef} material={mats.tentCanvas} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
      </mesh>
      <mesh ref={slingRingMeshRef} material={mats.forgedIron} castShadow>
        <torusGeometry args={[0.14, 0.036, 8, 16]} />
      </mesh>
      <mesh ref={pouchMeshRef} material={mats.slingLeather} castShadow>
        <cylinderGeometry args={[projVisualRadius * 1.15, projVisualRadius * 0.92, 0.28, 10, 1, true]} />
      </mesh>

      {/* Sam pocisk: ciosana kula granitowa albo płonąca beczka smolna z żarem! */}
      <group ref={projectileGroupRef}>
        {isIncendiary ? (
          <group>
            <mesh material={mats.tarredOak} castShadow>
              <cylinderGeometry args={[projVisualRadius * 0.85, projVisualRadius * 0.85, projVisualRadius * 1.9, 12]} />
            </mesh>
            <mesh position={[0, projVisualRadius * 0.72, 0]}>
              <dodecahedronGeometry args={[projVisualRadius * 0.94, 1]} />
              <meshBasicMaterial color="#ff7b00" transparent opacity={0.84} />
            </mesh>
            <pointLight color="#ff6a00" intensity={8} distance={18} decay={2} />
          </group>
        ) : (
          <mesh material={mats.fieldGranite} castShadow receiveShadow>
            <dodecahedronGeometry
              args={[projVisualRadius, config.projectileId === "glaz_145" ? 1 : 2]}
            />
          </mesh>
        )}
      </group>

      {/* 9. Wektory fizyczne 3D (gdy showVectors === true) */}
      <group ref={velArrowGroupRef} visible={false}>
        <mesh geometry={vectorArrowGeo}>
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      </group>

      <group ref={tensionArrowGroupRef} visible={false}>
        <mesh geometry={vectorArrowGeo}>
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      </group>

      <group ref={releaseArrowGroupRef} visible={false}>
        <mesh geometry={vectorArrowGeo}>
          <meshBasicMaterial color={isBackfireDanger ? "#ef4444" : "#10b981"} />
        </mesh>
      </group>
    </group>
  );
}
