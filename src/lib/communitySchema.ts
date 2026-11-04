import {
  ALLOWED_MODES,
  MAX_RUN_MS,
  MIN_RUN_MS,
  SCORE_CAP,
  type GameModeId,
} from "@/lib/config";
import { sanitizeCallsign } from "@/lib/challengeCodec";

export const MAX_COMMUNITY_BODY_BYTES = 2048 as const;

export interface CommunitySubmissionPayload {
  /** Unikalny identyfikator ukończonej sesji (np. UUID v4), 8..64 znaki [A-Za-z0-9_-] */
  runId: string;
  /** Tryb rozgrywki ("kampania" | "dzienny" | "piaskownica") */
  modeId: GameModeId;
  /** Ziarno scenariusza (uint32: 0..4294967295) */
  seed: number;
  /** Łączny wynik punktowy (0..1000, liczba całkowita) */
  score: number;
  /** Czas trwania sesji w milisekundach (4000..3600000) */
  durationMs: number;
  /** Najdalszy osiągnięty dystans rzutu [m] (-250..500) */
  maxDistM: number;
  /** Czy w trakcie sesji trafiono w krzyżackie Gdanisko */
  gdanisko: boolean;
  /** Czy w trakcie sesji oddano samobójczy strzał we własny obóz */
  campBackfire: boolean;
  /** Opcjonalny rozkład punktów z poszczególnych salw (1..4 liczby całkowite 0..250) */
  salvoScores?: number[];
  /** Opcjonalny nick / zawołanie gracza (2..24 znaki PL, biała lista + filtr wulgaryzmów) */
  callsign?: string;
}

export interface CommunityStatsSnapshot {
  buckets: number[];
  totalRuns: number;
  avgScore: number;
  maxScore: number;
  gdaniskoHits: number;
  campBackfires: number;
}

export interface CommunityGetResponse extends CommunityStatsSnapshot {
  ok: true;
  percentile: number | null;
}

export interface CommunityPostResponse extends CommunityStatsSnapshot {
  ok: true;
  percentile: number;
  challengeToken: string;
  shareUrl: string;
  deduplicated?: boolean;
}

export type SchemaValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ALLOWED_SUBMISSION_KEYS = new Set<string>([
  "runId",
  "modeId",
  "seed",
  "score",
  "durationMs",
  "maxDistM",
  "gdanisko",
  "campBackfire",
  "salvoScores",
  "callsign",
]);

const RUN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Ostra walidacja ładunku `POST /api/community` (zero cichych wartości domyślnych + reguły anty-cheat).
 */
export function validateCommunitySubmission(
  raw: unknown
): SchemaValidationResult<CommunitySubmissionPayload> {
  if (!isPlainRecord(raw)) {
    return { ok: false, error: "Ciało żądania musi być obiektem JSON." };
  }

  // Odrzucenie wszelkich nieznanych nadmiarowych kluczy oraz prób prototype pollution
  const rawKeys = Object.keys(raw);
  for (const key of rawKeys) {
    if (!ALLOWED_SUBMISSION_KEYS.has(key)) {
      return { ok: false, error: `Nieznane nadmiarowe pole w obiekcie JSON: "${key}".` };
    }
  }

  // 1. runId
  if (typeof raw.runId !== "string" || !RUN_ID_RE.test(raw.runId)) {
    return {
      ok: false,
      error: "Pole runId jest wymagane i musi mieć 8–64 znaków alfanumerycznych ([A-Za-z0-9_-]).",
    };
  }

  // 2. modeId
  if (
    typeof raw.modeId !== "string" ||
    !(ALLOWED_MODES as readonly string[]).includes(raw.modeId)
  ) {
    return {
      ok: false,
      error: `Nieprawidłowe pole modeId. Dozwolone wartości: ${ALLOWED_MODES.join(", ")}.`,
    };
  }
  const modeId = raw.modeId as GameModeId;

  // 3. seed
  if (
    typeof raw.seed !== "number" ||
    !Number.isInteger(raw.seed) ||
    raw.seed < 0 ||
    raw.seed > 0xffffffff
  ) {
    return {
      ok: false,
      error: "Pole seed musi być liczbą całkowitą uint32 (0..4294967295).",
    };
  }

  // 4. score
  if (
    typeof raw.score !== "number" ||
    !Number.isInteger(raw.score) ||
    raw.score < 0 ||
    raw.score > SCORE_CAP
  ) {
    return {
      ok: false,
      error: `Pole score musi być liczbą całkowitą z przedziału 0..${SCORE_CAP}.`,
    };
  }

  // 5. durationMs
  if (
    typeof raw.durationMs !== "number" ||
    !Number.isFinite(raw.durationMs) ||
    raw.durationMs < MIN_RUN_MS ||
    raw.durationMs > MAX_RUN_MS
  ) {
    return {
      ok: false,
      error: `Pole durationMs musi być liczbą skończoną z przedziału ${MIN_RUN_MS}..${MAX_RUN_MS} ms.`,
    };
  }

  // 6. maxDistM
  if (
    typeof raw.maxDistM !== "number" ||
    !Number.isFinite(raw.maxDistM) ||
    raw.maxDistM < -250 ||
    raw.maxDistM > 500
  ) {
    return {
      ok: false,
      error: "Pole maxDistM musi być liczbą skończoną z fizycznego przedziału -250..500 m.",
    };
  }

  // 7. gdanisko
  if (typeof raw.gdanisko !== "boolean") {
    return {
      ok: false,
      error: "Pole gdanisko jest wymagane i musi mieć typ boolean.",
    };
  }

  // 8. campBackfire
  if (typeof raw.campBackfire !== "boolean") {
    return {
      ok: false,
      error: "Pole campBackfire jest wymagane i musi mieć typ boolean.",
    };
  }

  // 9. Opcjonalne salvoScores
  let salvoScores: number[] | undefined;
  if ("salvoScores" in raw && raw.salvoScores !== undefined) {
    if (
      !Array.isArray(raw.salvoScores) ||
      raw.salvoScores.length < 1 ||
      raw.salvoScores.length > 4
    ) {
      return {
        ok: false,
        error: "Pole salvoScores musi być tablicą 1..4 liczb całkowitych.",
      };
    }
    let sum = 0;
    const cleanSalvos: number[] = [];
    for (const item of raw.salvoScores) {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 250) {
        return {
          ok: false,
          error: "Każdy element salvoScores musi być liczbą całkowitą z zakresu 0..250.",
        };
      }
      sum += item;
      cleanSalvos.push(item);
    }
    if ((modeId === "kampania" || modeId === "dzienny") && sum !== raw.score) {
      return {
        ok: false,
        error: "Niespójność anty-cheat: suma punktów salw nie zgadza się z polem score.",
      };
    }
    salvoScores = cleanSalvos;
  }

  // 10. Opcjonalne callsign
  let callsign: string | undefined;
  if ("callsign" in raw && raw.callsign !== undefined) {
    if (typeof raw.callsign !== "string") {
      return { ok: false, error: "Pole callsign musi być ciągiem znaków." };
    }
    if (raw.callsign.trim().length > 0) {
      const sanitized = sanitizeCallsign(raw.callsign);
      if (!sanitized) {
        return {
          ok: false,
          error:
            "Pole callsign zawiera niedozwolone znaki, niewłaściwą długość (wymagane 2–24 znaki PL) lub zablokowane słownictwo.",
        };
      }
      callsign = sanitized;
    }
  }

  // 11. Fizyczne reguły anty-cheat
  if (raw.score >= 150 && raw.maxDistM < 60) {
    return {
      ok: false,
      error:
        "Odrzucono przez anty-cheat: wysoki wynik punktowy jest fizycznie niemożliwy przy rzucie krótszym niż 60 m.",
    };
  }

  if (
    (modeId === "kampania" || modeId === "dzienny") &&
    raw.score > 600 &&
    raw.durationMs < 8_000
  ) {
    return {
      ok: false,
      error:
        "Odrzucono przez anty-cheat: wynik powyżej 600 pkt w kampanii 4 salw wymaga co najmniej 8000 ms lotu pocisków.",
    };
  }

  if (raw.gdanisko && (raw.maxDistM < 120 || raw.score < 50)) {
    return {
      ok: false,
      error:
        "Odrzucono przez anty-cheat: trafienie w zamkowe Gdanisko jest niemożliwe przy dystansie poniżej 120 m lub wyniku poniżej 50 pkt.",
    };
  }

  if (raw.score === SCORE_CAP && raw.campBackfire) {
    return {
      ok: false,
      error:
        "Odrzucono przez anty-cheat: maksymalny wynik 1000/1000 pkt wyklucza samobójczy strzał we własny obóz.",
    };
  }

  const validated: CommunitySubmissionPayload = {
    runId: raw.runId,
    modeId,
    seed: raw.seed >>> 0,
    score: raw.score,
    durationMs: Math.round(raw.durationMs),
    maxDistM: Math.round(raw.maxDistM * 10) / 10,
    gdanisko: raw.gdanisko,
    campBackfire: raw.campBackfire,
    ...(salvoScores ? { salvoScores } : {}),
    ...(callsign ? { callsign } : {}),
  };

  return { ok: true, data: validated };
}

/**
 * Waliduje opcjonalny parametr zapytania `?score=...` w `GET /api/community`.
 */
export function validateScoreQueryParam(
  rawScore: string | null,
  hasParam: boolean
): SchemaValidationResult<number | null> {
  if (!hasParam) {
    return { ok: true, data: null };
  }
  if (rawScore === null || rawScore.trim().length === 0) {
    return { ok: false, error: "Parametr ?score= nie może być pusty." };
  }
  const trimmed = rawScore.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return {
      ok: false,
      error: `Parametr ?score= musi być prawidłową liczbą z zakresu 0..${SCORE_CAP}.`,
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > SCORE_CAP) {
    return {
      ok: false,
      error: `Parametr ?score= musi mieścić się w przedziale 0..${SCORE_CAP}.`,
    };
  }
  return { ok: true, data: Math.round(parsed) };
}
