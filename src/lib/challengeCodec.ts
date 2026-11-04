import { ALLOWED_MODES, SCORE_CAP, type GameModeId } from "@/lib/config";
import type { PlayerRank, RankId } from "@/types/trebuchet";

export const DEFAULT_DEV_HMAC_SECRET = "swiadek-trebusz-dev-hmac-2026";

export interface ChallengePayload {
  v: 1;
  seed: number;
  modeId: GameModeId;
  score: number;
  maxDistM: number;
  gdanisko: boolean;
  percentile?: number;
  callsign?: string;
}

export type ChallengePayloadInput = Omit<ChallengePayload, "v"> & {
  v?: 1;
};

export interface ParsedChallenge extends ChallengePayload {
  /** Czy token posiadał zweryfikowany podpis HMAC-SHA256 serwera */
  verified: boolean;
  /** Sformatowany kod scenariusza, np. #BL-4K9X */
  seedCode: string;
}

export type ChallengeSearchInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

/**
 * Deterministyczny generator liczb pseudolosowych 32-bit (Mulberry32).
 * Zwraca funkcję generującą liczby zmiennoprzecinkowe z przedziału [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function nextRandom(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 jednoznaczne znaki (bez 0/O/1/I)

/**
 * Formatuje numeryczne ziarno do zwięzłego kodu scenariusza, np. `#BL-4K9X`.
 */
export function formatSeedCode(seed: number): string {
  let mixed = (seed >>> 0) ^ 0x9e3779b9;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;

  let chars = "";
  for (let i = 0; i < 4; i++) {
    const idx = (mixed >>> (i * 5)) & 31;
    chars += SEED_ALPHABET[idx];
  }
  return `#BL-${chars}`;
}

/**
 * Deterministyczne ziarno dnia (UTC YYYY-MM-DD) dla trybu „Wyzwanie Dnia”.
 */
export function getDailyChallengeSeed(date: Date = new Date()): number {
  const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const CALLSIGN_ALLOWED_RE = /^[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż _.-]{2,24}$/;
const CALLSIGN_HAS_ALNUM_RE = /[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/;
const BLOCKED_URL_FRAGMENTS = ["http", "www.", ".pl", ".com", ".net", ".org", "://"];

const PROFANITY_STEMS = [
  "kurw",
  "chuj",
  "huj",
  "jeb",
  "pierdol",
  "pierdal",
  "pizd",
  "cipk",
  "cipa",
  "skurw",
  "zajeb",
  "wyjeb",
  "pojeb",
  "zjeb",
  "dziwk",
  "szmat",
  "sukinsyn",
  "kutas",
  "fiut",
  "pedal",
  "cwel",
  "czarnuch",
  "hitler",
  "nazist",
  "ssman",
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "whore",
  "dick",
  "pussy",
];

function foldForProfanityCheck(text: string): string {
  const diacriticMap: Record<string, string> = {
    ą: "a",
    ć: "c",
    ę: "e",
    ł: "l",
    ń: "n",
    ó: "o",
    ś: "s",
    ź: "z",
    ż: "z",
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
  };

  let lowered = text.toLowerCase();
  let folded = "";
  for (const ch of lowered) {
    const mapped = diacriticMap[ch] ?? ch;
    if (/[a-z]/.test(mapped)) {
      folded += mapped;
    }
  }
  // Redukcja powtórzonych liter (np. "kuuurwa" -> "kurwa", ale zostawia pojedyncze i podwójne np. "ssman")
  const collapsed = folded.replace(/([a-z])\1{2,}/g, "$1");
  const singleCollapsed = folded.replace(/([a-z])\1+/g, "$1");
  return `${folded} ${collapsed} ${singleCollapsed}`;
}

/**
 * Waliduje i oczyszcza nick / zawołanie gracza zgodnie z białą listą znaków PL i filtrem wulgaryzmów.
 * Zwraca oczyszczony string lub `undefined`, jeśli nie spełnia wymogów.
 */
export function sanitizeCallsign(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (normalized.length < 2 || normalized.length > 24) return undefined;
  if (!CALLSIGN_ALLOWED_RE.test(normalized)) return undefined;
  if (!CALLSIGN_HAS_ALNUM_RE.test(normalized)) return undefined;

  const lower = normalized.toLowerCase();
  for (const frag of BLOCKED_URL_FRAGMENTS) {
    if (lower.includes(frag)) return undefined;
  }

  const foldedVariants = foldForProfanityCheck(normalized);
  for (const stem of PROFANITY_STEMS) {
    if (foldedVariants.includes(stem)) {
      return undefined;
    }
  }

  return normalized;
}

/* ============================================================================
 * Izomorficzny SHA-256 + HMAC-SHA256 + Base64URL (0 zależności od node:crypto,
 * identyczny co do bitu z RFC 6234 / RFC 2104, bezpieczny w SSR i "use client")
 * ========================================================================== */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLenHi = Math.floor((message.length * 8) / 4294967296);
  const bitLenLo = (message.length * 8) >>> 0;
  const paddedLen = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function hmacSha256(secret: string, message: string): Uint8Array {
  const encoder = new TextEncoder();
  let keyBytes = encoder.encode(secret);
  if (keyBytes.length > 64) {
    keyBytes = new Uint8Array(sha256Bytes(keyBytes));
  }

  const blockKey = new Uint8Array(64);
  blockKey.set(keyBytes);

  const oKeyPad = new Uint8Array(64);
  const iKeyPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oKeyPad[i] = blockKey[i] ^ 0x5c;
    iKeyPad[i] = blockKey[i] ^ 0x36;
  }

  const msgBytes = encoder.encode(message);
  const innerInput = new Uint8Array(64 + msgBytes.length);
  innerInput.set(iKeyPad, 0);
  innerInput.set(msgBytes, 64);
  const innerHash = sha256Bytes(innerInput);

  const outerInput = new Uint8Array(64 + 32);
  outerInput.set(oKeyPad, 0);
  outerInput.set(innerHash, 64);
  return sha256Bytes(outerInput);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >>> 18) & 63] +
      B64_CHARS[(n >>> 12) & 63] +
      B64_CHARS[(n >>> 6) & 63] +
      B64_CHARS[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64_CHARS[(n >>> 18) & 63] + B64_CHARS[(n >>> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_CHARS[(n >>> 18) & 63] +
      B64_CHARS[(n >>> 12) & 63] +
      B64_CHARS[(n >>> 6) & 63];
  }
  return out;
}

function decodeBase64Url(str: string): Uint8Array | null {
  if (!str || str.length > 1024 || !/^[A-Za-z0-9\-_]+$/.test(str)) {
    return null;
  }
  const rem = str.length % 4;
  if (rem === 1) return null;

  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) {
    lookup[B64_CHARS.charCodeAt(i)] = i;
  }

  const outLen = Math.floor((str.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 128) return null;
    const val = lookup[code];
    if (val < 0) return null;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx++] = (buffer >>> bits) & 0xff;
    }
  }
  return out;
}

function isAllowedMode(mode: unknown): mode is GameModeId {
  return typeof mode === "string" && (ALLOWED_MODES as readonly string[]).includes(mode);
}

function normalizePayloadFields(
  input: ChallengePayloadInput,
  includeSignedExtras: boolean
): ChallengePayload {
  const seed = Number.isFinite(input.seed) ? input.seed >>> 0 : 0;
  const modeId: GameModeId = isAllowedMode(input.modeId) ? input.modeId : "kampania";
  const clampedScore = Number.isFinite(input.score)
    ? Math.max(0, Math.min(SCORE_CAP, Math.round(input.score)))
    : 0;
  const clampedDist = Number.isFinite(input.maxDistM)
    ? Math.round(Math.max(-250, Math.min(500, input.maxDistM)) * 10) / 10
    : 0;

  const normalized: ChallengePayload = {
    v: 1,
    seed,
    modeId,
    score: clampedScore,
    maxDistM: clampedDist,
    gdanisko: Boolean(input.gdanisko),
  };

  if (includeSignedExtras) {
    if (
      typeof input.percentile === "number" &&
      Number.isFinite(input.percentile) &&
      input.percentile >= 1 &&
      input.percentile <= 99
    ) {
      normalized.percentile = Math.round(input.percentile);
    }
    const cleanCallsign = sanitizeCallsign(input.callsign);
    if (cleanCallsign) {
      normalized.callsign = cleanCallsign;
    }
  }

  return normalized;
}

function validateDecodedPayloadObject(
  raw: unknown,
  verified: boolean
): ChallengePayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (obj.v !== 1) return null;
  if (typeof obj.seed !== "number" || !Number.isInteger(obj.seed) || obj.seed < 0 || obj.seed > 0xffffffff) {
    return null;
  }
  if (!isAllowedMode(obj.modeId)) return null;
  if (
    typeof obj.score !== "number" ||
    !Number.isInteger(obj.score) ||
    obj.score < 0 ||
    obj.score > SCORE_CAP
  ) {
    return null;
  }
  if (
    typeof obj.maxDistM !== "number" ||
    !Number.isFinite(obj.maxDistM) ||
    obj.maxDistM < -250 ||
    obj.maxDistM > 500
  ) {
    return null;
  }
  if (typeof obj.gdanisko !== "boolean") return null;

  const payload: ChallengePayload = {
    v: 1,
    seed: obj.seed >>> 0,
    modeId: obj.modeId,
    score: obj.score,
    maxDistM: Math.round(obj.maxDistM * 10) / 10,
    gdanisko: obj.gdanisko,
  };

  // Pole callsign i percentile są honorowane WYŁĄCZNIE przy zweryfikowanym podpisie HMAC!
  if (verified) {
    if (
      typeof obj.percentile === "number" &&
      Number.isInteger(obj.percentile) &&
      obj.percentile >= 1 &&
      obj.percentile <= 99
    ) {
      payload.percentile = obj.percentile;
    }
    const cleanCallsign = sanitizeCallsign(obj.callsign);
    if (cleanCallsign) {
      payload.callsign = cleanCallsign;
    }
  }

  return payload;
}

function getHmacSecret(secretOverride?: string): string {
  if (typeof secretOverride === "string" && secretOverride.length > 0) {
    return secretOverride;
  }
  if (typeof process !== "undefined" && process.env && process.env.CHALLENGE_HMAC_SECRET) {
    return process.env.CHALLENGE_HMAC_SECRET;
  }
  return DEFAULT_DEV_HMAC_SECRET;
}

/**
 * Koduje niepodpisany token wyzwania po stronie klienta (bezpieczny tryb offline, bez `callsign`).
 */
export function encodeUnsignedChallenge(input: ChallengePayloadInput): string {
  const payload = normalizePayloadFields(input, false);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  return encodeBase64Url(jsonBytes);
}

/**
 * Podpisuje kryptograficznie ładunek wyzwania kluczem HMAC-SHA256 po stronie serwera.
 */
export function signChallengePayload(
  input: ChallengePayloadInput,
  secretOverride?: string
): string {
  const payload = normalizePayloadFields(input, true);
  const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sigBytes = hmacSha256(getHmacSecret(secretOverride), payloadB64);
  const sigB64 = encodeBase64Url(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Wyciąga surowy parametr `?w=` lub alias `?challenge=` z dowolnego formatu wejściowego.
 */
export function extractChallengeParam(input: ChallengeSearchInput): string | null {
  if (!input) return null;

  if (input instanceof URLSearchParams) {
    const raw = input.get("w") ?? input.get("challenge");
    return raw && raw.trim().length > 0 ? raw.trim() : null;
  }

  if (typeof input === "object") {
    const candidate = input.w ?? input.challenge;
    const str = Array.isArray(candidate) ? candidate[0] : candidate;
    return typeof str === "string" && str.trim().length > 0 ? str.trim() : null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > 2048) return null;

    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("?") ||
      trimmed.includes("w=") ||
      trimmed.includes("challenge=")
    ) {
      try {
        const queryPart = trimmed.includes("?") ? trimmed.slice(trimmed.indexOf("?") + 1) : trimmed;
        const sp = new URLSearchParams(queryPart);
        const extracted = sp.get("w") ?? sp.get("challenge");
        if (extracted && extracted.trim().length > 0) {
          return extracted.trim();
        }
      } catch {
        return null;
      }
    }

    return trimmed;
  }

  return null;
}

/**
 * Parsuje i weryfikuje token wyzwania (`?w=` lub `?challenge=`).
 * - Przy poprawnym podpisie HMAC-SHA256 zwraca `verified: true` oraz przepuszczony przez filtr `callsign`.
 * - Dla tokenów 1-częściowych (`encodeUnsignedChallenge`) działa w bezpiecznym trybie bez podpisu (`verified: false`, bez `callsign`).
 * - Dla uszkodzonych lub sfałszowanych podpisów na serwerze zwraca `null`.
 */
export function parseAndVerifyChallenge(
  input: ChallengeSearchInput,
  secretOverride?: string
): ParsedChallenge | null {
  const token = extractChallengeParam(input);
  if (!token || token.length > 1024) return null;

  const parts = token.split(".");
  if (parts.length > 2) return null;

  const payloadB64 = parts[0];
  if (!payloadB64) return null;

  let verified = false;

  if (parts.length === 2) {
    const sigB64 = parts[1];
    const providedSig = decodeBase64Url(sigB64);
    if (!providedSig || providedSig.length !== 32) {
      return null;
    }

    const expectedSig = hmacSha256(getHmacSecret(secretOverride), payloadB64);
    const sigMatches = timingSafeEqualBytes(providedSig, expectedSig);

    if (sigMatches) {
      verified = true;
    } else if (typeof window === "undefined") {
      // Na serwerze sfałszowany/uszkodzony podpis HMAC jest bezwzględnie odrzucany!
      return null;
    } else {
      // W przeglądarce (gdzie produkcyjny CHALLENGE_HMAC_SECRET nie jest publiczny)
      // pozwalamy odczytać samo ziarno i wynik rywala w trybie niezweryfikowanym (bez callsign).
      verified = false;
    }
  }

  const decodedBytes = decodeBase64Url(payloadB64);
  if (!decodedBytes || decodedBytes.length > 768) return null;

  let parsedJson: unknown;
  try {
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes);
    parsedJson = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const validPayload = validateDecodedPayloadObject(parsedJson, verified);
  if (!validPayload) return null;

  return {
    ...validPayload,
    verified,
    seedCode: formatSeedCode(validPayload.seed),
  };
}

/**
 * Kanoniczna tabela 6 rang historycznych (zgodna z `RankId` w `src/types/trebuchet.ts`)
 * wykorzystywana przez `/api/og` oraz jako bezpieczny fallback w `ShareCardModal`.
 */
export const FALLBACK_PLAYER_RANKS: readonly PlayerRank[] = [
  {
    id: "agent_zakonu" satisfies RankId,
    minScore: 0,
    titlePl: "Tajny Agent Wielkiego Mistrza",
    badgeIcon: "🕵️",
    epigraphPl: "Krzyżacy biją Ci brawo z blanków, a własny obóz gasi namioty.",
    swiadekVerdictPl:
      "Wielki Mistrz wysłał Ci właśnie sakiewkę grzywien w podzięce. Zamiast w zamek, posłałeś głaz prosto w nasze własne namioty!",
  },
  {
    id: "kopacz_studni" satisfies RankId,
    minScore: 100,
    titlePl: "Kopacz Fosy i Kret Przedpola",
    badgeIcon: "🕳️",
    epigraphPl: "Ziemia przed machiną zryta jak po dzikach, mur zamkowy nietknięty.",
    swiadekVerdictPl:
      "Jeżeli celem było wykopanie nowej studni przed fosą — pełen sukces. Tylko zamek Zakonu wciąż stoi nietknięty.",
  },
  {
    id: "czeladnik" satisfies RankId,
    minScore: 280,
    titlePl: "Czeladnik Ciesielski",
    badgeIcon: "🪵",
    epigraphPl: "Dębowa belka już słucha Twojej ręki, lecz palec spustowy bywa kapryśny.",
    swiadekVerdictPl:
      "Pierwsze cegły posypały się do fosy! Jeszcze parę stopni korekty na żelaznym palcu i krzyżacki mur zacznie pękać.",
  },
  {
    id: "puszkarz" satisfies RankId,
    minScore: 480,
    titlePl: "Starszy Puszkarz Królewski",
    badgeIcon: "⚙️",
    epigraphPl: "Rozumiesz taniec wahliwej skrzyni i procy pod podmuchami wiatru.",
    swiadekVerdictPl:
      "Solidna inżynierska robota! Wahliwa skrzynia oddała energię jak w zegarku, a obrońcy uciekają z hurdycji.",
  },
  {
    id: "mistrz_kowna" satisfies RankId,
    minScore: 680,
    titlePl: "Mistrz Oblężniczy spod Kowna",
    badgeIcon: "🏰",
    epigraphPl: "Każda salwa kruszy gotycką kurtynę z chirurgiczną precyzją.",
    swiadekVerdictPl:
      "Tak strzelano pod Kownem w 1362 roku! Sto kilogramów granitu wchodzi w ceglany mur jak gorący nóż w masło.",
  },
  {
    id: "postrach_zakonu" satisfies RankId,
    minScore: 850,
    titlePl: "Postrach Zakonu · Arcymistrz Blidy",
    badgeIcon: "👑",
    epigraphPl: "Potrójne wahadło Lagrange’a nie ma przed Tobą najmniejszej tajemnicy.",
    swiadekVerdictPl:
      "Arcydzieło średniowiecznej balistyki! Gdybyś stał pod Malborkiem w 1410 roku, zamek padłby przed wieczorem.",
  },
];

export function resolveRankForScore(score: number): PlayerRank {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(SCORE_CAP, Math.round(score))) : 0;
  let matched = FALLBACK_PLAYER_RANKS[0];
  for (const rank of FALLBACK_PLAYER_RANKS) {
    if (safeScore >= rank.minScore) {
      matched = rank;
    }
  }
  return matched;
}
