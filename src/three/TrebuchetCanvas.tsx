"use client";

import React, {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type {
  ShotSimulationResult,
  SiegeMission,
  TrebuchetConfig,
} from "@/types/trebuchet";
import {
  AXLE_HEIGHT_M,
  sampleTrebuchetPose,
  TrebuchetModel,
} from "./TrebuchetModel";
import { FortressAndCamp } from "./FortressAndCamp";

export type CameraMode =
  | "auto"
  | "trebuchet"
  | "follow"
  | "overview"
  | "prong_zoom";

export type CanvasCaptureFn = () => Promise<ImageBitmap | null>;

export interface TrebuchetCanvasProps<TCapture = CanvasCaptureFn> {
  config: TrebuchetConfig;
  mission: SiegeMission;
  activeResult: ShotSimulationResult | null;
  playbackTimeS: number;
  isFiring: boolean;
  slowMotion?: boolean;
  showVectors?: boolean;
  cameraMode?: CameraMode;
  ghostFrames?: ReadonlyArray<{ x: number; y: number }> | null;
  ghostLabel?: string | null;
  onChangeProngAngle: (angleDeg: number) => void;
  onChangeCounterweight: (massKg: number) => void;
  onPullTrigger: () => void;
  onFirstInteract?: () => void;
  canvasCaptureRef?: { current: TCapture | null } | null;
}

function detectWebGLSupport(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return true;
  }
  try {
    const testCanvas = document.createElement("canvas");
    const ctx =
      testCanvas.getContext("webgl2") ||
      testCanvas.getContext("webgl") ||
      testCanvas.getContext("experimental-webgl");
    return Boolean(ctx);
  } catch {
    return false;
  }
}

interface WebGLErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
}

class WebGLErrorBoundary extends Component<
  WebGLErrorBoundaryProps,
  WebGLErrorBoundaryState
> {
  constructor(props: WebGLErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): WebGLErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Przełączenie na bezpieczny widok 2D przy błędzie kontekstu GPU
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Proceduralna kopuła nieba o zmierzchu oblężniczym (zero zewnętrznych tekstur HDR).
 */
function SiegeTwilightSky() {
  const skyShader = useMemo(
    () => ({
      uniforms: {
        uTopColor: { value: new THREE.Color("#0b1222") },
        uMidColor: { value: new THREE.Color("#252238") },
        uHorizonColor: { value: new THREE.Color("#9e4d25") },
        uGroundColor: { value: new THREE.Color("#141218") },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTopColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uGroundColor;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = dir.y;
          vec3 col;
          if (h < 0.0) {
            col = mix(uHorizonColor * 0.55, uGroundColor, clamp(-h * 6.0, 0.0, 1.0));
          } else if (h < 0.18) {
            float t = h / 0.18;
            col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 1.0, t));
          } else {
            float t = (h - 0.18) / 0.82;
            col = mix(uMidColor, uTopColor, pow(clamp(t, 0.0, 1.0), 0.72));
          }
          // Subtelna łuna zachodzącego słońca za zamkiem (+X)
          float sunGlow = pow(max(0.0, dot(dir, normalize(vec3(0.88, 0.11, -0.32)))), 14.0);
          col += vec3(0.52, 0.22, 0.06) * sunGlow;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
    []
  );

  return (
    <mesh scale={[480, 480, 480]} frustumCulled={false}>
      <sphereGeometry args={[1, 24, 16]} />
      <shaderMaterial
        args={[skyShader]}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Smuga aktualnego lotu kuli oraz złota półprzezroczysta parabola Ducha Rywala w 3D.
 */
function TrajectoryArcs({
  activeResult,
  playbackTimeS,
  isFiring,
  isIncendiary,
  ghostFrames,
  ghostLabel,
}: {
  activeResult: ShotSimulationResult | null;
  playbackTimeS: number;
  isFiring: boolean;
  isIncendiary: boolean;
  ghostFrames?: ReadonlyArray<{ x: number; y: number }> | null;
  ghostLabel?: string | null;
}) {
  // Złota parabola Ducha Rywala (stała geometria rurowa, 1 draw call)
  const { ghostGeo, ghostApex } = useMemo(() => {
    if (!ghostFrames || ghostFrames.length < 2) {
      return { ghostGeo: null, ghostApex: null };
    }
    const pts: THREE.Vector3[] = [];
    let bestY = -Infinity;
    let apexPt = new THREE.Vector3(0, 12, -0.45);
    const step = Math.max(1, Math.floor(ghostFrames.length / 64));

    for (let i = 0; i < ghostFrames.length; i += step) {
      const gf = ghostFrames[i];
      if (!Number.isFinite(gf.x) || !Number.isFinite(gf.y)) continue;
      const v = new THREE.Vector3(gf.x, Math.max(0.15, gf.y), -0.45);
      pts.push(v);
      if (gf.y > bestY) {
        bestY = gf.y;
        apexPt = v.clone();
      }
    }
    const last = ghostFrames[ghostFrames.length - 1];
    if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
      const endV = new THREE.Vector3(last.x, Math.max(0.15, last.y), -0.45);
      if (pts.length === 0 || pts[pts.length - 1].distanceTo(endV) > 0.05) {
        pts.push(endV);
      }
    }
    if (pts.length < 2) {
      return { ghostGeo: null, ghostApex: null };
    }

    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, Math.min(96, pts.length * 2), 0.16, 6, false);
    return { ghostGeo: tube, ghostApex: apexPt };
  }, [ghostFrames]);

  // Dynamiczny bufor smugi aktualnego strzału aktualizowany w useFrame bez alokacji!
  const MAX_TRAIL_PTS = 140;
  const trailLineObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_TRAIL_PTS * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: isIncendiary ? "#ff8c24" : "#fef08a",
      transparent: true,
      opacity: 0.85,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return line;
  }, [isIncendiary]);

  useFrame(() => {
    const geo = trailLineObj.geometry;
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;

    if (!activeResult || (!isFiring && playbackTimeS <= 0)) {
      geo.setDrawRange(0, 0);
      return;
    }

    const frames = activeResult.frames;
    const relT = activeResult.releaseTimeS * 0.65;
    if (playbackTimeS <= relT || frames.length < 2) {
      geo.setDrawRange(0, 0);
      return;
    }

    let validEndIdx = 0;
    while (validEndIdx < frames.length - 1 && frames[validEndIdx].t < playbackTimeS) {
      validEndIdx++;
    }

    let startIdx = 0;
    while (startIdx < validEndIdx && frames[startIdx].t < relT) {
      startIdx++;
    }

    const totalSpan = Math.max(1, validEndIdx - startIdx);
    const count = Math.min(MAX_TRAIL_PTS, totalSpan + 1);
    if (count < 2) {
      geo.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < count; i++) {
      const fIdx =
        i === count - 1
          ? validEndIdx
          : startIdx + Math.floor((i / (count - 1)) * totalSpan);
      const f = frames[Math.min(frames.length - 1, fIdx)];
      attr.setXYZ(i, f.projX, Math.max(0.15, f.projY), 0.08);
    }
    attr.needsUpdate = true;
    geo.setDrawRange(0, count);
  });

  return (
    <group name="trajectory-arcs">
      <primitive object={trailLineObj} />

      {ghostGeo && (
        <mesh geometry={ghostGeo} frustumCulled={false}>
          <meshBasicMaterial
            color="#fbbf24"
            transparent
            opacity={0.44}
            depthWrite={false}
          />
        </mesh>
      )}

      {ghostGeo && ghostApex && ghostLabel && (
        <Html
          position={[ghostApex.x, ghostApex.y + 1.8, ghostApex.z]}
          center
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div className="whitespace-nowrap rounded-full border border-amber-400/50 bg-stone-950/80 px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-amber-300 shadow-lg backdrop-blur-sm">
            {ghostLabel}
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * Przypięcie canvasCaptureRef: wymusza gl.render(scene, camera) i zwraca createImageBitmap(gl.domElement).
 */
function CanvasCaptureBridge<TCapture>({
  canvasCaptureRef,
}: {
  canvasCaptureRef?: { current: TCapture | null } | null;
}) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    if (!canvasCaptureRef) return;

    const captureFn = async (): Promise<ImageBitmap | null> => {
      try {
        gl.render(scene, camera);
        if (typeof createImageBitmap === "function") {
          return await createImageBitmap(gl.domElement);
        }
        return null;
      } catch {
        return null;
      }
    };

    canvasCaptureRef.current = captureFn as unknown as TCapture;
    return () => {
      canvasCaptureRef.current = null;
    };
  }, [canvasCaptureRef, gl, scene, camera]);

  return null;
}

/**
 * Reżyser kamery obsługujący 5 trybów, przesunięcie kadru mobilnego (setViewOffset dla width < 640),
 * dynamiczną Kamerę Kuli (Bullet-Cam) i wstrząs kamery (camera shake) w chwili uderzenia.
 */
function SiegeCameraRig({
  cameraMode,
  config,
  mission,
  activeResult,
  playbackTimeS,
  isFiring,
  slowMotion,
  isDraggingPart,
  controlsRef,
  userOrbitedRef,
}: {
  cameraMode: CameraMode;
  config: TrebuchetConfig;
  mission: SiegeMission;
  activeResult: ShotSimulationResult | null;
  playbackTimeS: number;
  isFiring: boolean;
  slowMotion: boolean;
  isDraggingPart: boolean;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  userOrbitedRef: React.MutableRefObject<boolean>;
}) {
  const { camera, size } = useThree();
  const desiredPos = useRef(new THREE.Vector3(-58, 15.2, 42));
  const desiredTarget = useRef(new THREE.Vector3(18, 11.2, -1.2));

  const hasSettledImpact =
    Boolean(activeResult) &&
    !isFiring &&
    playbackTimeS >= (activeResult?.impactTimeS ?? Infinity);

  // Resetujemy flagę ręcznego obrotu przy zmianie trybu kamery, misji lub starcie strzału
  useEffect(() => {
    userOrbitedRef.current = false;
  }, [cameraMode, mission.id, isFiring, userOrbitedRef]);

  // Przesunięcie osi optycznej (tilt-shift viewOffset), aby środek ciężkości sceny
  // mieścił się czysto w oknie między górnym paskiem a dolnym pulpitem sterowania!
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const isMobileNarrow = size.width < 640;
    const isShortMobile = isMobileNarrow && size.height < 720;
    const useHudOffset =
      !isFiring && (cameraMode === "auto" || cameraMode === "trebuchet");

    if (useHudOffset) {
      const yFrac = isShortMobile ? 0.215 : isMobileNarrow ? 0.205 : 0.11;
      const yOffset = Math.round(size.height * yFrac);
      camera.setViewOffset(size.width, size.height, 0, yOffset, size.width, size.height);
    } else {
      camera.clearViewOffset();
    }

    if (cameraMode === "overview") {
      camera.fov = isMobileNarrow ? 36 : 33;
    } else if (cameraMode === "prong_zoom") {
      camera.fov = 26;
    } else {
      camera.fov = isMobileNarrow ? 36 : 32;
    }
    camera.updateProjectionMatrix();

    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, size.width, size.height, isFiring, cameraMode]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    // Nie ruszamy kamery pod palcem gracza, gdy przeciąga on uchwyt 3D!
    if (isDraggingPart) return;

    const pose = sampleTrebuchetPose(activeResult, playbackTimeS, config, isFiring);
    const isMobile = size.width < 640;
    const activeTracking =
      (isFiring && (cameraMode === "auto" || cameraMode === "follow")) ||
      cameraMode === "prong_zoom";

    if (!activeTracking && userOrbitedRef.current) {
      return;
    }

    if (cameraMode === "prong_zoom") {
      // Makro-zbliżenie na żelazny palec spustowy na czubku belki i ześlizgujący się pierścień
      desiredTarget.current.set(pose.tipX + 0.35, pose.tipY - 0.05, 0);
      desiredPos.current.set(
        pose.tipX - 1.25,
        pose.tipY + 0.55,
        isMobile ? 6.0 : 4.65
      );
    } else if (cameraMode === "overview") {
      // Szeroka panorama pola bitwy od obozu (-32 m) po zamek krzyżacki (+castleDistanceM)
      const midX = mission.castleDistanceM * 0.42;
      const span = mission.castleDistanceM + 70;
      const distZ = isMobile ? span * 1.38 : span * 0.78;
      desiredTarget.current.set(midX, 11.5, 0);
      desiredPos.current.set(midX - 12, 28, distZ);
    } else if (
      cameraMode === "follow" ||
      (cameraMode === "auto" && (isFiring || hasSettledImpact))
    ) {
      if ((!isFiring && !hasSettledImpact) || !activeResult) {
        // Skupienie na koszu procy w korycie startowym
        desiredTarget.current.set(pose.projX + 4, pose.projY + 2.5, 0);
        desiredPos.current.set(pose.projX - 18, 6.2, isMobile ? 12 : 14);
      } else {
        const relT = activeResult.releaseTimeS;
        const impT = activeResult.impactTimeS;

        if (playbackTimeS <= relT + 0.06) {
          // Faza 1: Rozpędzanie ramienia i smagnięcie procy przez pion
          desiredTarget.current.set(
            pose.tipX * 0.45 + pose.projX * 0.55,
            Math.max(5.5, pose.tipY * 0.5 + pose.projY * 0.5),
            0
          );
          desiredPos.current.set(-34, 13.0, isMobile ? 18.5 : 23.0);
        } else if (playbackTimeS < impT) {
          // Faza 2: Dynamiczna Kamera Kuli (Bullet-Cam) lecąca za wirującym głazem
          // (w stronę zamku +X albo w tył na własny obóz -X przy samobóju!)
          const dirX = pose.projVx < -1.0 ? -1 : 1;
          desiredPos.current.set(
            pose.projX - dirX * (isMobile ? 19.5 : 16.5),
            Math.max(2.8, pose.projY + 2.6),
            isMobile ? 8.8 : 10.2
          );
          desiredTarget.current.set(
            pose.projX + dirX * 26,
            Math.max(1.6, pose.projY - 1.1),
            0
          );
        } else {
          // Faza 3: Uderzenie w mur / Gdanisko / fosę / kocioł w obozie + zatrzymanie na wyłomie po strzale!
          const dirX = activeResult.impactDistanceM < -4 ? -1 : 1;
          const ix = activeResult.impactDistanceM;
          const iy = Math.max(1.4, activeResult.impactHeightM);
          desiredPos.current.set(
            ix - dirX * (isMobile ? 27 : 23),
            Math.max(4.8, iy + 4.2),
            isMobile ? 14.0 : 16.5
          );
          desiredTarget.current.set(ix, iy + (hasSettledImpact ? 1.2 : 0), 0);
        }
      }
    } else {
      // Spoczynkowy kadr heroiczny ("trebuchet" lub "auto" przed strzałem):
      // Pełna sylwetka 15,9-metrowej blidy od kołowrotu i palca po koryto + zamek krzyżacki na horyzoncie!
      const beamUprightLift = activeResult && playbackTimeS > 0 ? 3.4 : 0;
      if (isMobile) {
        desiredPos.current.set(-66.0, 15.0 + beamUprightLift * 0.6, 18.5);
        desiredTarget.current.set(24.0, 10.2 + beamUprightLift, -0.8);
      } else {
        desiredPos.current.set(-58.0, 15.2 + beamUprightLift * 0.6, 42.0);
        desiredTarget.current.set(18.0, 11.2 + beamUprightLift, -1.2);
      }
    }

    const lerpRate = activeTracking ? (slowMotion ? 5.5 : 8.5) : 5.0;
    const alpha = 1 - Math.exp(-lerpRate * dt);

    camera.position.lerp(desiredPos.current, alpha);
    if (controlsRef.current) {
      controlsRef.current.target.lerp(desiredTarget.current, alpha);
      controlsRef.current.update();
    } else {
      camera.lookAt(desiredTarget.current);
    }

    // Efekt wstrząsu kamery (camera shake) w momencie uderzenia głazu!
    if (activeResult && isFiring && playbackTimeS >= activeResult.impactTimeS) {
      const dtImpact = playbackTimeS - activeResult.impactTimeS;
      if (dtImpact >= 0 && dtImpact < 1.15) {
        const energyFactor = Math.min(1.6, Math.max(0.45, activeResult.kineticEnergyKj / 140));
        const decay = Math.exp(-dtImpact * 5.2);
        const amp = 0.42 * energyFactor * decay;
        const t = state.clock.elapsedTime * 46;
        camera.position.x += Math.sin(t * 1.1) * amp;
        camera.position.y += Math.cos(t * 1.37) * amp * 0.85;
        camera.position.z += Math.sin(t * 0.83) * amp * 0.55;
      }
    }
  });

  return null;
}

/**
 * Bezpieczny, w pełni interaktywny widok 2D SVG/Canvas uruchamiany wyłącznie przy całkowitym braku WebGL.
 */
function Fallback2DSiegeView<TCapture>({
  config,
  mission,
  activeResult,
  playbackTimeS,
  isFiring,
  ghostFrames,
  ghostLabel,
  onChangeProngAngle,
  onChangeCounterweight,
  onPullTrigger,
  onFirstInteract,
  canvasCaptureRef,
}: TrebuchetCanvasProps<TCapture>) {
  const pose = sampleTrebuchetPose(activeResult, playbackTimeS, config, isFiring);

  useEffect(() => {
    if (!canvasCaptureRef) return;
    const captureFallback = async (): Promise<ImageBitmap | null> => {
      if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
        return null;
      }
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 540;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const grad = ctx.createLinearGradient(0, 0, 0, 540);
      grad.addColorStop(0, "#0b1222");
      grad.addColorStop(0.72, "#7c3b1e");
      grad.addColorStop(1, "#1a1814");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = "#2b251c";
      ctx.fillRect(0, 430, 960, 110);
      return await createImageBitmap(c);
    };
    canvasCaptureRef.current = captureFallback as unknown as TCapture;
    return () => {
      canvasCaptureRef.current = null;
    };
  }, [canvasCaptureRef]);

  const mapX = (wx: number) => 150 + ((wx + 40) / (mission.castleDistanceM + 70)) * 640;
  const mapY = (wy: number) => 380 - wy * 5.2;

  const ghostPath = useMemo(() => {
    if (!ghostFrames || ghostFrames.length < 2) return "";
    return ghostFrames
      .map((p, idx) => `${idx === 0 ? "M" : "L"}${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`)
      .join(" ");
  }, [ghostFrames, mission.castleDistanceM]);

  const shotPath = useMemo(() => {
    if (!activeResult || activeResult.frames.length < 2) return "";
    return activeResult.frames
      .filter((f) => f.t <= Math.max(0.05, playbackTimeS))
      .map((f, idx) => `${idx === 0 ? "M" : "L"}${mapX(f.projX).toFixed(1)},${mapY(f.projY).toFixed(1)}`)
      .join(" ");
  }, [activeResult, playbackTimeS, mission.castleDistanceM]);

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-gradient-to-b from-[#0d1424] via-[#2b2236] to-[#1d1915] select-none">
      <svg
        viewBox="0 0 840 460"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grunt i fosa */}
        <rect x="0" y="380" width="840" height="80" fill="#231f18" />
        <rect
          x={mapX(mission.castleDistanceM - 15)}
          y="380"
          width="24"
          height="14"
          fill="#17303a"
        />

        {/* Obóz oblężniczy (-X) */}
        <polygon
          points={`${mapX(-28)},380 ${mapX(-24)},352 ${mapX(-20)},380`}
          fill="#b91c1c"
        />
        <circle cx={mapX(-24)} cy="375" r="5" fill="#434850" />

        {/* Zamek krzyżacki i Gdanisko (+X) */}
        <rect
          x={mapX(mission.castleDistanceM)}
          y={mapY(16)}
          width="36"
          height={380 - mapY(16)}
          fill="#9e3b28"
        />
        <rect
          x={mapX(mission.castleDistanceM - 8)}
          y={mapY(14)}
          width="10"
          height={380 - mapY(14)}
          fill="#853020"
        />
        <circle
          cx={mapX(mission.castleDistanceM)}
          cy={mapY(mission.targetCenterYM)}
          r="11"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2.5"
        />

        {/* Duch Rywala */}
        {ghostPath && (
          <path
            d={ghostPath}
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            opacity="0.7"
          />
        )}

        {/* Smuga strzału */}
        {shotPath && (
          <path d={shotPath} fill="none" stroke="#fef08a" strokeWidth="3" />
        )}

        {/* Kozioł trebusza i belka */}
        <polygon
          points={`${mapX(-6)},380 ${mapX(0)},${mapY(AXLE_HEIGHT_M)} ${mapX(6)},380`}
          fill="none"
          stroke="#8b5e34"
          strokeWidth="4"
        />
        <line
          x1={mapX(pose.shortTipX)}
          y1={mapY(pose.shortTipY)}
          x2={mapX(pose.tipX)}
          y2={mapY(pose.tipY)}
          stroke="#b07d4b"
          strokeWidth="4"
        />
        <rect
          x={mapX(pose.worldBoxX) - 7}
          y={mapY(pose.worldBoxY) - 7}
          width="14"
          height="14"
          fill="#4b3624"
          stroke="#eab344"
          strokeWidth="1.5"
        />
        <circle
          cx={mapX(pose.projX)}
          cy={mapY(pose.projY)}
          r="5"
          fill={config.projectileId === "smola_85" ? "#ff7b00" : "#9ca3af"}
        />
      </svg>

      {/* Kompaktowy pasek awaryjnej interakcji 2D */}
      <div className="pointer-events-auto absolute top-3 left-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-stone-950/80 px-3 py-2 text-xs text-stone-200 backdrop-blur-md">
        <span className="font-mono text-amber-300">
          Tryb schematu 2D {ghostLabel ? `• ${ghostLabel}` : ""}
        </span>
        <button
          type="button"
          disabled={isFiring}
          onClick={() => {
            onFirstInteract?.();
            onChangeProngAngle(Math.max(0, config.prongAngleDeg - 5));
          }}
          className="rounded bg-stone-800 px-2 py-1 hover:bg-stone-700 disabled:opacity-40"
        >
          Palec -5°
        </button>
        <button
          type="button"
          disabled={isFiring}
          onClick={() => {
            onFirstInteract?.();
            onChangeProngAngle(Math.min(80, config.prongAngleDeg + 5));
          }}
          className="rounded bg-stone-800 px-2 py-1 hover:bg-stone-700 disabled:opacity-40"
        >
          Palec +5°
        </button>
        <button
          type="button"
          disabled={isFiring}
          onClick={() => {
            onFirstInteract?.();
            onChangeCounterweight(
              config.counterweightMassKg >= 16000 ? 3000 : config.counterweightMassKg + 1000
            );
          }}
          className="rounded bg-stone-800 px-2 py-1 hover:bg-stone-700 disabled:opacity-40"
        >
          Skrzynia {(config.counterweightMassKg / 1000).toFixed(1).replace(".", ",")} t
        </button>
        <button
          type="button"
          disabled={isFiring}
          onClick={() => {
            onFirstInteract?.();
            onPullTrigger();
          }}
          className="rounded bg-red-700 px-2.5 py-1 font-semibold text-amber-100 hover:bg-red-600 disabled:opacity-40"
        >
          Zwolnij spust!
        </button>
      </div>
    </div>
  );
}

export function TrebuchetCanvas<TCapture = CanvasCaptureFn>(
  props: TrebuchetCanvasProps<TCapture>
) {
  const {
    config,
    mission,
    activeResult,
    playbackTimeS,
    isFiring,
    slowMotion = false,
    showVectors = false,
    cameraMode = "auto",
    ghostFrames = null,
    ghostLabel = null,
    onChangeProngAngle,
    onChangeCounterweight,
    onPullTrigger,
    onFirstInteract,
    canvasCaptureRef,
  } = props;

  const [webglSupported, setWebglSupported] = useState(true);
  const [isDraggingPart, setIsDraggingPart] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const userOrbitedRef = useRef(false);

  useEffect(() => {
    setWebglSupported(detectWebGLSupport());
  }, []);

  const handleFirstInteract = useCallback(() => {
    setHasInteracted(true);
    onFirstInteract?.();
  }, [onFirstInteract]);

  const fallbackNode = <Fallback2DSiegeView {...props} />;

  if (!webglSupported) {
    return fallbackNode;
  }

  const controlsEnabled =
    !isDraggingPart &&
    !(isFiring && (cameraMode === "auto" || cameraMode === "follow"));

  return (
    <WebGLErrorBoundary fallback={fallbackNode}>
      <div className="relative h-full w-full touch-none overflow-hidden select-none">
        <Canvas
          shadows="percentage"
          dpr={[1, 2]}
          camera={{ position: [-58, 15.2, 42], fov: 32, near: 0.4, far: 650 }}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
          }}
        >
          {/* Atmosferyczna mgła zmierzchowa */}
          <fog attach="fog" args={["#1d1b29", 95, 445]} />

          {/* Proceduralne niebo zmierzchowe */}
          <SiegeTwilightSky />

          {/* Proceduralna mapa środowiskowa PBR (0 plików .hdr, 1 wypalenie na starcie!) */}
          <Environment resolution={256} frames={1}>
            {/* Zachodzące słońce nad horyzontem */}
            <Lightformer
              form="rect"
              intensity={3.4}
              color="#ff9447"
              scale={[24, 6, 1]}
              position={[35, 6, -12]}
              target={[0, 0, 0]}
            />
            {/* Chłodny błękit zenitu */}
            <Lightformer
              form="ring"
              intensity={1.1}
              color="#5b7aa6"
              scale={[30, 30, 1]}
              position={[0, 32, 0]}
              rotation={[Math.PI * 0.5, 0, 0]}
            />
            {/* Ciepły odblask ognisk i pochodni od dołu */}
            <Lightformer
              form="rect"
              intensity={1.25}
              color="#d97706"
              scale={[18, 10, 1]}
              position={[-22, -4, 10]}
              target={[0, 6, 0]}
            />
          </Environment>

          {/* Oświetlenie sceny: niskie słońce o zachodzie + wypełnienie nieba + blask pochodni przy blidzie */}
          <hemisphereLight args={["#7c93bd", "#36281c", 0.68]} />
          <directionalLight
            position={[68, 34, 42]}
            intensity={2.65}
            color="#ffb56b"
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0004}
            shadow-camera-near={10}
            shadow-camera-far={240}
            shadow-camera-left={-42}
            shadow-camera-right={42}
            shadow-camera-top={32}
            shadow-camera-bottom={-12}
          />
          {/* Ciepły blask pochodni saperskiej oświetlający palec spustowy i sznur z przodu */}
          <pointLight
            position={[-9.5, 4.2, 4.2]}
            color="#ff8c2b"
            intensity={11}
            distance={24}
            decay={2}
          />
          {/* Ciepłe kontrowe światło wydobywające bryłę dębowej skrzyni przeciwwagi i głazów na tle zmierzchu */}
          <pointLight
            position={[4.2, 10.8, 5.2]}
            color="#ffb36b"
            intensity={8.5}
            distance={18}
            decay={2}
          />

          {/* Historyczna 15,9-metrowa blida przeciwwagowa z uchwytami 3D */}
          <TrebuchetModel
            config={config}
            activeResult={activeResult}
            playbackTimeS={playbackTimeS}
            isFiring={isFiring}
            showVectors={showVectors}
            hasInteracted={hasInteracted}
            isProngZoom={cameraMode === "prong_zoom"}
            onChangeProngAngle={onChangeProngAngle}
            onChangeCounterweight={onChangeCounterweight}
            onPullTrigger={onPullTrigger}
            onFirstInteract={handleFirstInteract}
            onDragStateChange={setIsDraggingPart}
          />

          {/* Zamek krzyżacki z Gdaniskiem i hurdycjami (+X) oraz obóz z kotłem grochówki (-X) */}
          <FortressAndCamp
            mission={mission}
            config={config}
            activeResult={activeResult}
            playbackTimeS={playbackTimeS}
            isFiring={isFiring}
          />

          {/* Smuga lotu oraz złota parabola Ducha Rywala */}
          <TrajectoryArcs
            activeResult={activeResult}
            playbackTimeS={playbackTimeS}
            isFiring={isFiring}
            isIncendiary={config.projectileId === "smola_85"}
            ghostFrames={ghostFrames}
            ghostLabel={ghostLabel}
          />

          {/* Kontrola kamery i OrbitControls bez uciekania panowania */}
          <OrbitControls
            ref={controlsRef}
            enabled={controlsEnabled}
            enablePan={false}
            enableDamping
            dampingFactor={0.075}
            rotateSpeed={0.65}
            zoomSpeed={0.85}
            minDistance={3.2}
            maxDistance={340}
            minPolarAngle={0.2}
            maxPolarAngle={Math.PI * 0.488}
            onStart={() => {
              userOrbitedRef.current = true;
            }}
          />

          <SiegeCameraRig
            cameraMode={cameraMode}
            config={config}
            mission={mission}
            activeResult={activeResult}
            playbackTimeS={playbackTimeS}
            isFiring={isFiring}
            slowMotion={slowMotion}
            isDraggingPart={isDraggingPart}
            controlsRef={controlsRef}
            userOrbitedRef={userOrbitedRef}
          />

          <CanvasCaptureBridge canvasCaptureRef={canvasCaptureRef} />
        </Canvas>
      </div>
    </WebGLErrorBoundary>
  );
}

export default TrebuchetCanvas;
