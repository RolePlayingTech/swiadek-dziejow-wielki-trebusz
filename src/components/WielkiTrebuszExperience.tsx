"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  Compass,
  Eye,
  FastForward,
  Flame,
  Gauge,
  Lock,
  Play,
  RotateCcw,
  Share2,
  Sliders,
  Sparkles,
  Swords,
  Target,
  Unlock,
  Volume2,
  VolumeX,
  Wind,
} from "lucide-react";
import {
  apiUrl,
  assetUrl,
  CANONICAL_URL,
  SCORE_CAP,
  type GameModeId,
} from "@/lib/config";
import {
  encodeUnsignedChallenge,
  formatSeedCode,
  type ParsedChallenge,
} from "@/lib/challengeCodec";
import type {
  CommunityGetResponse,
  CommunityPostResponse,
} from "@/lib/communitySchema";
import {
  DEFAULT_CAMPAIGN_SEED,
  generateCampaignMissions,
  getDailyChallengeDateLabel,
  getDailyChallengeSeed,
  getRankForScore,
} from "@/data/missionsAndRanks";
import {
  DEFAULT_TREBUCHET_CONFIG,
  PROJECTILE_LIST,
  PROJECTILES,
  simulateTrebuchetShot,
} from "@/engine/trebuchetPhysics";
import { soundEngine } from "@/engine/soundEngine";
import TrebuchetCanvas, {
  type CameraMode,
  type CanvasCaptureFn,
} from "@/three/TrebuchetCanvas";
import { SwiadekLiveToast } from "@/components/SwiadekLiveToast";
import HistoricalSourcesDrawer from "@/components/HistoricalSourcesDrawer";
import ShareCardModal, {
  type ShareCardCommunityData,
} from "@/components/ShareCardModal";
import type {
  ProjectileTypeId,
  ShotSimulationResult,
  SiegeMission,
  TrebuchetConfig,
  VoiceSubtitlePayload,
} from "@/types/trebuchet";

interface WielkiTrebuszExperienceProps {
  initialChallenge?: ParsedChallenge | null;
}

const MAX_ATTEMPTS_PER_SALVO = 2;
const INITIAL_CAMPAIGN_MASS_KG = 5750;
const INITIAL_SANDBOX_MASS_KG = 9000;

const SANDBOX_DEFAULT_MISSION: SiegeMission = {
  index: 0,
  id: "sandbox-fortress",
  titlePl: "Warsztat Cieśli: Wolny Poligon Blidy",
  subtitlePl:
    "Eksperymentuj z masą, kątem palca, wahliwą skrzynią i wiatrem bez limitu rzutów",
  historicalContextPl:
    "Swobodna rekonstrukcja inżynieryjna na bazie wymiarów z traktatu Bellifortis Konrada Kyesera (ok. 1405) i kroniki Wiganda z Marburga (Kowno 1362).",
  castleDistanceM: 215,
  targetCenterYM: 9.0,
  targetRadiusM: 4.2,
  targetZone: "kurtyna",
  windSpeedMs: 0,
  recommendedProjectileId: "granit_100",
  hintPl:
    "Sprawdź różnicę między wahliwą a zablokowaną skrzynią przeciwwagi lub przetestuj skrajne kąty palca spustowego (0°–80°).",
};

function makeRunId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const rand2 = Math.random().toString(36).slice(2, 10);
  return `run_${Date.now().toString(36)}_${rand}${rand2}`;
}

function pluralizeBlokiPl(count: number): string {
  const n = Math.max(0, Math.round(count));
  if (n === 1) return "1 blok skruszony";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} bloki skruszone`;
  }
  return `${n} bloków skruszonych`;
}

function formatPlNumber(val: number, decimals = 1): string {
  const fixed = val.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.0+$/, "").replace(".", ",") : fixed;
}

function describeOutcomePl(result: ShotSimulationResult): {
  badge: string;
  headline: string;
  tone: "gold" | "emerald" | "red" | "muted";
} {
  switch (result.outcome) {
    case "gdanisko_hit":
      return {
        badge: "SEKRETNY CEL!",
        headline: "Gdanisko Komtura zburzone nad fosą!",
        tone: "gold",
      };
    case "direct_target":
      return {
        badge: "CELNE TRAFIENIE",
        headline: `Wyłom w celu! (${pluralizeBlokiPl(result.bricksDislodged)})`,
        tone: "emerald",
      };
    case "wall_hit":
      return {
        badge: "TRAFIENIE W MUR",
        headline: `Uderzenie w mur zamku (${result.distanceErrorM.toFixed(1).replace(".", ",")} m od środka celu • ${pluralizeBlokiPl(result.bricksDislodged)})`,
        tone: "gold",
      };
    case "camp_backfire":
      return {
        badge: "SAMOBÓJ W OBÓZ!",
        headline: `Głaz poleciał ${Math.abs(result.impactDistanceM).toFixed(0)} m DO TYŁU we własne namioty i kocioł!`,
        tone: "red",
      };
    case "zenith_self_hit":
      return {
        badge: "PIONOWA ŚWIECA!",
        headline: "Kula wystrzeliła w zenit i runęła tuż przy kozłach trebusza!",
        tone: "red",
      };
    case "ground_slam":
      return {
        badge: "ZBYT ZAGIĘTY PALEC",
        headline: `Proca puściła za późno — krater na ${result.impactDistanceM.toFixed(0)} m przed machiną!`,
        tone: "red",
      };
    case "beam_overload":
      return {
        badge: "PRZECIĄŻENIE BELKI!",
        headline: "Sztywna skrzynia szarpnęła dębowym śmigłem i zdławiła rzut!",
        tone: "red",
      };
    case "short_moat":
      return {
        badge: "ZA KRÓTKO",
        headline: `Plusk na przedpolu / w fosie (${result.impactDistanceM.toFixed(1).replace(".", ",")} m)`,
        tone: "muted",
      };
    case "overshot":
      return {
        badge: "PRZESTRZELENIE",
        headline: `Pocisk przeleciał ponad zamkiem (${result.impactDistanceM.toFixed(1).replace(".", ",")} m)`,
        tone: "muted",
      };
  }
}

function getProngZoneLabel(deg: number): { text: string; colorClass: string } {
  if (deg <= 7) {
    return {
      text: "UWAGA: Wstecz w obóz!",
      colorClass: "font-semibold text-[#ff8f7e]",
    };
  }
  if (deg <= 14) {
    return {
      text: "Pionowa świeca nad belką!",
      colorClass: "font-semibold text-[#ff8f7e]",
    };
  }
  if (deg >= 26 && deg <= 46) {
    return { text: "Złote okno balistyczne", colorClass: "text-[#4ecdc4]" };
  }
  if (deg >= 61) {
    return {
      text: "Zbyt późny zrzut (w ziemię)",
      colorClass: "font-semibold text-[#ff8f7e]",
    };
  }
  return { text: "Pośredni kąt zejścia", colorClass: "text-[#c2b7a6]" };
}

export default function WielkiTrebuszExperience({
  initialChallenge = null,
}: WielkiTrebuszExperienceProps) {
  const initialMode: GameModeId = initialChallenge?.modeId ?? "kampania";
  const initialSeed: number = useMemo(() => {
    if (initialChallenge) return initialChallenge.seed;
    return DEFAULT_CAMPAIGN_SEED;
  }, [initialChallenge]);

  const [modeId, setModeId] = useState<GameModeId>(initialMode);
  const [seed, setSeed] = useState<number>(initialSeed);
  const [activeChallenge] = useState<ParsedChallenge | null>(initialChallenge);
  const [challengeBannerDismissed, setChallengeBannerDismissed] = useState(false);

  // Misje wygenerowane deterministycznie z ziarna
  const campaignMissions = useMemo(() => generateCampaignMissions(seed), [seed]);
  const [salvoIndex, setSalvoIndex] = useState<number>(0);
  const [attemptInSalvo, setAttemptInSalvo] = useState<number>(0);
  const [salvoBestScores, setSalvoBestScores] = useState<number[]>([0, 0, 0, 0]);
  const [lastEarnedSalvoPts, setLastEarnedSalvoPts] = useState<{
    total: number;
    sniperBonus: number;
  }>({ total: 0, sniperBonus: 0 });
  const [campaignCompleted, setCampaignCompleted] = useState<boolean>(false);

  // Parametry poligonu w trybie Piaskownicy
  const [sandboxDistanceM, setSandboxDistanceM] = useState<number>(215);
  const [sandboxTargetZone, setSandboxTargetZone] = useState<
    "hurdycje" | "kurtyna" | "wieza_bramna" | "gdanisko_wykusz"
  >("kurtyna");
  const [sandboxWindMs, setSandboxWindMs] = useState<number>(0);

  const currentMission: SiegeMission = useMemo(() => {
    if (modeId === "piaskownica") {
      return {
        ...SANDBOX_DEFAULT_MISSION,
        castleDistanceM: sandboxDistanceM,
        targetZone: sandboxTargetZone,
        windSpeedMs: sandboxWindMs,
        targetCenterYM:
          sandboxTargetZone === "hurdycje"
            ? 14.4
            : sandboxTargetZone === "wieza_bramna"
              ? 17.8
              : sandboxTargetZone === "gdanisko_wykusz"
                ? 8.5
                : 8.2,
      };
    }
    return campaignMissions[Math.min(salvoIndex, campaignMissions.length - 1)];
  }, [
    modeId,
    campaignMissions,
    salvoIndex,
    sandboxDistanceM,
    sandboxTargetZone,
    sandboxWindMs,
  ]);

  // Konfiguracja fizyczna blidy (w Salwie 1 masa 5,75 t trafia prosto w dolny mur na 167 m przy 1. kliknięciu!)
  const [config, setConfig] = useState<TrebuchetConfig>(() => ({
    ...DEFAULT_TREBUCHET_CONFIG,
    counterweightMassKg:
      initialMode === "piaskownica"
        ? INITIAL_SANDBOX_MASS_KG
        : INITIAL_CAMPAIGN_MASS_KG,
    projectileId:
      initialMode === "piaskownica"
        ? "granit_100"
        : campaignMissions[0]?.recommendedProjectileId ?? "granit_100",
    windSpeedMs:
      initialMode === "piaskownica" ? 0 : campaignMissions[0]?.windSpeedMs ?? 0,
  }));

  useEffect(() => {
    if (modeId !== "piaskownica") {
      setConfig((prev) => ({
        ...prev,
        windSpeedMs: currentMission.windSpeedMs,
      }));
    } else {
      setConfig((prev) => ({
        ...prev,
        windSpeedMs: sandboxWindMs,
      }));
    }
  }, [modeId, currentMission.windSpeedMs, sandboxWindMs]);

  // Stan symulacji i odtwarzania w 3D
  const [activeResult, setActiveResult] = useState<ShotSimulationResult | null>(
    null
  );
  const [playbackTimeS, setPlaybackTimeS] = useState<number>(0);
  const [isFiring, setIsFiring] = useState<boolean>(false);
  const [shotSettled, setShotSettled] = useState<boolean>(false);
  const [isFastForward, setIsFastForward] = useState<boolean>(false);

  // Narzędzia Inżyniera i kamera
  const [engineerDrawerOpen, setEngineerDrawerOpen] = useState<boolean>(false);
  const [slowMotion, setSlowMotion] = useState<boolean>(false);
  const [showVectors, setShowVectors] = useState<boolean>(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("auto");

  // Modale i audio HUD
  const [sourcesOpen, setSourcesOpen] = useState<boolean>(false);
  const [shareOpen, setShareOpen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [subtitle, setSubtitle] = useState<VoiceSubtitlePayload | null>(null);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const [verdictPortraitFallback, setVerdictPortraitFallback] =
    useState<boolean>(false);

  // Statystyki sesji do rankingu i kart PNG
  const sessionStartMsRef = useRef<number>(Date.now());
  const runIdRef = useRef<string>(makeRunId());
  const [maxDistanceM, setMaxDistanceM] = useState<number>(0);
  const [maxKineticKj, setMaxKineticKj] = useState<number>(0);
  const [bestEfficiencyPct, setBestEfficiencyPct] = useState<number>(0);
  const [totalBricksDislodged, setTotalBricksDislodged] = useState<number>(0);
  const [hadGdaniskoHit, setHadGdaniskoHit] = useState<boolean>(false);
  const [hadCampBackfire, setHadCampBackfire] = useState<boolean>(false);
  const [testedLockedHinge, setTestedLockedHinge] = useState<boolean>(false);
  const [rivalBeatenAnnounced, setRivalBeatenAnnounced] = useState<boolean>(false);

  // Dane społeczności i podpisany link wyzwania
  const [communityData, setCommunityData] =
    useState<ShareCardCommunityData | null>(null);
  const [signedChallengeToken, setSignedChallengeToken] = useState<
    string | null
  >(null);
  const [signedShareUrl, setSignedShareUrl] = useState<string | null>(null);
  const [capturedBackdropUrl, setCapturedBackdropUrl] = useState<string | null>(
    null
  );

  const canvasCaptureRef = useRef<CanvasCaptureFn | null>(null);
  const rafRef = useRef<number | null>(null);
  const campaignEndTimerRef = useRef<number | null>(null);
  const fastForwardRef = useRef<boolean>(false);
  const hasPlayedFirstTouchRef = useRef<boolean>(false);
  const hasPlayedProngHintRef = useRef<boolean>(false);

  const clearCampaignEndTimer = useCallback(() => {
    if (campaignEndTimerRef.current !== null) {
      window.clearTimeout(campaignEndTimerRef.current);
      campaignEndTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setIsMuted(soundEngine.isMuted());
    const unsubMute = soundEngine.subscribeMute((m) => setIsMuted(m));
    const unsubSub = soundEngine.subscribeSubtitle((sub) => setSubtitle(sub));

    const introTimer = window.setTimeout(() => {
      soundEngine.triggerVoice("intro");
    }, 450);

    fetch(apiUrl("/community"))
      .then((r) => (r.ok ? r.json() : null))
      .then((json: CommunityGetResponse | null) => {
        if (json && json.ok) {
          setCommunityData({
            buckets: json.buckets,
            totalRuns: json.totalRuns,
            percentile: json.percentile,
            avgScore: json.avgScore,
            maxScore: json.maxScore,
            gdaniskoHits: json.gdaniskoHits,
            campBackfires: json.campBackfires,
          });
        }
      })
      .catch(() => {
        // cichy fallback offline
      });

    return () => {
      window.clearTimeout(introTimer);
      clearCampaignEndTimer();
      unsubMute();
      unsubSub();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [clearCampaignEndTimer]);

  // Złoty łuk ducha rywala — widoczny od pierwszej sekundy pojedynku (?w=...), by celować świadomie!
  const ghostArcFrames = useMemo(() => {
    if (!activeChallenge) {
      return null;
    }
    const rawDist =
      activeChallenge.maxDistM !== 0
        ? activeChallenge.maxDistM
        : currentMission.castleDistanceM;
    const targetX = Math.max(-120, Math.min(295, rawDist));
    const pts: { x: number; y: number }[] = [];
    const steps = 42;
    const span = Math.abs(targetX + 11);
    const peakH = Math.max(22, span * 0.27);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = -11 + (targetX + 11) * u;
      const y = 2.0 + 4 * peakH * u * (1 - u);
      pts.push({ x, y });
    }
    return pts;
  }, [activeChallenge, currentMission.castleDistanceM]);

  const totalScore = useMemo(
    () =>
      Math.min(
        SCORE_CAP,
        salvoBestScores.reduce((acc, v) => acc + v, 0)
      ),
    [salvoBestScores]
  );

  const playerRank = useMemo(
    () => getRankForScore(totalScore, hadCampBackfire && totalScore < 280),
    [totalScore, hadCampBackfire]
  );

  const captureWebGLDataUrl = useCallback(async (): Promise<string | null> => {
    try {
      const bmp = await canvasCaptureRef.current?.();
      if (!bmp) return null;
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d");
      if (!ctx) {
        bmp.close?.();
        return null;
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      return c.toDataURL("image/jpeg", 0.86);
    } catch {
      return null;
    }
  }, []);

  const handleFirstInteract = useCallback(() => {
    soundEngine.unlock();
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  }, [hasInteracted]);

  const maybeTriggerFirstTouchVoice = useCallback(() => {
    if (
      !hasPlayedFirstTouchRef.current &&
      attemptInSalvo === 0 &&
      salvoIndex === 0 &&
      !isFiring
    ) {
      if (soundEngine.triggerVoice("first_touch")) {
        hasPlayedFirstTouchRef.current = true;
      }
    }
  }, [attemptInSalvo, salvoIndex, isFiring]);

  const handleChangeProngAngle = useCallback(
    (deg: number) => {
      handleFirstInteract();
      const clamped = Math.round(Math.max(0, Math.min(80, deg)));
      setConfig((prev) => {
        if (prev.prongAngleDeg !== clamped) {
          soundEngine.playProngBend(clamped);
          if (
            !hasPlayedProngHintRef.current &&
            Math.abs(clamped - DEFAULT_TREBUCHET_CONFIG.prongAngleDeg) >= 3
          ) {
            if (soundEngine.triggerVoice("prong_adjust")) {
              hasPlayedProngHintRef.current = true;
            }
          }
        }
        return { ...prev, prongAngleDeg: clamped };
      });
      if (!isFiring && shotSettled) {
        setActiveResult(null);
        setPlaybackTimeS(0);
        setShotSettled(false);
      }
    },
    [handleFirstInteract, isFiring, shotSettled]
  );

  const handleChangeCounterweight = useCallback(
    (massKg: number) => {
      handleFirstInteract();
      const rounded = Math.round(Math.max(3000, Math.min(16000, massKg)) / 250) * 250;
      setConfig((prev) => {
        if (prev.counterweightMassKg !== rounded) {
          const tension01 = (rounded - 3000) / 13000;
          soundEngine.playWinchTick(tension01);
          if (rounded >= 13500) {
            soundEngine.playWoodCreak(tension01);
          }
        }
        return { ...prev, counterweightMassKg: rounded };
      });
      maybeTriggerFirstTouchVoice();
      if (!isFiring && shotSettled) {
        setActiveResult(null);
        setPlaybackTimeS(0);
        setShotSettled(false);
      }
    },
    [handleFirstInteract, maybeTriggerFirstTouchVoice, isFiring, shotSettled]
  );

  const handleSelectProjectile = useCallback(
    (projId: ProjectileTypeId) => {
      handleFirstInteract();
      soundEngine.playWinchTick(0.35);
      setConfig((prev) => ({ ...prev, projectileId: projId }));
      maybeTriggerFirstTouchVoice();
      if (!isFiring && shotSettled) {
        setActiveResult(null);
        setPlaybackTimeS(0);
        setShotSettled(false);
      }
    },
    [handleFirstInteract, maybeTriggerFirstTouchVoice, isFiring, shotSettled]
  );

  const handleChangeSlingLength = useCallback(
    (lengthM: number) => {
      handleFirstInteract();
      const clamped = Math.round(Math.max(8.0, Math.min(14.5, lengthM)) * 10) / 10;
      setConfig((prev) => {
        if (prev.slingLengthM !== clamped) {
          soundEngine.playWinchTick((clamped - 8.0) / 6.5);
        }
        return { ...prev, slingLengthM: clamped };
      });
      maybeTriggerFirstTouchVoice();
      if (!isFiring && shotSettled) {
        setActiveResult(null);
        setPlaybackTimeS(0);
        setShotSettled(false);
      }
    },
    [handleFirstInteract, maybeTriggerFirstTouchVoice, isFiring, shotSettled]
  );

  const handleToggleHinge = useCallback(() => {
    handleFirstInteract();
    setConfig((prev) => {
      const nextHinged = !prev.hingedCounterweight;
      soundEngine.playProngBend(nextHinged ? 36 : 12);
      if (!nextHinged) {
        setTestedLockedHinge(true);
        soundEngine.triggerVoice("hinge_locked", { force: true });
      }
      return { ...prev, hingedCounterweight: nextHinged };
    });
    if (!isFiring && shotSettled) {
      setActiveResult(null);
      setPlaybackTimeS(0);
      setShotSettled(false);
    }
  }, [handleFirstInteract, isFiring, shotSettled]);

  const handleToggleFastForward = useCallback(() => {
    const next = !fastForwardRef.current;
    fastForwardRef.current = next;
    setIsFastForward(next);
    soundEngine.playWinchTick(next ? 0.85 : 0.35);
  }, []);

  // Zapis ukończonej kampanii do /api/community
  const submitCompletedCampaign = useCallback(
    async (
      finalScore: number,
      finalMaxDist: number,
      finalGdanisko: boolean,
      finalBackfire: boolean,
      finalSalvoScores: number[]
    ) => {
      const rawElapsed = Date.now() - sessionStartMsRef.current;
      const durationMs = Math.max(4500, Math.min(3_500_000, Math.round(rawElapsed)));
      try {
        const res = await fetch(apiUrl("/community"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: runIdRef.current,
            modeId,
            seed,
            score: Math.round(finalScore),
            durationMs,
            maxDistM: Number(finalMaxDist.toFixed(1)),
            gdanisko: finalGdanisko,
            campBackfire: finalBackfire,
            salvoScores: finalSalvoScores.map((s) => Math.round(s)),
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as CommunityPostResponse;
        if (data && data.ok) {
          setCommunityData({
            buckets: data.buckets,
            totalRuns: data.totalRuns,
            percentile: data.percentile,
            avgScore: data.avgScore,
            maxScore: data.maxScore,
            gdaniskoHits: data.gdaniskoHits,
            campBackfires: data.campBackfires,
          });
          setSignedChallengeToken(data.challengeToken);
          setSignedShareUrl(data.shareUrl);
        }
      } catch {
        // fallback bez połączenia
      }
    },
    [modeId, seed]
  );

  // GŁÓWNY STRZAŁ BLIDY
  const handlePullTrigger = useCallback(() => {
    if (isFiring) return;
    handleFirstInteract();
    clearCampaignEndTimer();

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    fastForwardRef.current = false;
    setIsFastForward(false);

    const simResult = simulateTrebuchetShot(config, currentMission);
    setActiveResult(simResult);
    setPlaybackTimeS(0);
    setIsFiring(true);
    setShotSettled(false);

    soundEngine.playTriggerSnap();
    soundEngine.playWoodCreak((config.counterweightMassKg - 3000) / 13000);

    const nextAttemptNum = attemptInSalvo + 1;
    if (modeId !== "piaskownica") {
      setAttemptInSalvo(nextAttemptNum);
    }

    // Premia +15 pkt za snajperskie trafienie pierwszym głazem w salwie!
    const rawSalvoPts = simResult.salvoScore;
    const sniperBonus =
      modeId !== "piaskownica" && nextAttemptNum === 1 && rawSalvoPts >= 195
        ? Math.min(15, 250 - rawSalvoPts)
        : 0;
    const effectiveSalvoPts = Math.min(250, rawSalvoPts + sniperBonus);
    setLastEarnedSalvoPts({ total: effectiveSalvoPts, sniperBonus });

    let nextMaxDist = maxDistanceM;
    if (simResult.impactDistanceM > nextMaxDist || (nextMaxDist === 0 && simResult.impactDistanceM < 0)) {
      nextMaxDist = simResult.impactDistanceM;
      setMaxDistanceM(nextMaxDist);
    }
    const impactEkKj = simResult.impactKineticEnergyKj ?? simResult.kineticEnergyKj;
    if (impactEkKj > maxKineticKj) {
      setMaxKineticKj(impactEkKj);
    }
    if (simResult.energyEfficiencyPct > bestEfficiencyPct) {
      setBestEfficiencyPct(simResult.energyEfficiencyPct);
    }
    if (simResult.bricksDislodged > 0) {
      setTotalBricksDislodged((prev) => prev + simResult.bricksDislodged);
    }
    const nextGdanisko = hadGdaniskoHit || simResult.outcome === "gdanisko_hit";
    if (simResult.outcome === "gdanisko_hit") {
      setHadGdaniskoHit(true);
    }
    const nextBackfire = hadCampBackfire || simResult.outcome === "camp_backfire";
    if (simResult.outcome === "camp_backfire") {
      setHadCampBackfire(true);
    }

    const updatedScores = [...salvoBestScores];
    if (modeId !== "piaskownica") {
      updatedScores[salvoIndex] = Math.max(
        updatedScores[salvoIndex] ?? 0,
        effectiveSalvoPts
      );
      setSalvoBestScores(updatedScores);
    }
    const projectedTotal = Math.min(
      SCORE_CAP,
      updatedScores.reduce((a, b) => a + b, 0)
    );

    let releasePlayed = false;
    let impactPlayed = false;
    let climaxVoiceFired = false;
    const totalAnimDurationS = simResult.impactTimeS + 1.15;
    let simClockS = 0;
    let prevWallMs = performance.now();

    const stepFrame = (nowMs: number) => {
      const dtWall = Math.min(2.0, Math.max(0.001, (nowMs - prevWallMs) / 1000));
      prevWallMs = nowMs;
      const speedScale = slowMotion
        ? 0.24
        : fastForwardRef.current
          ? 2.5
          : 1.0;
      simClockS += dtWall * speedScale;

      if (!releasePlayed && simClockS >= simResult.releaseTimeS) {
        releasePlayed = true;
        soundEngine.playSlingWhoosh(simResult.releaseSpeedMs);
      }

      if (!impactPlayed && simClockS >= simResult.impactTimeS) {
        impactPlayed = true;
        soundEngine.playImpactForOutcome(simResult);

        // Przechwycenie żywego kadru rozbijanego muru do karty PNG!
        window.setTimeout(() => {
          captureWebGLDataUrl().then((url) => {
            if (url) setCapturedBackdropUrl(url);
          });
        }, 120);

        // Sprawdzenie, czy właśnie pobito wynik rywala z linku wyzwania!
        if (
          activeChallenge &&
          activeChallenge.score > 0 &&
          !rivalBeatenAnnounced &&
          modeId !== "piaskownica" &&
          projectedTotal > activeChallenge.score
        ) {
          climaxVoiceFired = true;
          setRivalBeatenAnnounced(true);
          soundEngine.playRivalBeatFanfare();
          soundEngine.triggerVoice("beat_rival", { force: true });
        } else {
          switch (simResult.outcome) {
            case "camp_backfire":
              soundEngine.triggerVoice("camp_backfire", { force: true });
              break;
            case "zenith_self_hit":
              soundEngine.triggerVoice("zenith_self_hit", { force: true });
              break;
            case "ground_slam":
            case "beam_overload":
              soundEngine.triggerVoice("ground_slam", { force: true });
              break;
            case "gdanisko_hit":
              climaxVoiceFired = true;
              soundEngine.triggerVoice("gdanisko_hit", { force: true });
              break;
            case "direct_target":
              soundEngine.triggerVoice("direct_hit", { force: true });
              break;
            case "wall_hit":
              if (simResult.distanceErrorM <= 8.0) {
                soundEngine.triggerVoice("near_miss", { force: true });
              } else {
                soundEngine.triggerVoice("wall_bounce", { force: true });
              }
              break;
            case "short_moat":
              if (simResult.distanceErrorM <= 8.0) {
                soundEngine.triggerVoice("near_miss", { force: true });
              } else {
                soundEngine.triggerVoice("short_moat", { force: true });
              }
              break;
            case "overshot":
              if (simResult.distanceErrorM <= 8.0) {
                soundEngine.triggerVoice("near_miss", { force: true });
              } else {
                soundEngine.triggerVoice("overshot", { force: true });
              }
              break;
          }
        }
      }

      if (simClockS < totalAnimDurationS) {
        setPlaybackTimeS(simClockS);
        rafRef.current = requestAnimationFrame(stepFrame);
      } else {
        setPlaybackTimeS(totalAnimDurationS);
        setIsFiring(false);
        setShotSettled(true);
        fastForwardRef.current = false;
        setIsFastForward(false);
        rafRef.current = null;

        // Domknięcie kampanii po wyczerpaniu 4. salwy (z dłuższym oddechem po trafieniu w Gdanisko lub pobiciu rywala!)
        if (
          modeId !== "piaskownica" &&
          salvoIndex === campaignMissions.length - 1 &&
          (nextAttemptNum >= MAX_ATTEMPTS_PER_SALVO || effectiveSalvoPts >= 245)
        ) {
          const summaryDelayMs = climaxVoiceFired ? 3600 : 1200;
          campaignEndTimerRef.current = window.setTimeout(() => {
            campaignEndTimerRef.current = null;
            setCampaignCompleted(true);
            soundEngine.triggerVoice(
              projectedTotal >= 550 ? "campaign_high" : "campaign_low",
              { force: true }
            );
            submitCompletedCampaign(
              projectedTotal,
              nextMaxDist,
              nextGdanisko,
              nextBackfire,
              updatedScores
            );
          }, summaryDelayMs);
        }
      }
    };

    rafRef.current = requestAnimationFrame(stepFrame);
  }, [
    isFiring,
    handleFirstInteract,
    clearCampaignEndTimer,
    config,
    currentMission,
    attemptInSalvo,
    modeId,
    maxDistanceM,
    maxKineticKj,
    bestEfficiencyPct,
    hadGdaniskoHit,
    hadCampBackfire,
    salvoBestScores,
    salvoIndex,
    slowMotion,
    captureWebGLDataUrl,
    activeChallenge,
    rivalBeatenAnnounced,
    campaignMissions.length,
    submitCompletedCampaign,
  ]);

  // Obsługa klawisza Spacji: strzał w spoczynku lub przełączenie przyspieszenia 2,5× w locie
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (sourcesOpen || shareOpen || campaignCompleted) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!isFiring) {
          handlePullTrigger();
        } else if (playbackTimeS > (activeResult?.releaseTimeS ?? 0.85)) {
          handleToggleFastForward();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    sourcesOpen,
    shareOpen,
    campaignCompleted,
    isFiring,
    playbackTimeS,
    activeResult?.releaseTimeS,
    handlePullTrigger,
    handleToggleFastForward,
  ]);

  const handleRecockSameSalvo = useCallback(() => {
    if (isFiring) return;
    soundEngine.playWinchTick(0.5);
    setActiveResult(null);
    setPlaybackTimeS(0);
    setShotSettled(false);
  }, [isFiring]);

  const handleAdvanceSalvo = useCallback(() => {
    if (isFiring) return;
    clearCampaignEndTimer();
    soundEngine.playWinchTick(0.65);

    if (salvoIndex + 1 < campaignMissions.length) {
      const nextIdx = salvoIndex + 1;
      const nextMission = campaignMissions[nextIdx];
      setSalvoIndex(nextIdx);
      setAttemptInSalvo(0);
      setActiveResult(null);
      setPlaybackTimeS(0);
      setShotSettled(false);
      setConfig((prev) => ({
        ...prev,
        projectileId: nextMission.recommendedProjectileId,
        windSpeedMs: nextMission.windSpeedMs,
      }));
    } else {
      setCampaignCompleted(true);
      soundEngine.triggerVoice(
        totalScore >= 550 ? "campaign_high" : "campaign_low",
        { force: true }
      );
      submitCompletedCampaign(
        totalScore,
        maxDistanceM,
        hadGdaniskoHit,
        hadCampBackfire,
        salvoBestScores
      );
    }
  }, [
    isFiring,
    clearCampaignEndTimer,
    salvoIndex,
    campaignMissions,
    totalScore,
    submitCompletedCampaign,
    maxDistanceM,
    hadGdaniskoHit,
    hadCampBackfire,
    salvoBestScores,
  ]);

  const handleSwitchMode = useCallback(
    (nextMode: GameModeId, customSeed?: number) => {
      clearCampaignEndTimer();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      fastForwardRef.current = false;
      setIsFastForward(false);

      const resolvedSeed =
        customSeed ??
        (nextMode === "dzienny"
          ? getDailyChallengeSeed()
          : nextMode === "kampania"
            ? activeChallenge?.seed ?? DEFAULT_CAMPAIGN_SEED
            : seed);

      const nextMissions = generateCampaignMissions(resolvedSeed);
      setModeId(nextMode);
      setSeed(resolvedSeed);
      setSalvoIndex(0);
      setAttemptInSalvo(0);
      setSalvoBestScores([0, 0, 0, 0]);
      setLastEarnedSalvoPts({ total: 0, sniperBonus: 0 });
      setCampaignCompleted(false);
      setActiveResult(null);
      setPlaybackTimeS(0);
      setIsFiring(false);
      setShotSettled(false);
      setSignedChallengeToken(null);
      setSignedShareUrl(null);
      setRivalBeatenAnnounced(false);
      setMaxDistanceM(0);
      setMaxKineticKj(0);
      setBestEfficiencyPct(0);
      setTotalBricksDislodged(0);
      setHadGdaniskoHit(false);
      setHadCampBackfire(false);
      sessionStartMsRef.current = Date.now();
      runIdRef.current = makeRunId();

      if (nextMode === "piaskownica") {
        setConfig((prev) => ({
          ...prev,
          counterweightMassKg: INITIAL_SANDBOX_MASS_KG,
          windSpeedMs: sandboxWindMs,
        }));
      } else {
        setConfig((prev) => ({
          ...prev,
          counterweightMassKg: INITIAL_CAMPAIGN_MASS_KG,
          projectileId: nextMissions[0].recommendedProjectileId,
          windSpeedMs: nextMissions[0].windSpeedMs,
        }));
      }
    },
    [activeChallenge?.seed, clearCampaignEndTimer, sandboxWindMs, seed]
  );

  const handleOpenShare = useCallback(async () => {
    if (!capturedBackdropUrl) {
      const snap = await captureWebGLDataUrl();
      if (snap) setCapturedBackdropUrl(snap);
    }
    setShareOpen(true);
  }, [captureWebGLDataUrl, capturedBackdropUrl]);

  const fallbackShareUrl = useMemo(() => {
    if (signedShareUrl) return signedShareUrl;
    const effectiveScore =
      modeId === "piaskownica"
        ? Math.min(SCORE_CAP, (activeResult?.salvoScore ?? 0) * 4)
        : totalScore;
    const token = encodeUnsignedChallenge({
      seed,
      modeId,
      score: effectiveScore,
      maxDistM: Number(maxDistanceM.toFixed(1)),
      gdanisko: hadGdaniskoHit,
      backfire: hadCampBackfire,
    });
    return `${CANONICAL_URL}?w=${encodeURIComponent(token)}`;
  }, [
    signedShareUrl,
    modeId,
    activeResult?.salvoScore,
    totalScore,
    seed,
    maxDistanceM,
    hadGdaniskoHit,
    hadCampBackfire,
  ]);

  const prongZone = getProngZoneLabel(config.prongAngleDeg);
  const outcomeSummary =
    shotSettled && activeResult ? describeOutcomePl(activeResult) : null;
  const currentSalvoBest = salvoBestScores[salvoIndex] ?? 0;
  const canImproveCurrentSalvo =
    modeId === "piaskownica" ||
    (attemptInSalvo < MAX_ATTEMPTS_PER_SALVO && currentSalvoBest < 250);

  const effectiveShareScore =
    modeId === "piaskownica"
      ? Math.min(SCORE_CAP, Math.max(totalScore, (activeResult?.salvoScore ?? 0) * 4))
      : totalScore;

  const canFastForwardNow =
    isFiring && playbackTimeS > (activeResult?.releaseTimeS ?? 0.85);

  const showMeaningfulPercentile =
    (communityData?.totalRuns ?? 0) >= 5 &&
    typeof communityData?.percentile === "number" &&
    communityData.percentile > 0 &&
    totalScore > 0;

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#08070a] select-none">
      {/* WARSTWA 0: Pełnoekranowa scena 3D WebGL (React Three Fiber) */}
      <div className="absolute inset-0 z-0">
        <TrebuchetCanvas
          config={config}
          mission={currentMission}
          activeResult={activeResult}
          playbackTimeS={playbackTimeS}
          isFiring={isFiring}
          slowMotion={slowMotion}
          showVectors={showVectors}
          cameraMode={cameraMode}
          ghostFrames={ghostArcFrames}
          ghostLabel={
            activeChallenge
              ? activeChallenge.verified && activeChallenge.score > 0
                ? `Łuk rywala (${activeChallenge.score} pkt • ${formatPlNumber(activeChallenge.maxDistM)} m)`
                : `Cel wyzwania (${activeChallenge.seedCode})`
              : null
          }
          onChangeProngAngle={handleChangeProngAngle}
          onChangeCounterweight={handleChangeCounterweight}
          onPullTrigger={handlePullTrigger}
          onFirstInteract={handleFirstInteract}
          canvasCaptureRef={canvasCaptureRef}
        />
      </div>

      {/* WARSTWA 1: Górny Pasek Nawigacji i Trybów (zero kolizji na 375px!) */}
      <header
        className="relative z-30 flex items-center justify-between gap-1.5 border-b border-[#d4a054]/20 bg-[#08070a]/84 px-2 py-1.5 backdrop-blur-md sm:px-4"
        style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex min-w-0 items-center gap-1 sm:gap-2.5">
          <a
            href="https://swiadek-dziejow.pl"
            title="Wróć do portalu Świadek Dziejów"
            className="font-mono-brand flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg border border-white/12 bg-[#120e0b]/90 px-2 py-1 text-[11px] font-semibold text-[#d4a054] transition hover:border-[#d4a054]/50 hover:text-[#f0c878] sm:min-h-[36px] sm:px-2.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="sm:hidden">ŚD</span>
            <span className="hidden sm:inline">Świadek Dziejów</span>
          </a>

          {/* Przełącznik trybów gry — czytelne polskie nazwy na mobile i desktopie */}
          <nav
            aria-label="Tryb rozgrywki"
            className="flex items-center rounded-lg border border-white/10 bg-[#120e0b]/90 p-0.5"
          >
            {(
              [
                {
                  id: "kampania",
                  labelMobile: "Kampania",
                  labelDesktop: "Kampania (4 Salwy)",
                },
                {
                  id: "dzienny",
                  labelMobile: "Rozkaz",
                  labelDesktop: "Rozkaz Dnia",
                },
                {
                  id: "piaskownica",
                  labelMobile: "Warsztat",
                  labelDesktop: "Piaskownica",
                },
              ] as const
            ).map((tab) => {
              const active = modeId === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    handleSwitchMode(
                      tab.id,
                      tab.id === "kampania" && !activeChallenge
                        ? DEFAULT_CAMPAIGN_SEED
                        : undefined
                    )
                  }
                  className={`min-h-[30px] rounded-md px-1.5 py-1 text-[11px] font-semibold transition sm:px-2.5 sm:text-xs ${
                    active
                      ? "bg-[#d4a054] text-[#08070a] shadow-sm"
                      : "text-[#c2b7a6] hover:text-[#f3ede2]"
                  }`}
                >
                  <span className="md:hidden">{tab.labelMobile}</span>
                  <span className="hidden md:inline">{tab.labelDesktop}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Prawa strona paska HUD (na <640px wynik wyświetlamy w pasku misji, by dać pełen oddech zakładkom!) */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {modeId !== "piaskownica" && (
            <div
              className="font-mono-brand hidden min-h-[36px] items-center gap-1 rounded-lg border border-[#d4a054]/35 bg-[#120e0b]/90 px-2.5 py-1 text-xs sm:flex"
              title="Aktualny wynik kampanii 4 salw"
            >
              <Award className="h-3.5 w-3.5 text-[#f0c878]" />
              <span className="font-bold text-[#f0c878]">{totalScore}</span>
              <span className="text-[#9e9383]">/1000</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setSourcesOpen(true)}
            title="Skąd to wiemy? Fakty źródłowe, równania i mity"
            aria-label="Skąd to wiemy? Źródła i fizyka"
            className="flex min-h-[34px] min-w-[34px] items-center justify-center gap-1.5 rounded-lg border border-[#4ecdc4]/35 bg-[#4ecdc4]/10 px-2 py-1 text-[11px] font-semibold text-[#7ee8e0] transition hover:bg-[#4ecdc4]/20 sm:min-h-[36px] sm:px-2.5 sm:text-xs"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Skąd to wiemy?</span>
          </button>

          <button
            type="button"
            onClick={handleOpenShare}
            title="Generuj kartę wyniku PNG (4:5 / 9:16) i wyzwij znajomych"
            aria-label="Udostępnij wynik i wyzwij znajomych"
            className="flex min-h-[34px] min-w-[34px] items-center justify-center gap-1.5 rounded-lg border border-[#d4a054]/40 bg-[#d4a054]/14 px-2 py-1 text-[11px] font-semibold text-[#f0c878] transition hover:bg-[#d4a054]/25 sm:min-h-[36px] sm:px-2.5 sm:text-xs"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Wyzwij</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.unlock();
              soundEngine.toggleMute();
            }}
            title={isMuted ? "Włącz głos Świadka i dźwięki fizyki" : "Wycisz dźwięk"}
            aria-label={isMuted ? "Włącz dźwięk" : "Wycisz dźwięk"}
            className={`flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border transition sm:min-h-[36px] sm:min-w-[36px] ${
              isMuted
                ? "border-[#e05a47]/45 bg-[#e05a47]/15 text-[#ff8f7e]"
                : "border-white/15 bg-[#120e0b]/90 text-[#f0c878] hover:border-[#d4a054]/50"
            }`}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* Pływający dymek na żywo Świadka Dziejów */}
      <SwiadekLiveToast
        subtitle={subtitle}
        isDragging3D={isFiring}
        isMuted={isMuted}
        onReplay={() => {
          soundEngine.unlock();
          soundEngine.replayLastVoice();
        }}
      />

      {/* Pigułka celu aktualnej misji i wiatru (prawy górny róg na desktopie) + Baner Wyzwania */}
      <div
        className="pointer-events-none fixed right-2.5 z-20 flex flex-col items-end gap-1.5 sm:right-4"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 54px)" }}
      >
        <div className="hidden rounded-xl border border-[#d4a054]/30 bg-[#0c0a08]/84 px-3 py-2 text-right shadow-lg backdrop-blur-md lg:block">
          <div className="flex items-center justify-end gap-2">
            <span className="font-mono-brand text-[10px] tracking-[0.16em] text-[#d4a054] uppercase">
              {modeId === "piaskownica"
                ? "TRYB INŻYNIERA · WOLNY POLIGON"
                : modeId === "dzienny"
                  ? `ROZKAZ DNIA ${getDailyChallengeDateLabel()} · ${formatSeedCode(seed)}`
                  : `SCENARIUSZ ${formatSeedCode(seed)} · SALWA ${salvoIndex + 1}/4`}
            </span>
          </div>
          <p className="font-serif-brand mt-0.5 text-sm font-bold text-[#f3ede2]">
            {currentMission.titlePl}
          </p>
          <div className="font-mono-brand mt-1 flex items-center justify-end gap-3 text-[11px] text-[#c2b7a6]">
            <span className="flex items-center gap-1 text-[#f0c878]">
              <Target className="h-3.5 w-3.5" />
              Cel: {currentMission.castleDistanceM} m
            </span>
            <span
              className={`flex items-center gap-1 ${
                currentMission.windSpeedMs < -0.5
                  ? "text-[#ff8f7e]"
                  : currentMission.windSpeedMs > 0.5
                    ? "text-[#4ecdc4]"
                    : "text-[#c2b7a6]"
              }`}
            >
              <Wind className="h-3.5 w-3.5" />
              Wiatr:{" "}
              {currentMission.windSpeedMs > 0
                ? `+${currentMission.windSpeedMs.toFixed(1).replace(".", ",")} m/s (w plecy)`
                : currentMission.windSpeedMs < 0
                  ? `${currentMission.windSpeedMs.toFixed(1).replace(".", ",")} m/s (w twarz)`
                  : "0 m/s (cisza)"}
            </span>
          </div>
        </div>

        {/* Baner Rękawicy Wyzywającego (gdy wejście z linku ?w=...) */}
        {activeChallenge && !challengeBannerDismissed && (
          <div className="pointer-events-auto max-w-[340px] rounded-xl border border-[#f0c878]/50 bg-[#16110b]/92 px-3 py-2 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-brand flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] text-[#f0c878] uppercase">
                <Swords className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {activeChallenge.verified && activeChallenge.callsign
                    ? `${activeChallenge.callsign} rzuca rękawicę!`
                    : `Pojedynek · ${activeChallenge.seedCode}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setChallengeBannerDismissed(true)}
                className="px-1 text-[11px] text-[#9e9383] hover:text-[#f3ede2]"
                aria-label="Ukryj pasek pojedynku"
              >
                ✕
              </button>
            </div>
            <div className="font-mono-brand mt-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-[#c2b7a6]">
                {activeChallenge.score > 0 ? (
                  <>
                    Cel:{" "}
                    <strong className="text-[#f0c878]">
                      {activeChallenge.score} pkt
                    </strong>{" "}
                    ({formatPlNumber(activeChallenge.maxDistM)} m)
                  </>
                ) : (
                  <>Ten sam wiatr i cele ({activeChallenge.seedCode})</>
                )}
              </span>
              {activeChallenge.score > 0 && (
                <span
                  className={`shrink-0 font-bold ${
                    totalScore > activeChallenge.score
                      ? "text-[#4ecdc4]"
                      : "text-[#d4a054]"
                  }`}
                >
                  {totalScore > activeChallenge.score
                    ? `+${totalScore - activeChallenge.score} PKT!`
                    : `${totalScore - activeChallenge.score} pkt`}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* WARSTWA 2: Dolny Pokład Sterowania Kciukiem (100% ergonomii 375x667, zero ukrytego scrolla!) */}
      <section
        aria-label="Panel sterowania blidą"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center px-2 pt-1.5 sm:px-4"
        style={{ paddingBottom: "max(0.45rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="pointer-events-auto w-full max-w-3xl space-y-1.5">
          {/* Karta telemetrii ostatniego strzału (czysta informacja zwrotna bez duplikowania przycisków CTA) */}
          {outcomeSummary && activeResult && !campaignCompleted && (
            <div className="animate-toast rounded-xl border border-[#d4a054]/40 bg-[#0d0a08]/92 px-3 py-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.75)] backdrop-blur-md sm:py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span
                  className={`font-mono-brand rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.12em] uppercase ${
                    outcomeSummary.tone === "emerald"
                      ? "bg-[#4ecdc4]/20 text-[#7ee8e0]"
                      : outcomeSummary.tone === "gold"
                        ? "bg-[#d4a054]/25 text-[#f0c878]"
                        : outcomeSummary.tone === "red"
                          ? "bg-[#e05a47]/25 text-[#ff9b8c]"
                          : "bg-white/10 text-[#c2b7a6]"
                  }`}
                >
                  {outcomeSummary.badge}
                </span>
                {modeId !== "piaskownica" && (
                  <span className="font-mono-brand text-xs font-bold text-[#f0c878]">
                    +{lastEarnedSalvoPts.total} pkt
                    {lastEarnedSalvoPts.sniperBonus > 0 ? (
                      <span className="ml-1 text-[10px] text-[#4ecdc4]">
                        (+{lastEarnedSalvoPts.sniperBonus} snajper)
                      </span>
                    ) : null}
                  </span>
                )}
                <span className="font-mono-brand text-[10.5px] text-[#c2b7a6] sm:text-[11px]">
                  • Rzut:{" "}
                  <strong className="text-[#f3ede2]">
                    {activeResult.impactDistanceM.toFixed(1).replace(".", ",")} m
                  </strong>{" "}
                  • {activeResult.releaseSpeedKmh.toFixed(0)} km/h •{" "}
                  {(
                    activeResult.impactKineticEnergyKj ??
                    activeResult.kineticEnergyKj
                  ).toFixed(0)}{" "}
                  kJ (<span className="normal-case">η</span>{" "}
                  {activeResult.energyEfficiencyPct.toFixed(0)}%)
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug font-medium text-[#f3ede2] sm:text-[13px]">
                {outcomeSummary.headline}
              </p>
            </div>
          )}

          {/* Szuflada dodatkowych narzędzi inżyniera */}
          {engineerDrawerOpen && (
            <div className="animate-toast rounded-xl border border-[#d4a054]/30 bg-[#0d0a08]/92 p-2.5 shadow-xl backdrop-blur-md sm:p-3">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#c2b7a6]">Długość liny procy</span>
                    <span className="font-mono-brand font-bold text-[#f0c878]">
                      {config.slingLengthM.toFixed(1).replace(".", ",")} m
                    </span>
                  </div>
                  <input
                    type="range"
                    min={8.0}
                    max={14.5}
                    step={0.1}
                    value={config.slingLengthM}
                    aria-label="Długość liny procy w metrach"
                    onChange={(e) =>
                      handleChangeSlingLength(Number(e.target.value))
                    }
                    className="brass-slider mt-1 w-full"
                  />
                </div>

                {/* Eksperyment Lagrange'a: Wahliwa vs Zablokowana skrzynia przeciwwagi */}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#161310] px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#f3ede2]">
                      Zawieszenie skrzyni
                    </div>
                    <div className="text-[10px] text-[#9e9383]">
                      {config.hingedCounterweight
                        ? "Wahliwe (historyczna blida — max η)"
                        : "Zablokowane zastrzałem (~30% straty!)"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleHinge}
                    className={`flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      config.hingedCounterweight
                        ? "border-[#4ecdc4]/45 bg-[#4ecdc4]/15 text-[#7ee8e0]"
                        : "border-[#e05a47]/50 bg-[#e05a47]/20 text-[#ff9b8c]"
                    }`}
                  >
                    {config.hingedCounterweight ? (
                      <>
                        <Unlock className="h-3.5 w-3.5" />
                        <span>Wahliwa</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        <span>Sztywna</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Dodatkowe suwaki poligonu w trybie Piaskownicy */}
              {modeId === "piaskownica" && (
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 border-t border-white/10 pt-2.5 sm:grid-cols-3">
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#c2b7a6]">Dystans zamku</span>
                      <span className="font-mono-brand text-[#f0c878]">
                        {sandboxDistanceM} m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={150}
                      max={275}
                      step={5}
                      value={sandboxDistanceM}
                      aria-label="Dystans zamku w metrach"
                      onChange={(e) => setSandboxDistanceM(Number(e.target.value))}
                      className="brass-slider mt-1 w-full"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#c2b7a6]">Wiatr znad rzeki</span>
                      <span className="font-mono-brand text-[#f0c878]">
                        {sandboxWindMs > 0
                          ? `+${formatPlNumber(sandboxWindMs)}`
                          : formatPlNumber(sandboxWindMs)}{" "}
                        m/s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-9}
                      max={8}
                      step={0.5}
                      value={sandboxWindMs}
                      aria-label="Prędkość wiatru"
                      onChange={(e) => setSandboxWindMs(Number(e.target.value))}
                      className="brass-slider mt-1 w-full"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-[#c2b7a6]">Cel na zamku</div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {(
                        [
                          { id: "hurdycje", label: "Hurdycje" },
                          { id: "kurtyna", label: "Kurtyna" },
                          { id: "wieza_bramna", label: "Brama" },
                          { id: "gdanisko_wykusz", label: "Gdanisko!" },
                        ] as const
                      ).map((z) => (
                        <button
                          key={z.id}
                          type="button"
                          onClick={() => setSandboxTargetZone(z.id)}
                          className={`rounded px-1.5 py-1 text-[10.5px] font-semibold ${
                            sandboxTargetZone === z.id
                              ? "bg-[#d4a054] text-[#08070a]"
                              : "bg-white/6 text-[#c2b7a6]"
                          }`}
                        >
                          {z.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Przełączniki widoku: Slow-Mo, Wektory 3D, Kamera */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-white/10 pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSlowMotion((v) => !v)}
                    className={`min-h-[30px] rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                      slowMotion
                        ? "border-[#f0c878] bg-[#d4a054]/25 text-[#f0c878]"
                        : "border-white/12 bg-white/5 text-[#c2b7a6]"
                    }`}
                  >
                    Slow-Mo 0,24× {slowMotion ? "ON" : "OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowVectors((v) => !v)}
                    className={`min-h-[30px] rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                      showVectors
                        ? "border-[#4ecdc4] bg-[#4ecdc4]/20 text-[#7ee8e0]"
                        : "border-white/12 bg-white/5 text-[#c2b7a6]"
                    }`}
                  >
                    Wektory sił {showVectors ? "ON" : "OFF"}
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5 text-[#9e9383]" />
                  {(
                    [
                      { id: "auto", label: "Auto" },
                      { id: "prong_zoom", label: "Zbliżenie Palca" },
                      { id: "overview", label: "Panorama" },
                    ] as const
                  ).map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => setCameraMode(cam.id)}
                      className={`min-h-[28px] rounded-md px-2 py-0.5 text-[10.5px] font-semibold transition ${
                        cameraMode === cam.id
                          ? "bg-[#d4a054] text-[#08070a]"
                          : "bg-white/6 text-[#c2b7a6] hover:text-[#f3ede2]"
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Główna konsola kciuka (4 pociski zawsze widoczne jednocześnie na 375px, 0 poziomego scrolla!) */}
          <div className="archival-frame rounded-2xl bg-[#0c0a08]/90 px-2.5 py-2 backdrop-blur-md sm:px-4 sm:py-2.5">
            {/* Kompaktowy pasek misji na mobile (< lg) z wektorowymi ikonami i wynikiem */}
            <div className="mb-1.5 flex items-center justify-between gap-1.5 border-b border-white/8 pb-1 text-[10.5px] lg:hidden">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="font-mono-brand shrink-0 font-bold text-[#d4a054]">
                  {modeId === "piaskownica"
                    ? "POLIGON"
                    : `SALWA ${salvoIndex + 1}/4`}
                </span>
                <span className="truncate text-[#f3ede2]">
                  {currentMission.titlePl.replace(/^Salwa [IV]+:\s*/, "")}
                </span>
              </div>
              <div className="font-mono-brand flex shrink-0 items-center gap-2 text-[10px]">
                <span className="flex items-center gap-0.5 text-[#f0c878]">
                  <Target className="h-3 w-3" />
                  {currentMission.castleDistanceM} m
                </span>
                <span
                  className={`flex items-center gap-0.5 ${
                    currentMission.windSpeedMs < -0.5
                      ? "text-[#ff8f7e]"
                      : currentMission.windSpeedMs > 0.5
                        ? "text-[#4ecdc4]"
                        : "text-[#9e9383]"
                  }`}
                >
                  <Wind className="h-3 w-3" />
                  {currentMission.windSpeedMs > 0
                    ? `+${formatPlNumber(currentMission.windSpeedMs)}`
                    : formatPlNumber(currentMission.windSpeedMs)}{" "}
                  m/s
                </span>
                {modeId !== "piaskownica" && (
                  <span className="flex items-center gap-0.5 font-bold text-[#f0c878] sm:hidden">
                    <Award className="h-3 w-3" />
                    {totalScore}
                  </span>
                )}
              </div>
            </div>

            {/* 2 główne suwaki fizyczne (zsynchronizowane 1:1 z uchwytami 3D!) */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
              {/* Suwak 1: Kąt żelaznego palca spustowego */}
              <div>
                <div className="flex items-baseline justify-between gap-1">
                  <label
                    htmlFor="slider-prong"
                    className="truncate text-[11px] font-semibold text-[#f3ede2] sm:text-xs"
                  >
                    Palec spustowy δ
                  </label>
                  <span className="font-mono-brand text-xs font-bold text-[#f0c878] sm:text-sm">
                    {config.prongAngleDeg}°
                  </span>
                </div>
                <input
                  id="slider-prong"
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  disabled={isFiring}
                  value={config.prongAngleDeg}
                  onChange={(e) => handleChangeProngAngle(Number(e.target.value))}
                  className="brass-slider mt-1 w-full"
                />
                <div className={`truncate text-[9.5px] ${prongZone.colorClass}`}>
                  {prongZone.text}
                </div>
              </div>

              {/* Suwak 2: Masa skrzyni przeciwwagi */}
              <div>
                <div className="flex items-baseline justify-between gap-1">
                  <label
                    htmlFor="slider-mass"
                    className="truncate text-[11px] font-semibold text-[#f3ede2] sm:text-xs"
                  >
                    Przeciwwaga
                  </label>
                  <span className="font-mono-brand text-xs font-bold text-[#f0c878] sm:text-sm">
                    {(config.counterweightMassKg / 1000)
                      .toFixed(2)
                      .replace(/\.00$/, "")
                      .replace(/(\.\d)0$/, "$1")
                      .replace(".", ",")}{" "}
                    t
                  </span>
                </div>
                <input
                  id="slider-mass"
                  type="range"
                  min={3000}
                  max={16000}
                  step={250}
                  disabled={isFiring}
                  value={config.counterweightMassKg}
                  onChange={(e) =>
                    handleChangeCounterweight(Number(e.target.value))
                  }
                  className="brass-slider mt-1 w-full"
                />
                <div className="truncate text-[9.5px] text-[#9e9383]">
                  {PROJECTILES[config.projectileId].shortNamePl} • przełożenie 5,0:1
                </div>
              </div>
            </div>

            {/* Rząd wyboru amunicji + akcje główne (4 pociski zawsze w pełnej widoczności!) */}
            <div className="mt-1.5 flex flex-col gap-1.5 sm:mt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <div
                className="grid grid-cols-4 gap-1 sm:flex sm:items-center sm:gap-1.5"
                role="radiogroup"
                aria-label="Wybór pocisku"
              >
                {PROJECTILE_LIST.map((p) => {
                  const selected = config.projectileId === p.id;
                  const compactLabel = p.shortNamePl
                    .replace("Głaz ", "")
                    .replace("Kula ", "");
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={isFiring}
                      onClick={() => handleSelectProjectile(p.id)}
                      title={p.descriptionPl}
                      className={`flex min-h-[32px] items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[10.5px] font-semibold transition sm:min-h-[36px] sm:px-2.5 sm:text-xs ${
                        selected
                          ? "border-[#f0c878] bg-[#d4a054]/22 text-[#f0c878]"
                          : "border-white/10 bg-[#161310] text-[#c2b7a6] hover:text-[#f3ede2]"
                      }`}
                    >
                      {p.isIncendiary ? (
                        <Flame className="h-3 w-3 shrink-0 text-[#ff8f7e]" />
                      ) : (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-[#c2b7a6]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{compactLabel}</span>
                    </button>
                  );
                })}
              </div>

              {/* Prawa sekcja przycisków: Inżynier + pojedyncza czytelna ścieżka CTA */}
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    handleFirstInteract();
                    setEngineerDrawerOpen((v) => !v);
                  }}
                  title="Więcej parametrów inżynieryjnych (proca, blokada skrzyni, slow-mo, wektory)"
                  aria-expanded={engineerDrawerOpen}
                  className={`flex min-h-[38px] shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                    engineerDrawerOpen ||
                    !config.hingedCounterweight ||
                    slowMotion ||
                    showVectors
                      ? "border-[#4ecdc4]/55 bg-[#4ecdc4]/15 text-[#7ee8e0]"
                      : "border-white/14 bg-[#161310] text-[#c2b7a6] hover:text-[#f3ede2]"
                  }`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>Inżynier</span>
                </button>

                {/* Gdy strzał osiadł w Kampanii/Rozkazie Dnia: 1 jasny złoty przycisk dalej + opcjonalna 2. kula */}
                {shotSettled && modeId !== "piaskownica" ? (
                  <>
                    {canImproveCurrentSalvo && (
                      <button
                        type="button"
                        onClick={handleRecockSameSalvo}
                        className="flex min-h-[38px] shrink-0 items-center gap-1 rounded-xl border border-white/18 bg-[#161310] px-2.5 py-1.5 text-xs font-semibold text-[#f3ede2] transition hover:border-[#f0c878]"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-[#f0c878]" />
                        <span>2. kula</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleAdvanceSalvo}
                      className="pulse-brass-cta flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-full bg-[#d4a054] px-4 py-1.5 text-xs font-extrabold tracking-[0.05em] text-[#08070a] uppercase transition hover:bg-[#f0c878] sm:flex-initial sm:px-5 sm:text-sm"
                    >
                      <span>
                        {salvoIndex + 1 < campaignMissions.length
                          ? `Salwa ${salvoIndex + 2}/4`
                          : "Werdykt"}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </>
                ) : isFiring ? (
                  canFastForwardNow ? (
                    <button
                      type="button"
                      onClick={handleToggleFastForward}
                      className={`flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-extrabold tracking-[0.05em] uppercase transition sm:flex-initial sm:px-5 sm:text-sm ${
                        isFastForward
                          ? "border-[#f0c878] bg-[#d4a054] text-[#08070a]"
                          : "border-[#f0c878]/60 bg-[#1b140d] text-[#f0c878] hover:bg-[#d4a054]/25"
                      }`}
                    >
                      <FastForward className="h-4 w-4" />
                      <span>{isFastForward ? "2,5× aktywne" : "Przyspiesz 2,5×"}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex min-h-[38px] flex-1 cursor-wait items-center justify-center gap-1.5 rounded-full bg-[#d4a054]/40 px-4 py-1.5 text-xs font-extrabold tracking-[0.05em] text-[#f3ede2]/80 uppercase sm:flex-initial sm:px-5 sm:text-sm"
                    >
                      <Gauge className="h-4 w-4 animate-spin" />
                      <span>Rozpęd belki…</span>
                    </button>
                  )
                ) : (
                  <>
                    {shotSettled && modeId === "piaskownica" && (
                      <button
                        type="button"
                        onClick={handleRecockSameSalvo}
                        title="Przywróć belkę do pozycji spoczynkowej"
                        className="flex min-h-[38px] shrink-0 items-center gap-1 rounded-xl border border-white/15 bg-[#161310] px-2.5 py-1.5 text-xs font-semibold text-[#c2b7a6] transition hover:text-[#f3ede2]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Naciągnij</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePullTrigger}
                      className={`flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-extrabold tracking-[0.05em] uppercase transition sm:flex-initial sm:px-5 sm:text-sm ${
                        !hasInteracted
                          ? "pulse-brass-cta bg-[#d4a054] text-[#08070a] hover:bg-[#f0c878]"
                          : "bg-[#d4a054] text-[#08070a] shadow-[0_8px_28px_rgba(212,160,84,0.34)] hover:bg-[#f0c878]"
                      }`}
                    >
                      <Flame className="h-4 w-4" />
                      <span>
                        {modeId !== "piaskownica" && attemptInSalvo === 1
                          ? "Zwolnij spust (2/2)!"
                          : "Zwolnij spust!"}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WARSTWA 3: Ekran Finałowego Werdyktu Kampanii (po 4 salwach) */}
      {campaignCompleted && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#08070a]/84 p-3 backdrop-blur-md sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Podsumowanie kampanii oblężniczej"
        >
          <div className="archival-frame animate-toast my-auto w-full max-w-xl rounded-2xl bg-[#110d0a] p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d4a054]/25 pb-3">
              <span className="font-mono-brand text-[10.5px] font-bold tracking-[0.16em] text-[#d4a054] uppercase">
                Werdykt Oblężniczy • Scenariusz{" "}
                <span className="whitespace-nowrap">{formatSeedCode(seed)}</span>
              </span>
              {showMeaningfulPercentile ? (
                <span className="font-mono-brand rounded-full border border-[#4ecdc4]/40 bg-[#4ecdc4]/12 px-2.5 py-0.5 text-[11px] font-bold text-[#7ee8e0]">
                  Lepszy wynik niż u {communityData?.percentile}% graczy
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-xs text-[#c2b7a6]">Przyznana ranga</div>
                <h2 className="font-serif-brand mt-0.5 text-2xl font-extrabold text-[#f3ede2] sm:text-3xl">
                  {playerRank.badgeIcon} {playerRank.titlePl}
                </h2>
                <p className="mt-1 text-xs text-[#c2b7a6]">
                  {playerRank.epigraphPl}
                </p>
              </div>
              <div className="shrink-0 rounded-xl border border-[#d4a054]/40 bg-[#08070a] px-4 py-2.5 text-left sm:text-right">
                <div className="font-mono-brand text-[10px] tracking-[0.14em] text-[#9e9383] uppercase">
                  Wynik 4 salw
                </div>
                <div className="font-serif-brand whitespace-nowrap text-3xl font-extrabold text-[#f0c878]">
                  {totalScore}{" "}
                  <span className="text-base font-normal text-[#9e9383]">
                    / 1000
                  </span>
                </div>
              </div>
            </div>

            {/* Porównanie pojedynku, jeśli grano z linku wyzwania znajomego */}
            {activeChallenge && activeChallenge.score > 0 && (
              <div className="mt-3.5 rounded-xl border border-[#f0c878]/35 bg-[#1b140d] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span className="font-semibold text-[#f0c878]">
                    Pojedynek w scenariuszu{" "}
                    <span className="whitespace-nowrap">
                      {activeChallenge.seedCode}
                    </span>
                    :
                  </span>
                  <span
                    className={`font-mono-brand font-bold ${
                      totalScore >= activeChallenge.score
                        ? "text-[#4ecdc4]"
                        : "text-[#ff8f7e]"
                    }`}
                  >
                    {totalScore > activeChallenge.score
                      ? `ZWYCIĘSTWO (+${totalScore - activeChallenge.score} pkt!)`
                      : totalScore === activeChallenge.score
                        ? "REMIS CO DO PUNKTU!"
                        : `Zabrakło ${activeChallenge.score - totalScore} pkt`}
                  </span>
                </div>
                <div className="font-mono-brand mt-1 text-[11px] text-[#c2b7a6]">
                  Twój wynik: <strong className="text-[#f3ede2]">{totalScore} pkt</strong>{" "}
                  kontra rywal:{" "}
                  <strong className="text-[#f0c878]">
                    {activeChallenge.score} pkt
                  </strong>
                </div>
              </div>
            )}

            {/* 3 metryki inżynieryjne */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-[#08070a]/80 p-2.5 text-center">
                <div className="font-mono-brand text-[9.5px] text-[#9e9383] uppercase">
                  Najdalszy rzut
                </div>
                <div className="font-mono-brand mt-0.5 text-base font-bold text-[#f3ede2] sm:text-lg">
                  {maxDistanceM.toFixed(1).replace(".", ",")} m
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#08070a]/80 p-2.5 text-center">
                <div className="font-mono-brand text-[9.5px] text-[#9e9383] uppercase">
                  Energia uderzenia
                </div>
                <div className="font-mono-brand mt-0.5 text-base font-bold text-[#f0c878] sm:text-lg">
                  {maxKineticKj.toFixed(0)} kJ
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#08070a]/80 p-2.5 text-center">
                <div className="font-mono-brand text-[9.5px] text-[#9e9383] uppercase">
                  Sprawność <span className="normal-case">η</span>
                </div>
                <div className="font-mono-brand mt-0.5 text-base font-bold text-[#4ecdc4] sm:text-lg">
                  {bestEfficiencyPct.toFixed(1).replace(".", ",")}%
                </div>
              </div>
            </div>

            {/* Odznaki specjalne */}
            {(hadGdaniskoHit || testedLockedHinge || hadCampBackfire) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hadGdaniskoHit && (
                  <span className="font-mono-brand rounded-full border border-[#f0c878]/45 bg-[#d4a054]/18 px-2.5 py-0.5 text-[10.5px] font-bold text-[#f0c878]">
                    ✦ Odznaka: Pogromca Gdaniska
                  </span>
                )}
                {testedLockedHinge && (
                  <span className="font-mono-brand rounded-full border border-[#4ecdc4]/45 bg-[#4ecdc4]/14 px-2.5 py-0.5 text-[10.5px] font-bold text-[#7ee8e0]">
                    ◆ Eksperymentator Wahadła Lagrange’a
                  </span>
                )}
                {hadCampBackfire && (
                  <span className="font-mono-brand rounded-full border border-[#e05a47]/45 bg-[#e05a47]/15 px-2.5 py-0.5 text-[10.5px] font-bold text-[#ff9b8c]">
                    ▲ Zbombardowano własny obóz!
                  </span>
                )}
              </div>
            )}

            {/* Komentarz Świadka Dziejów */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#d4a054]/25 bg-[#08070a]/75 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  verdictPortraitFallback
                    ? assetUrl("/swiadek-ref.jpg")
                    : assetUrl("/swiadek-portrait.jpg")
                }
                alt="Świadek Dziejów"
                onError={() => setVerdictPortraitFallback(true)}
                className="h-12 w-12 shrink-0 rounded-full border border-[#d4a054]/60 object-cover object-top"
              />
              <p className="font-serif-brand text-xs leading-relaxed text-[#f3ede2] italic sm:text-sm">
                „{playerRank.swiadekVerdictPl}”
              </p>
            </div>

            {/* Główne akcje finałowe */}
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleOpenShare}
                className="pulse-brass-cta flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#d4a054] px-4 py-2.5 text-xs font-extrabold tracking-[0.06em] text-[#08070a] uppercase transition hover:bg-[#f0c878] sm:col-span-2 sm:text-sm"
              >
                <Sparkles className="h-4 w-4" />
                <span>Pobierz Kartę PNG (4:5 / 9:16) i Wyzwij Znajomych</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchMode(modeId, seed)}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/6 px-3 py-2 text-xs font-semibold text-[#f3ede2] transition hover:border-[#d4a054]/50"
              >
                <Play className="h-3.5 w-3.5 text-[#f0c878]" />
                <span>Powtórz ten scenariusz</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchMode("piaskownica")}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[#4ecdc4]/35 bg-[#4ecdc4]/12 px-3 py-2 text-xs font-semibold text-[#7ee8e0] transition hover:bg-[#4ecdc4]/20"
              >
                <Compass className="h-3.5 w-3.5" />
                <span>Otwórz Wolną Piaskownicę</span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-2.5 text-[11px] text-[#9e9383]">
              <button
                type="button"
                onClick={() => setSourcesOpen(true)}
                className="text-left text-[#4ecdc4] underline-offset-2 hover:underline"
              >
                Skąd to wiemy? Źródła (Kowno 1362, Bellifortis 1405) i mity 1410 →
              </button>
              <button
                type="button"
                onClick={() => setCampaignCompleted(false)}
                className="hover:text-[#f3ede2]"
              >
                Wróć do widoku 3D
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Szuflada „Skąd to wiemy? Fakty źródłowe kontra mity” */}
      <HistoricalSourcesDrawer
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
      />

      {/* Modal generowania kart PNG 4:5 i 9:16 oraz linku pojedynku */}
      {shareOpen && (
        <ShareCardModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          score={effectiveShareScore}
          rank={getRankForScore(
            effectiveShareScore,
            hadCampBackfire && effectiveShareScore < 280
          )}
          seed={seed}
          modeId={modeId}
          maxDistanceM={maxDistanceM}
          maxKineticEnergyKj={maxKineticKj}
          bestEfficiencyPct={bestEfficiencyPct}
          gdaniskoHit={hadGdaniskoHit}
          campBackfire={hadCampBackfire}
          totalBricksDislodged={totalBricksDislodged}
          captureBackdrop={captureWebGLDataUrl}
          backdropDataUrl={capturedBackdropUrl}
          community={communityData}
          challengeToken={signedChallengeToken}
          shareUrl={fallbackShareUrl}
          runId={runIdRef.current}
          salvoScores={salvoBestScores}
          durationMs={Date.now() - sessionStartMsRef.current}
          campaignCompleted={campaignCompleted}
          onChallengeSigned={(tok, url) => {
            setSignedChallengeToken(tok);
            setSignedShareUrl(url);
          }}
        />
      )}
    </main>
  );
}
