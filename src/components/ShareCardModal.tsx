"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Share2,
  ShieldAlert,
  Sparkles,
  Swords,
  X,
} from "lucide-react";
import {
  apiUrl,
  assetUrl,
  BUCKET_COUNT,
  CANONICAL_URL,
  SCORE_CAP,
  type GameModeId,
} from "@/lib/config";
import {
  encodeUnsignedChallenge,
  formatSeedCode,
  resolveRankForScore,
  sanitizeCallsign,
} from "@/lib/challengeCodec";
import type { PlayerRank } from "@/types/trebuchet";

export type ShareCardFormat = "4:5" | "9:16";

export interface ShareCardCommunityData {
  buckets: number[];
  totalRuns: number;
  percentile: number | null;
  avgScore?: number;
  maxScore?: number;
  gdaniskoHits?: number;
  campBackfires?: number;
}

export interface ShareCardModalProps {
  /** Czy modal jest otwarty (domyślnie true po zamontowaniu) */
  isOpen?: boolean;
  /** Zamknięcie modalu */
  onClose: () => void;
  /** Łączny wynik punktowy kampanii (0..1000) */
  score: number;
  /** Obiekt rangi gracza (gdy pominięty, wyliczany automatycznie z wyniku) */
  rank?: PlayerRank;
  /** Ziarno scenariusza (do kodu #BL-XXXX oraz tokenu ?w=) */
  seed: number;
  /** Tryb gry */
  modeId?: GameModeId;
  /** Najdalszy osiągnięty rzut w metrach [m] */
  maxDistanceM: number;
  /** Maksymalna energia uderzenia / kinetyczna pocisku [kJ] */
  maxKineticEnergyKj: number;
  /** Najlepsza sprawność transferu energii blidy [%] */
  bestEfficiencyPct: number;
  /** Czy trafiono w sekretne krzyżackie Gdanisko */
  gdaniskoHit?: boolean;
  /** Czy oddano samobójczy strzał we własny obóz */
  campBackfire?: boolean;
  /** Łączna liczba skruszonych bloków muru (opcjonalna odznaka) */
  totalBricksDislodged?: number;
  /** Opcjonalne nadpisanie werdyktu Świadka Dziejów */
  customVerdictPl?: string;
  /** Funkcja przechwytująca aktualny kadr z Canvasu 3D WebGL (dataURL) */
  captureBackdrop?: () =>
    | string
    | null
    | undefined
    | Promise<string | null | undefined>;
  /** Opcjonalny gotowy dataURL kadru 3D */
  backdropDataUrl?: string | null;
  /** Dane rozkładu społeczności (gdy brak, modal sam pobierze z GET /api/community) */
  community?: ShareCardCommunityData | null;
  /** Podpisany token wyzwania z POST /api/community (gdy brak, używa encodeUnsignedChallenge) */
  challengeToken?: string | null;
  /** Pełny URL udostępniania (gdy brak, budowany automatycznie z CANONICAL_URL i tokenu) */
  shareUrl?: string | null;
}

const DEFAULT_FALLBACK_BUCKETS: readonly number[] = [
  4, 3, 2, 2, 3, 3, 3, 4, 4, 5, 4, 3, 2, 2, 1, 1, 1, 1, 0, 0,
];

let canvasFontsPromise: Promise<void> | null = null;

function ensureCanvasFontsLoaded(): Promise<void> {
  if (typeof window === "undefined" || typeof FontFace === "undefined") {
    return Promise.resolve();
  }
  if (!canvasFontsPromise) {
    canvasFontsPromise = (async () => {
      const specs = [
        {
          family: "TrebuszPlayfair",
          url: assetUrl("/fonts/PlayfairDisplay-Bold.ttf"),
          weight: "700",
        },
        {
          family: "TrebuszSpace",
          url: assetUrl("/fonts/SpaceGrotesk-SemiBold.ttf"),
          weight: "600",
        },
        {
          family: "TrebuszMono",
          url: assetUrl("/fonts/JetBrainsMono-Bold.ttf"),
          weight: "700",
        },
      ];

      await Promise.allSettled(
        specs.map(async (s) => {
          const face = new FontFace(s.family, `url(${s.url})`, {
            weight: s.weight,
            style: "normal",
          });
          const loaded = await face.load();
          document.fonts.add(loaded);
        })
      );
    })();
  }
  return canvasFontsPromise;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !src) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img);
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw <= 0 || ih <= 0) return;

  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) * 0.5;
  const sy = (ih - sh) * 0.42;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Proceduralne tło nocnego oblężenia (gdy brak kadru WebGL i pliku siege-backdrop.jpg).
 */
function drawProceduralSiegeBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0b0910");
  sky.addColorStop(0.32, "#1c1310");
  sky.addColorStop(0.58, "#29180f");
  sky.addColorStop(1, "#070608");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Łuna pożaru nad zamkiem Zakonu
  const fireGlow = ctx.createRadialGradient(
    w * 0.72,
    h * 0.34,
    20,
    w * 0.72,
    h * 0.34,
    w * 0.55
  );
  fireGlow.addColorStop(0, "rgba(217, 78, 52, 0.36)");
  fireGlow.addColorStop(0.45, "rgba(212, 160, 84, 0.18)");
  fireGlow.addColorStop(1, "rgba(8, 7, 10, 0)");
  ctx.fillStyle = fireGlow;
  ctx.fillRect(0, 0, w, h);

  const horizonY = h * 0.42;

  // Sylwetka gotyckiego zamku po prawej
  ctx.save();
  ctx.fillStyle = "#0b090c";
  ctx.beginPath();
  ctx.moveTo(w * 0.56, horizonY);
  ctx.lineTo(w * 0.56, horizonY - 95);
  ctx.lineTo(w * 0.62, horizonY - 95);
  ctx.lineTo(w * 0.62, horizonY - 145);
  ctx.lineTo(w * 0.65, horizonY - 195);
  ctx.lineTo(w * 0.68, horizonY - 145);
  ctx.lineTo(w * 0.76, horizonY - 145);
  ctx.lineTo(w * 0.78, horizonY - 220);
  ctx.lineTo(w * 0.82, horizonY - 220);
  ctx.lineTo(w * 0.84, horizonY - 130);
  ctx.lineTo(w * 0.94, horizonY - 130);
  ctx.lineTo(w * 0.94, horizonY);
  ctx.closePath();
  ctx.fill();

  // Sylwetka kozłów trebusza po lewej
  ctx.strokeStyle = "rgba(240, 200, 120, 0.22)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w * 0.16, horizonY);
  ctx.lineTo(w * 0.23, horizonY - 150);
  ctx.lineTo(w * 0.3, horizonY);
  ctx.moveTo(w * 0.15, horizonY - 95);
  ctx.lineTo(w * 0.34, horizonY - 210);
  ctx.stroke();

  // Złota parabola lotu pocisku
  ctx.strokeStyle = "rgba(240, 200, 120, 0.35)";
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(w * 0.34, horizonY - 210);
  ctx.quadraticCurveTo(w * 0.54, horizonY - 340, w * 0.74, horizonY - 140);
  ctx.stroke();
  ctx.restore();
}

function drawArchivalGuillocheFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  ctx.save();

  // Zewnętrzna mosiężna ramka
  ctx.strokeStyle = "rgba(212, 160, 84, 0.62)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 20);
  ctx.stroke();

  // Wewnętrzna cienka linia giloszowa
  ctx.strokeStyle = "rgba(240, 200, 120, 0.26)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x + 12, y + 12, w - 24, h - 24, 14);
  ctx.stroke();

  // Narożne znaczniki astrolabium
  const corners = [
    [x + 24, y + 24, 1, 1],
    [x + w - 24, y + 24, -1, 1],
    [x + 24, y + h - 24, 1, -1],
    [x + w - 24, y + h - 24, -1, -1],
  ] as const;

  ctx.strokeStyle = "rgba(240, 200, 120, 0.58)";
  ctx.lineWidth = 2;
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * 18);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * 18, cy);
    ctx.stroke();
  }

  // Subtelna rozeta hipotrochoidalna w tle środka karty
  ctx.translate(x + w / 2, y + h * 0.46);
  ctx.strokeStyle = "rgba(212, 160, 84, 0.055)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const R = w * 0.27;
  const r = w * 0.092;
  const d = w * 0.155;
  for (let i = 0; i <= 720; i++) {
    const t = (i / 720) * Math.PI * 2 * 17;
    const px = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const py = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        const rest = [current, ...words.slice(i + 1)].join(" ");
        let truncated = rest;
        while (
          truncated.length > 4 &&
          ctx.measureText(`${truncated}…`).width > maxWidth
        ) {
          truncated = truncated.slice(0, -1).trimEnd();
        }
        lines.push(truncated === rest ? rest : `${truncated}…`);
        return lines;
      }
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, maxLines);
}

function computeLocalPercentile(buckets: readonly number[], score: number): number {
  const total = buckets.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return Math.max(1, Math.min(99, Math.round((score / SCORE_CAP) * 98 + 1)));
  const bIdx = Math.max(0, Math.min(BUCKET_COUNT - 1, Math.floor(score / 50)));
  let below = 0;
  for (let i = 0; i < bIdx; i++) below += Math.max(0, buckets[i] ?? 0);
  const frac = Math.max(0, Math.min(1, (score - bIdx * 50) / 50));
  const raw = ((below + (buckets[bIdx] ?? 0) * frac) / total) * 100;
  return Math.max(1, Math.min(99, Math.round(raw)));
}

export function ShareCardModal({
  isOpen = true,
  onClose,
  score,
  rank: rankProp,
  seed,
  modeId = "kampania",
  maxDistanceM,
  maxKineticEnergyKj,
  bestEfficiencyPct,
  gdaniskoHit = false,
  campBackfire = false,
  totalBricksDislodged,
  customVerdictPl,
  captureBackdrop,
  backdropDataUrl,
  community: communityProp,
  challengeToken: challengeTokenProp,
  shareUrl: shareUrlProp,
}: ShareCardModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [format, setFormat] = useState<ShareCardFormat>("4:5");
  const [rawCallsign, setRawCallsign] = useState<string>("");
  const [fontsReadyTick, setFontsReadyTick] = useState(0);

  const [backdropImg, setBackdropImg] = useState<HTMLImageElement | null>(null);
  const [portraitImg, setPortraitImg] = useState<HTMLImageElement | null>(null);
  const [fetchedCommunity, setFetchedCommunity] =
    useState<ShareCardCommunityData | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const clampedScore = Math.max(0, Math.min(SCORE_CAP, Math.round(score)));
  const effectiveRank = useMemo(
    () => rankProp ?? resolveRankForScore(clampedScore),
    [rankProp, clampedScore]
  );
  const seedCode = useMemo(() => formatSeedCode(seed), [seed]);

  // Lokalna walidacja podpisu na karcie PNG (biała lista znaków PL + blokada wulgaryzmów)
  const sanitizedLocalCallsign = useMemo(() => {
    const trimmed = rawCallsign.trim();
    if (!trimmed) return undefined;
    return sanitizeCallsign(trimmed);
  }, [rawCallsign]);

  const callsignRejected = rawCallsign.trim().length >= 2 && !sanitizedLocalCallsign;

  const activeCommunity = communityProp ?? fetchedCommunity;
  const buckets = useMemo(() => {
    if (activeCommunity && activeCommunity.buckets.length === BUCKET_COUNT) {
      return activeCommunity.buckets;
    }
    return [...DEFAULT_FALLBACK_BUCKETS];
  }, [activeCommunity]);

  const totalRuns = useMemo(() => {
    if (activeCommunity && activeCommunity.totalRuns > 0) {
      return activeCommunity.totalRuns;
    }
    return buckets.reduce((a, b) => a + b, 0);
  }, [activeCommunity, buckets]);

  const percentile = useMemo(() => {
    if (
      activeCommunity &&
      typeof activeCommunity.percentile === "number" &&
      Number.isFinite(activeCommunity.percentile)
    ) {
      return Math.max(1, Math.min(99, Math.round(activeCommunity.percentile)));
    }
    return computeLocalPercentile(buckets, clampedScore);
  }, [activeCommunity, buckets, clampedScore]);

  const effectiveToken = useMemo(() => {
    if (challengeTokenProp && challengeTokenProp.trim().length > 0) {
      return challengeTokenProp.trim();
    }
    return encodeUnsignedChallenge({
      v: 1,
      seed,
      modeId,
      score: clampedScore,
      maxDistM: maxDistanceM,
      gdanisko: gdaniskoHit,
    });
  }, [challengeTokenProp, seed, modeId, clampedScore, maxDistanceM, gdaniskoHit]);

  const effectiveShareUrl = useMemo(() => {
    if (shareUrlProp && shareUrlProp.trim().length > 0) {
      return shareUrlProp.trim();
    }
    return `${CANONICAL_URL}?w=${effectiveToken}`;
  }, [shareUrlProp, effectiveToken]);

  const viralChallengeCopy = useMemo(() => {
    if ((campBackfire && clampedScore < 220) || maxDistanceM < -5) {
      const distLabel =
        maxDistanceM < 0 ? ` (${Math.round(maxDistanceM)} m do tyłu!)` : "";
      return `Zamiast w zamek Zakonu, posłałem 100-kilowy głaz prosto we własny obóz oblężniczy${distLabel} w Wielkim Trebuszu 3D Świadka Dziejów! Sprawdź pod tym samym wiatrem (${seedCode}), czy nie zrobisz tego samego:\n${effectiveShareUrl}`;
    }
    if (gdaniskoHit) {
      return `Trafiłem z 15-metrowej średniowiecznej blidy prosto w krzyżackie Gdanisko i zdobyłem ${clampedScore}/1000 pkt (rzut ${Math.round(
        maxDistanceM
      )} m, lepiej niż ${percentile}% graczy)! Rzucam Ci rękawicę w scenariuszu ${seedCode}:\n${effectiveShareUrl}`;
    }
    return `Zdobyłem ${clampedScore}/1000 pkt jako „${effectiveRank.titlePl}” (najdalszy rzut: ${Math.round(
      maxDistanceM
    )} m, lepiej niż ${percentile}% graczy) w Wielkim Trebuszu 3D Świadka Dziejów! Pobijesz mój wynik pod tym samym wiatrem (${seedCode})?\n${effectiveShareUrl}`;
  }, [
    campBackfire,
    clampedScore,
    maxDistanceM,
    seedCode,
    effectiveShareUrl,
    gdaniskoHit,
    percentile,
    effectiveRank.titlePl,
  ]);

  // Zamknięcie klawiszem Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Wczytanie fontów .ttf do document.fonts pod Canvas 2D
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    ensureCanvasFontsLoaded().then(() => {
      if (alive) setFontsReadyTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  // Wczytanie portretu Świadka Dziejów z fallbackiem
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    (async () => {
      const primary = await loadHtmlImage(assetUrl("/swiadek-portrait.jpg"));
      if (primary) {
        if (alive) setPortraitImg(primary);
        return;
      }
      const fallback = await loadHtmlImage(assetUrl("/swiadek-ref.jpg"));
      if (alive) setPortraitImg(fallback);
    })();
    return () => {
      alive = false;
    };
  }, [isOpen]);

  // Przechwycenie kadru 3D z captureBackdrop() lub fallback do /scenes/siege-backdrop.jpg
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    (async () => {
      let capturedSrc: string | null | undefined = backdropDataUrl;
      if (!capturedSrc && captureBackdrop) {
        try {
          capturedSrc = await captureBackdrop();
        } catch {
          capturedSrc = null;
        }
      }
      if (capturedSrc) {
        const fromCapture = await loadHtmlImage(capturedSrc);
        if (fromCapture) {
          if (alive) setBackdropImg(fromCapture);
          return;
        }
      }
      const staticScene = await loadHtmlImage(assetUrl("/scenes/siege-backdrop.jpg"));
      if (alive) setBackdropImg(staticScene);
    })();
    return () => {
      alive = false;
    };
  }, [isOpen, backdropDataUrl, captureBackdrop]);

  // Automatyczne dociągnięcie rozkładu społeczności, jeśli rodzic nie przekazał `community`
  useEffect(() => {
    if (!isOpen || communityProp) return;
    const controller = new AbortController();
    fetch(apiUrl(`/community?score=${clampedScore}`), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!json || typeof json !== "object") return;
        const data = json as Record<string, unknown>;
        if (Array.isArray(data.buckets) && data.buckets.length === BUCKET_COUNT) {
          setFetchedCommunity({
            buckets: data.buckets.map((n) => (typeof n === "number" ? n : 0)),
            totalRuns: typeof data.totalRuns === "number" ? data.totalRuns : 0,
            percentile: typeof data.percentile === "number" ? data.percentile : null,
            avgScore: typeof data.avgScore === "number" ? data.avgScore : undefined,
            maxScore: typeof data.maxScore === "number" ? data.maxScore : undefined,
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isOpen, communityProp, clampedScore]);

  // Główny renderer karty PNG na HTMLCanvasElement (4:5 = 1080×1350 oraz 9:16 = 1080×1920 z IG Safe Zones!)
  const renderCardToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isStories = format === "9:16";
    const W = 1080;
    const H = isStories ? 1920 : 1350;
    canvas.width = W;
    canvas.height = H;

    // 1. Tło: przechwycony kadr 3D WebGL -> /scenes/siege-backdrop.jpg -> proceduralne oblężenie
    if (backdropImg) {
      drawCoverImage(ctx, backdropImg, 0, 0, W, H);
    } else {
      drawProceduralSiegeBackdrop(ctx, W, H);
    }

    // 2. Kinowa ciemna winieta obsydianowa (gwarantuje kontrast tekstu AAA i eksponuje akcję 3D u góry)
    const vertVignette = ctx.createLinearGradient(0, 0, 0, H);
    if (isStories) {
      vertVignette.addColorStop(0, "rgba(8, 7, 10, 0.86)");
      vertVignette.addColorStop(0.16, "rgba(8, 7, 10, 0.56)");
      vertVignette.addColorStop(0.34, "rgba(8, 7, 10, 0.78)");
      vertVignette.addColorStop(0.65, "rgba(8, 7, 10, 0.92)");
      vertVignette.addColorStop(1, "rgba(6, 5, 7, 0.96)");
    } else {
      vertVignette.addColorStop(0, "rgba(8, 7, 10, 0.74)");
      vertVignette.addColorStop(0.22, "rgba(8, 7, 10, 0.62)");
      vertVignette.addColorStop(0.5, "rgba(8, 7, 10, 0.88)");
      vertVignette.addColorStop(1, "rgba(6, 5, 7, 0.96)");
    }
    ctx.fillStyle = vertVignette;
    ctx.fillRect(0, 0, W, H);

    // Złota poświata radialna w strefie wyniku
    const brassGlow = ctx.createRadialGradient(
      W * 0.5,
      isStories ? 460 : 280,
      30,
      W * 0.5,
      isStories ? 460 : 280,
      520
    );
    brassGlow.addColorStop(0, "rgba(212, 160, 84, 0.22)");
    brassGlow.addColorStop(1, "rgba(212, 160, 84, 0)");
    ctx.fillStyle = brassGlow;
    ctx.fillRect(0, 0, W, H);

    // 3. Strefa bezpieczna i podwójna mosiężna ramka giloszowa
    // W 9:16 (1080×1920): top = 224 >= 220px, bottom = 1666 <= 1670px (100% wewnątrz IG Stories Safe Zones!)
    const frameX = 42;
    const frameW = W - frameX * 2; // 996px
    const frameTop = isStories ? 224 : 38;
    const frameBottom = isStories ? 1666 : 1312;
    const frameH = frameBottom - frameTop;

    drawArchivalGuillocheFrame(ctx, frameX, frameTop, frameW, frameH);

    const serifFont = '"TrebuszPlayfair", Georgia, serif';
    const bodyFont = '"TrebuszSpace", system-ui, sans-serif';
    const monoFont = '"TrebuszMono", ui-monospace, monospace';

    const innerLeft = 78;
    const innerRight = W - 78; // 1002
    const innerW = innerRight - innerLeft; // 924

    // 4. Górny pasek nagłówka + pastylka scenariusza #BL-XXXX
    const headerY = frameTop + (isStories ? 48 : 46);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#d4a054";
    ctx.font = `700 19px ${monoFont}`;
    ctx.fillText(
      "ŚWIADEK DZIEJÓW · WIELKI TREBUSZ 3D",
      innerLeft,
      headerY,
      innerW - 260
    );

    // Pastylka scenariusza po prawej
    const pillText = `SCENARIUSZ ${seedCode}`;
    ctx.font = `700 18px ${monoFont}`;
    const pillW = Math.max(220, ctx.measureText(pillText).width + 36);
    const pillX = innerRight - pillW;
    const pillY = headerY - 19;
    ctx.fillStyle = "rgba(78, 205, 196, 0.14)";
    ctx.strokeStyle = "rgba(78, 205, 196, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, 38, 19);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#7ee8e0";
    ctx.textAlign = "center";
    ctx.fillText(pillText, pillX + pillW / 2, headerY + 1);

    // Linia pod nagłówkiem
    const divider1Y = headerY + 30;
    ctx.strokeStyle = "rgba(212, 160, 84, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerLeft, divider1Y);
    ctx.lineTo(innerRight, divider1Y);
    ctx.stroke();

    // 5. Sekcja Rangi, opcjonalnego zawołania i wielkiego wyniku X / 1000 pkt
    let cursorY = divider1Y + (isStories ? 36 : 30);

    if (sanitizedLocalCallsign) {
      ctx.textAlign = "center";
      ctx.font = `700 18px ${monoFont}`;
      ctx.fillStyle = "#f0c878";
      ctx.fillText(
        `PUSZKARZ: ${sanitizedLocalCallsign.toUpperCase()}`,
        W / 2,
        cursorY,
        innerW - 40
      );
      cursorY += isStories ? 38 : 34;
    } else {
      cursorY += isStories ? 14 : 10;
    }

    // Tytuł rangi
    ctx.textAlign = "center";
    ctx.fillStyle = "#f3ede2";
    ctx.font = `700 ${isStories ? 44 : 42}px ${serifFont}`;
    ctx.fillText(
      `„${effectiveRank.titlePl}”`,
      W / 2,
      cursorY + 14,
      innerW - 24
    );

    // Wielki wynik X / 1000 pkt
    const scoreBaselineY = cursorY + (isStories ? 122 : 114);
    const scoreMainStr = `${clampedScore}`;
    const scoreCapStr = " / 1000 PKT";

    ctx.font = `700 ${isStories ? 108 : 100}px ${serifFont}`;
    const mainW = ctx.measureText(scoreMainStr).width;
    ctx.font = `700 30px ${monoFont}`;
    const capW = ctx.measureText(scoreCapStr).width;
    const totalScoreW = mainW + capW + 8;
    const scoreStartX = (W - totalScoreW) / 2;

    const goldGrad = ctx.createLinearGradient(0, scoreBaselineY - 85, 0, scoreBaselineY + 10);
    goldGrad.addColorStop(0, "#fff4d2");
    goldGrad.addColorStop(0.52, "#f0c878");
    goldGrad.addColorStop(1, "#c88d3a");

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = goldGrad;
    ctx.font = `700 ${isStories ? 108 : 100}px ${serifFont}`;
    ctx.fillText(scoreMainStr, scoreStartX, scoreBaselineY);

    ctx.fillStyle = "#c2b7a6";
    ctx.font = `700 30px ${monoFont}`;
    ctx.fillText(scoreCapStr, scoreStartX + mainW + 8, scoreBaselineY - 10);

    // Wiersz percentyla
    const pctY = scoreBaselineY + (isStories ? 38 : 34);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#4ecdc4";
    ctx.font = `700 21px ${monoFont}`;
    ctx.fillText(
      `Wynik lepszy niż u ${percentile}% graczy społeczności`,
      W / 2,
      pctY,
      innerW - 40
    );

    // 6. Pasek odznak specjalnych
    const badgesY = pctY + (isStories ? 36 : 30);
    const badges: Array<{
      label: string;
      bg: string;
      border: string;
      fg: string;
    }> = [];

    if (gdaniskoHit) {
      badges.push({
        label: "🎯 POGROMCA GDANISKA",
        bg: "rgba(78, 205, 196, 0.16)",
        border: "rgba(126, 232, 224, 0.62)",
        fg: "#7ee8e0",
      });
    }
    if (campBackfire) {
      badges.push({
        label: "💥 SAMOBÓJ W OBÓZ",
        bg: "rgba(217, 78, 52, 0.18)",
        border: "rgba(217, 78, 52, 0.65)",
        fg: "#ff9b87",
      });
    }
    if (clampedScore >= 850) {
      badges.push({
        label: "👑 MISTRZ PALCA SPUSTOWEGO",
        bg: "rgba(240, 200, 120, 0.18)",
        border: "rgba(240, 200, 120, 0.65)",
        fg: "#f0c878",
      });
    }
    if (typeof totalBricksDislodged === "number" && totalBricksDislodged > 0 && badges.length < 3) {
      badges.push({
        label: `🧱 SKRUSZONO ${totalBricksDislodged} BLOKÓW`,
        bg: "rgba(212, 160, 84, 0.14)",
        border: "rgba(212, 160, 84, 0.45)",
        fg: "#f3ede2",
      });
    }
    if (badges.length === 0) {
      const modeName =
        modeId === "dzienny"
          ? "⚔️ WYZWANIE DNIA"
          : modeId === "piaskownica"
          ? "⚙️ EKSPERYMENT FIZYCZNY"
          : "⚔️ KAMPANIA 4 SALW";
      badges.push({
        label: modeName,
        bg: "rgba(212, 160, 84, 0.13)",
        border: "rgba(212, 160, 84, 0.42)",
        fg: "#f0c878",
      });
    }

    ctx.font = `700 17px ${monoFont}`;
    const badgeGap = 14;
    const measuredBadges = badges.slice(0, 3).map((b) => ({
      ...b,
      w: Math.min(340, ctx.measureText(b.label).width + 34),
    }));
    const totalBadgesW =
      measuredBadges.reduce((acc, b) => acc + b.w, 0) +
      Math.max(0, measuredBadges.length - 1) * badgeGap;
    let bx = (W - totalBadgesW) / 2;

    for (const b of measuredBadges) {
      ctx.fillStyle = b.bg;
      ctx.strokeStyle = b.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bx, badgesY, b.w, 38, 19);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = b.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.label, bx + b.w / 2, badgesY + 20, b.w - 18);
      bx += b.w + badgeGap;
    }

    // 7. Trzy kafelki twardej telemetrii balistycznej
    const tilesTop = badgesY + (isStories ? 60 : 54);
    const tileH = isStories ? 164 : 152;
    const tileGap = 18;
    const tileW = (innerW - tileGap * 2) / 3;

    const distFormatted = `${(Number.isFinite(maxDistanceM) ? maxDistanceM : 0)
      .toFixed(1)
      .replace(".", ",")} m`;
    const energyFormatted = `${Math.max(
      0,
      Math.round(Number.isFinite(maxKineticEnergyKj) ? maxKineticEnergyKj : 0)
    )} kJ`;
    const effFormatted = `${Math.max(
      0,
      Math.min(100, Number.isFinite(bestEfficiencyPct) ? bestEfficiencyPct : 0)
    )
      .toFixed(1)
      .replace(".", ",")}%`;

    const telemetryItems = [
      {
        label: "NAJDALSZY RZUT [M]",
        value: distFormatted,
        sub: maxDistanceM < 0 ? "strzał wstecz w obóz!" : "zasięg na osi zamku",
        accent: maxDistanceM < 0 ? "#ff9b87" : "#f0c878",
      },
      {
        label: "ENERGIA UDERZENIA [KJ]",
        value: energyFormatted,
        sub: "kinetyka głazu u celu",
        accent: "#f3ede2",
      },
      {
        label: "SPRAWNOŚĆ BLIDY [%]",
        value: effFormatted,
        sub: "transfer ze skrzyni",
        accent: "#7ee8e0",
      },
    ];

    telemetryItems.forEach((item, idx) => {
      const tx = innerLeft + idx * (tileW + tileGap);
      const tcx = tx + tileW / 2;

      ctx.fillStyle = "rgba(22, 19, 16, 0.78)";
      ctx.strokeStyle = "rgba(212, 160, 84, 0.34)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(tx, tilesTop, tileW, tileH, 14);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = "#c2b7a6";
      ctx.font = `700 15px ${monoFont}`;
      ctx.fillText(item.label, tcx, tilesTop + 30, tileW - 24);

      ctx.fillStyle = item.accent;
      ctx.font = `700 ${isStories ? 44 : 40}px ${serifFont}`;
      ctx.fillText(item.value, tcx, tilesTop + (isStories ? 86 : 80), tileW - 24);

      ctx.fillStyle = "#9e9383";
      ctx.font = `600 17px ${bodyFont}`;
      ctx.fillText(item.sub, tcx, tilesTop + tileH - 26, tileW - 24);
    });

    // 8. 20-słupkowy wykres rozkładu społeczności ze złotym znacznikiem „▼ TY”
    const chartTop = tilesTop + tileH + (isStories ? 26 : 20);
    const chartH = isStories ? 286 : 254;

    ctx.fillStyle = "rgba(16, 13, 11, 0.82)";
    ctx.strokeStyle = "rgba(212, 160, 84, 0.32)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(innerLeft, chartTop, innerW, chartH, 16);
    ctx.fill();
    ctx.stroke();

    // Nagłówek wykresu
    ctx.textAlign = "left";
    ctx.fillStyle = "#d4a054";
    ctx.font = `700 16px ${monoFont}`;
    ctx.fillText(
      "ROZKŁAD WYNIKÓW SPOŁECZNOŚCI (20 KOSZYKÓW)",
      innerLeft + 24,
      chartTop + 28
    );

    ctx.textAlign = "right";
    ctx.fillStyle = "#9e9383";
    ctx.font = `700 15px ${monoFont}`;
    ctx.fillText(
      `n = ${totalRuns.toLocaleString("pl-PL")} kampanii`,
      innerRight - 24,
      chartTop + 28
    );

    const barsLeft = innerLeft + 28;
    const barsRight = innerRight - 28;
    const barsAreaW = barsRight - barsLeft;
    const barGap = 8;
    const barW = (barsAreaW - barGap * (BUCKET_COUNT - 1)) / BUCKET_COUNT;
    const barsBottomY = chartTop + chartH - 38;
    const maxBarHeight = isStories ? 142 : 114;

    const maxBucketVal = Math.max(1, ...buckets);
    const playerBucket = Math.max(
      0,
      Math.min(BUCKET_COUNT - 1, Math.floor(clampedScore / 50))
    );

    for (let i = 0; i < BUCKET_COUNT; i++) {
      const count = Math.max(0, buckets[i] ?? 0);
      const ratio = count / maxBucketVal;
      const bh = Math.max(6, Math.round(ratio * maxBarHeight));
      const bxBar = barsLeft + i * (barW + barGap);
      const byBar = barsBottomY - bh;
      const isPlayer = i === playerBucket;

      if (isPlayer) {
        const activeGrad = ctx.createLinearGradient(0, byBar, 0, barsBottomY);
        activeGrad.addColorStop(0, "#fff2c6");
        activeGrad.addColorStop(0.45, "#f0c878");
        activeGrad.addColorStop(1, "#c88d3a");
        ctx.save();
        ctx.shadowColor = "rgba(240, 200, 120, 0.55)";
        ctx.shadowBlur = 16;
        ctx.fillStyle = activeGrad;
        ctx.beginPath();
        ctx.roundRect(bxBar, byBar, barW, bh, [6, 6, 2, 2]);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(212, 160, 84, 0.25)";
        ctx.beginPath();
        ctx.roundRect(bxBar, byBar, barW, bh, [4, 4, 2, 2]);
        ctx.fill();
      }
    }

    // Złoty znacznik „▼ TY” dokładnie nad słupkiem gracza
    const playerBarCenterX = barsLeft + playerBucket * (barW + barGap) + barW / 2;
    const playerCount = Math.max(0, buckets[playerBucket] ?? 0);
    const playerBarH = Math.max(6, Math.round((playerCount / maxBucketVal) * maxBarHeight));
    const playerBarTopY = barsBottomY - playerBarH;

    const markerLabel = `▼ TY (${clampedScore})`;
    ctx.font = `700 15px ${monoFont}`;
    const markerPillW = ctx.measureText(markerLabel).width + 24;
    const clampedPillCenterX = Math.max(
      barsLeft + markerPillW / 2,
      Math.min(barsRight - markerPillW / 2, playerBarCenterX)
    );
    const markerPillY = Math.max(chartTop + 46, playerBarTopY - 38);

    ctx.fillStyle = "#f0c878";
    ctx.beginPath();
    ctx.roundRect(
      clampedPillCenterX - markerPillW / 2,
      markerPillY,
      markerPillW,
      28,
      14
    );
    ctx.fill();

    ctx.fillStyle = "#08070a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(markerLabel, clampedPillCenterX, markerPillY + 14.5);

    // Oś X pod słupkami
    ctx.strokeStyle = "rgba(243, 237, 226, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barsLeft, barsBottomY + 2);
    ctx.lineTo(barsRight, barsBottomY + 2);
    ctx.stroke();

    ctx.fillStyle = "#9e9383";
    ctx.font = `700 14px ${monoFont}`;
    const axisLabels = [
      { x: barsLeft, text: "0 pkt", align: "left" as const },
      { x: barsLeft + barsAreaW * 0.25, text: "250", align: "center" as const },
      { x: barsLeft + barsAreaW * 0.5, text: "500", align: "center" as const },
      { x: barsLeft + barsAreaW * 0.75, text: "750", align: "center" as const },
      { x: barsRight, text: "1000 pkt", align: "right" as const },
    ];
    for (const tick of axisLabels) {
      ctx.textAlign = tick.align;
      ctx.fillText(tick.text, tick.x, chartTop + chartH - 16);
    }

    // 9. Medalion Świadka Dziejów + werdykt w polskich cudzysłowach „…”
    const verdictTop = chartTop + chartH + (isStories ? 26 : 20);
    const verdictH = isStories ? 236 : 204;

    ctx.fillStyle = "rgba(212, 160, 84, 0.08)";
    ctx.strokeStyle = "rgba(212, 160, 84, 0.42)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(innerLeft, verdictTop, innerW, verdictH, 16);
    ctx.fill();
    ctx.stroke();

    const medRadius = isStories ? 72 : 64;
    const medCenterX = innerLeft + 34 + medRadius;
    const medCenterY = verdictTop + verdictH / 2;

    // Złoty pierścień medalionu
    const ringGrad = ctx.createLinearGradient(
      medCenterX - medRadius,
      medCenterY - medRadius,
      medCenterX + medRadius,
      medCenterY + medRadius
    );
    ringGrad.addColorStop(0, "#fff2c6");
    ringGrad.addColorStop(0.5, "#d4a054");
    ringGrad.addColorStop(1, "#6d4c1d");

    ctx.beginPath();
    ctx.arc(medCenterX, medCenterY, medRadius + 5, 0, Math.PI * 2);
    ctx.fillStyle = ringGrad;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(medCenterX, medCenterY, medRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (portraitImg) {
      drawCoverImage(
        ctx,
        portraitImg,
        medCenterX - medRadius,
        medCenterY - medRadius,
        medRadius * 2,
        medRadius * 2
      );
    } else {
      ctx.fillStyle = "#161310";
      ctx.fillRect(
        medCenterX - medRadius,
        medCenterY - medRadius,
        medRadius * 2,
        medRadius * 2
      );
      ctx.fillStyle = "#f0c878";
      ctx.font = `700 44px ${serifFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ŚD", medCenterX, medCenterY);
    }
    ctx.restore();

    // Tekst werdyktu w polskich cudzysłowach „…”
    const quoteLeft = medCenterX + medRadius + 30;
    const quoteMaxW = innerRight - 28 - quoteLeft;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#d4a054";
    ctx.font = `700 16px ${monoFont}`;
    ctx.fillText("WERDYKT ŚWIADKA DZIEJÓW", quoteLeft, verdictTop + 34, quoteMaxW);

    const rawVerdict = (customVerdictPl || effectiveRank.swiadekVerdictPl)
      .replace(/^[„"«]+|[”"»]+$/g, "")
      .trim();
    const polishQuotedVerdict = `„${rawVerdict}”`;

    ctx.fillStyle = "#f3ede2";
    ctx.font = `600 ${isStories ? 25 : 23}px ${bodyFont}`;
    const wrappedQuote = wrapCanvasLines(ctx, polishQuotedVerdict, quoteMaxW, 4);
    const lineH = isStories ? 34 : 31;
    const quoteBlockStartY = verdictTop + 72;
    wrappedQuote.forEach((line, idx) => {
      ctx.fillText(line, quoteLeft, quoteBlockStartY + idx * lineH, quoteMaxW);
    });

    // 10. Dolny pasek stopki z adresem swiadek-dziejow.pl/wielki-trebusz
    const footerY = frameBottom - (isStories ? 38 : 34);
    ctx.strokeStyle = "rgba(212, 160, 84, 0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerLeft, footerY - 26);
    ctx.lineTo(innerRight, footerY - 26);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c2b7a6";
    ctx.font = `600 18px ${bodyFont}`;
    ctx.fillText(
      `Zmierz się w tym samym scenariuszu (${seedCode}):`,
      innerLeft,
      footerY,
      innerW * 0.54
    );

    ctx.textAlign = "right";
    ctx.fillStyle = "#f0c878";
    ctx.font = `700 21px ${monoFont}`;
    ctx.fillText("swiadek-dziejow.pl/wielki-trebusz", innerRight, footerY);
  }, [
    format,
    backdropImg,
    seedCode,
    sanitizedLocalCallsign,
    effectiveRank,
    clampedScore,
    percentile,
    gdaniskoHit,
    campBackfire,
    totalBricksDislodged,
    modeId,
    maxDistanceM,
    maxKineticEnergyKj,
    bestEfficiencyPct,
    totalRuns,
    buckets,
    portraitImg,
    customVerdictPl,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    renderCardToCanvas();
  }, [isOpen, renderCardToCanvas, fontsReadyTick]);

  const exportCanvasBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        resolve(null);
        return;
      }
      try {
        canvas.toBlob((blob) => resolve(blob), "image/png", 1);
      } catch {
        resolve(null);
      }
    });
  }, []);

  const handleDownloadPng = useCallback(async () => {
    setIsExporting(true);
    setShareStatus(null);
    try {
      renderCardToCanvas();
      const blob = await exportCanvasBlob();
      if (!blob) {
        setShareStatus("Nie udało się wygenerować pliku PNG.");
        return;
      }
      const cleanSeed = seedCode.replace("#", "").toLowerCase();
      const aspectSlug = format === "9:16" ? "stories-9x16" : "post-4x5";
      const filename = `wielki-trebusz-${clampedScore}pkt-${cleanSeed}-${aspectSlug}.png`;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setShareStatus("Pobrano kartę PNG w pełnej rozdzielczości.");
    } finally {
      setIsExporting(false);
    }
  }, [exportCanvasBlob, format, clampedScore, renderCardToCanvas, seedCode]);

  const handleCopyChallengeLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(viralChallengeCopy);
      setCopiedLink(true);
      setShareStatus("Skopiowano wiralowe wyzwanie z linkiem pojedynku!");
      setTimeout(() => setCopiedLink(false), 2600);
    } catch {
      setShareStatus("Nie udało się skopiować automatycznie — zaznacz link poniżej.");
    }
  }, [viralChallengeCopy]);

  const handleNativeShare = useCallback(async () => {
    setIsExporting(true);
    setShareStatus(null);
    try {
      renderCardToCanvas();
      const blob = await exportCanvasBlob();
      const cleanSeed = seedCode.replace("#", "").toLowerCase();
      const filename = `swiadek-dziejow-trebusz-${cleanSeed}.png`;

      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        if (blob && typeof File !== "undefined") {
          const pngFile = new File([blob], filename, { type: "image/png" });
          const shareDataWithFile: ShareData = {
            title: `Wielki Trebusz 3D — ${clampedScore}/1000 pkt (${seedCode})`,
            text: viralChallengeCopy,
            files: [pngFile],
          };
          if (
            typeof navigator.canShare === "function" &&
            navigator.canShare({ files: [pngFile] })
          ) {
            await navigator.share(shareDataWithFile);
            setShareStatus("Wysłano kartę i link wyzwania!");
            return;
          }
        }

        await navigator.share({
          title: `Wielki Trebusz 3D — ${clampedScore}/1000 pkt (${seedCode})`,
          text: viralChallengeCopy,
          url: effectiveShareUrl,
        });
        setShareStatus("Udostępniono wyzwanie!");
        return;
      }

      // Fallback na desktopie bez Web Share API: skopiuj wyzwanie
      await handleCopyChallengeLink();
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") {
        return;
      }
      await handleCopyChallengeLink();
    } finally {
      setIsExporting(false);
    }
  }, [
    clampedScore,
    effectiveShareUrl,
    exportCanvasBlob,
    handleCopyChallengeLink,
    renderCardToCanvas,
    seedCode,
    viralChallengeCopy,
  ]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Eksport karty wyniku i wyzwanie znajomych"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-3 sm:p-5 backdrop-blur-md overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-5xl rounded-2xl bg-[#120e0b] archival-frame text-[#f3ede2] overflow-hidden">
        {/* Górny pasek modalu */}
        <div className="flex items-center justify-between gap-3 border-b border-[#d4a054]/25 bg-[#08070a]/75 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Swords className="h-5 w-5 text-[#d4a054]" aria-hidden="true" />
            <div>
              <h2 className="font-serif-brand text-lg sm:text-xl font-bold text-[#f3ede2]">
                Rzuć Rękawicę i Pobierz Kartę Oblężniczą
              </h2>
              <p className="text-xs text-[#9e9383] font-mono-brand">
                Scenariusz {seedCode} · Identyczny wiatr i cele dla Twojego rywala
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno udostępniania"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#d4a054]/30 bg-[#161310] text-[#c2b7a6] transition hover:border-[#f0c878] hover:text-[#f3ede2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Zawartość: lewa kolumna podglądu Canvas + prawa kolumna akcji */}
        <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-12">
          {/* Podgląd karty na żywo */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center rounded-xl border border-[#d4a054]/20 bg-[#08070a] p-3 sm:p-4">
            <div className="mb-2.5 flex w-full items-center justify-between text-xs font-mono-brand text-[#9e9383]">
              <span>
                PODGLĄD PNG ({format === "4:5" ? "1080 × 1350 px" : "1080 × 1920 px"})
              </span>
              {format === "9:16" ? (
                <span className="text-[#4ecdc4]">IG Stories Safe-Zone ✓</span>
              ) : (
                <span className="text-[#d4a054]">FB / X / Discord ✓</span>
              )}
            </div>

            <div className="relative flex w-full items-center justify-center">
              <canvas
                ref={canvasRef}
                className={`w-auto rounded-lg border border-[#d4a054]/35 shadow-2xl ${
                  format === "9:16"
                    ? "max-h-[440px] sm:max-h-[520px]"
                    : "max-h-[420px] sm:max-h-[500px]"
                } max-w-full`}
              />
            </div>
          </div>

          {/* Panel sterowania i przycisków wiralowych */}
          <div className="lg:col-span-6 flex flex-col justify-between gap-4">
            <div className="space-y-4">
              {/* Przełącznik formatu 4:5 vs 9:16 */}
              <div>
                <span className="mb-2 block text-xs font-mono-brand uppercase tracking-wider text-[#c2b7a6]">
                  1. Wybierz proporcje karty PNG
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setFormat("4:5")}
                    aria-pressed={format === "4:5"}
                    className={`min-h-[46px] rounded-xl border px-3.5 py-2.5 text-left transition ${
                      format === "4:5"
                        ? "border-[#f0c878] bg-[#d4a054]/20 text-[#f3ede2] brass-glow"
                        : "border-[#d4a054]/25 bg-[#161310] text-[#c2b7a6] hover:border-[#d4a054]/55"
                    }`}
                  >
                    <div className="font-mono-brand text-sm font-bold text-[#f0c878]">
                      4:5 (Post)
                    </div>
                    <div className="text-xs text-[#c2b7a6]">
                      1080×1350 · FB, X, Discord
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormat("9:16")}
                    aria-pressed={format === "9:16"}
                    className={`min-h-[46px] rounded-xl border px-3.5 py-2.5 text-left transition ${
                      format === "9:16"
                        ? "border-[#f0c878] bg-[#d4a054]/20 text-[#f3ede2] brass-glow"
                        : "border-[#d4a054]/25 bg-[#161310] text-[#c2b7a6] hover:border-[#d4a054]/55"
                    }`}
                  >
                    <div className="font-mono-brand text-sm font-bold text-[#4ecdc4]">
                      9:16 (Stories)
                    </div>
                    <div className="text-xs text-[#c2b7a6]">
                      1080×1920 · IG Stories, TikTok
                    </div>
                  </button>
                </div>
              </div>

              {/* Opcjonalne pole podpisu / zawołania na karcie PNG */}
              <div>
                <label
                  htmlFor="trebusz-callsign-input"
                  className="mb-1.5 flex items-center justify-between text-xs font-mono-brand uppercase tracking-wider text-[#c2b7a6]"
                >
                  <span>2. Twój podpis / zawołanie na karcie (opcjonalnie)</span>
                  <span className="text-[#9e9383]">{rawCallsign.length}/24</span>
                </label>
                <div className="relative">
                  <input
                    id="trebusz-callsign-input"
                    type="text"
                    maxLength={24}
                    value={rawCallsign}
                    onChange={(e) => setRawCallsign(e.target.value)}
                    placeholder="np. Marek spod Malborka"
                    className="min-h-[44px] w-full rounded-xl border border-[#d4a054]/35 bg-[#08070a] px-3.5 py-2 text-sm text-[#f3ede2] placeholder-[#9e9383]/60 focus:border-[#f0c878] focus:outline-none"
                  />
                  {sanitizedLocalCallsign ? (
                    <Sparkles
                      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#f0c878]"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                {callsignRejected ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#d94e34]">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    Dozwolone są wyłącznie polskie litery, cyfry, spacje i myślniki (bez wulgaryzmów i linków).
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[#9e9383]">
                    Renderowane lokalnie bezpośrednio na Twoim pliku PNG.
                  </p>
                )}
              </div>

              {/* Podgląd gotowej wiadomości pojedynku */}
              <div className="rounded-xl border border-[#d4a054]/25 bg-[#08070a]/85 p-3.5">
                <div className="mb-1 flex items-center justify-between text-xs font-mono-brand text-[#d4a054]">
                  <span>GOTOWY TEKST WYZWANIA</span>
                  <span className="text-[#4ecdc4]">Lepszy niż {percentile}%</span>
                </div>
                <p className="whitespace-pre-line break-all text-xs leading-relaxed text-[#c2b7a6]">
                  {viralChallengeCopy}
                </p>
              </div>
            </div>

            {/* Główne przyciski akcji */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                disabled={isExporting}
                onClick={handleNativeShare}
                className="pulse-brass-cta flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#d4a054] via-[#f0c878] to-[#d4a054] px-5 py-3 text-sm font-bold text-[#08070a] transition hover:brightness-105 disabled:opacity-60"
              >
                <Share2 className="h-4 w-4 shrink-0" />
                <span>Udostępnij / Wyślij wyzwanie</span>
              </button>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleDownloadPng}
                  className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-[#d4a054]/50 bg-[#161310] px-4 py-2.5 text-sm font-semibold text-[#f3ede2] transition hover:border-[#f0c878] hover:bg-[#d4a054]/15 disabled:opacity-60"
                >
                  <Download className="h-4 w-4 shrink-0 text-[#f0c878]" />
                  <span>Pobierz kartę PNG</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyChallengeLink}
                  className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-[#4ecdc4]/45 bg-[#4ecdc4]/10 px-4 py-2.5 text-sm font-semibold text-[#7ee8e0] transition hover:border-[#7ee8e0] hover:bg-[#4ecdc4]/20"
                >
                  {copiedLink ? (
                    <>
                      <Check className="h-4 w-4 shrink-0" />
                      <span>Skopiowano link!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 shrink-0" />
                      <span>Kopiuj link pojedynku</span>
                    </>
                  )}
                </button>
              </div>

              {shareStatus ? (
                <p
                  role="status"
                  className="text-center font-mono-brand text-xs text-[#f0c878]"
                >
                  {shareStatus}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareCardModal;
