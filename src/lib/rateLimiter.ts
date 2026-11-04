import crypto from "node:crypto";

export const MINUTE_WINDOW_MS = 60_000 as const;
export const HOUR_WINDOW_MS = 3_600_000 as const;

export const MAX_POSTS_PER_MINUTE = 8 as const;
export const MAX_POSTS_PER_HOUR = 40 as const;

const MAX_TRACKED_CLIENTS = 10_000;
const PRUNE_INTERVAL_MS = 120_000;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
  remainingMinute: number;
  remainingHour: number;
}

interface ClientRateEntry {
  timestamps: number[];
  lastSeenMs: number;
}

interface GlobalRateLimiterState {
  entries: Map<string, ClientRateEntry>;
  lastPrunedMs: number;
  instanceSalt: string;
}

const globalForRateLimiter = globalThis as unknown as {
  __trebuszRateLimiter?: GlobalRateLimiterState;
};

function getLimiterState(): GlobalRateLimiterState {
  if (!globalForRateLimiter.__trebuszRateLimiter) {
    globalForRateLimiter.__trebuszRateLimiter = {
      entries: new Map<string, ClientRateEntry>(),
      lastPrunedMs: Date.now(),
      instanceSalt:
        process.env.CHALLENGE_HMAC_SECRET ||
        crypto.randomBytes(16).toString("hex"),
    };
  }
  return globalForRateLimiter.__trebuszRateLimiter;
}

/**
 * Wyodrębnia i anonimizuje (SHA-256 z solą) identyfikator klienta z nagłówków żądania.
 * Nigdy nie przechowuje surowych adresów IP w pamięci RAM.
 */
export function hashClientIdentifier(headers: Headers): string {
  const state = getLimiterState();

  const realIp = headers.get("x-real-ip")?.trim();
  const forwardedFor = headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor
    ? forwardedFor.split(",")[0]?.trim()
    : undefined;

  let rawIdentity: string;
  if (realIp && realIp.length > 0 && realIp.length <= 128) {
    rawIdentity = `ip:${realIp}`;
  } else if (firstForwardedIp && firstForwardedIp.length > 0 && firstForwardedIp.length <= 128) {
    rawIdentity = `xff:${firstForwardedIp}`;
  } else {
    const ua = (headers.get("user-agent") || "unknown-ua").slice(0, 160);
    rawIdentity = `fallback-ua:${ua}`;
  }

  return crypto
    .createHash("sha256")
    .update(`${state.instanceSalt}|${rawIdentity}`)
    .digest("hex")
    .slice(0, 32);
}

function pruneExpiredEntries(state: GlobalRateLimiterState, nowMs: number): void {
  if (
    nowMs - state.lastPrunedMs < PRUNE_INTERVAL_MS &&
    state.entries.size < MAX_TRACKED_CLIENTS
  ) {
    return;
  }

  state.lastPrunedMs = nowMs;
  const hourCutoff = nowMs - HOUR_WINDOW_MS;

  for (const [key, entry] of state.entries.entries()) {
    const active = entry.timestamps.filter((ts) => ts > hourCutoff);
    if (active.length === 0) {
      state.entries.delete(key);
    } else {
      entry.timestamps = active;
    }
  }

  // Twardy bezpiecznik pamięci (ewikcja najstarszych wpisów w kolejności Map FIFO/LRU)
  while (state.entries.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = state.entries.keys().next().value;
    if (oldestKey === undefined) break;
    state.entries.delete(oldestKey);
  }
}

/**
 * Sprawdza i rejestruje żądanie `POST` w podwójnym oknie przesuwnym:
 * maks. 8 POST / 60 s oraz maks. 40 POST / 3600 s na zahaszowane IP.
 */
export function checkCommunityRateLimit(
  headers: Headers,
  nowMs: number = Date.now()
): RateLimitDecision {
  const state = getLimiterState();
  pruneExpiredEntries(state, nowMs);

  const clientHash = hashClientIdentifier(headers);
  const minuteCutoff = nowMs - MINUTE_WINDOW_MS;
  const hourCutoff = nowMs - HOUR_WINDOW_MS;

  const existing = state.entries.get(clientHash);
  const hourTimestamps = existing
    ? existing.timestamps.filter((ts) => ts > hourCutoff)
    : [];
  const minuteTimestamps = hourTimestamps.filter((ts) => ts > minuteCutoff);

  if (minuteTimestamps.length >= MAX_POSTS_PER_MINUTE) {
    const oldestInMinute = minuteTimestamps[0] ?? nowMs;
    const retryAfterMs = Math.max(1000, oldestInMinute + MINUTE_WINDOW_MS - nowMs);
    return {
      allowed: false,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
      remainingMinute: 0,
      remainingHour: Math.max(0, MAX_POSTS_PER_HOUR - hourTimestamps.length),
    };
  }

  if (hourTimestamps.length >= MAX_POSTS_PER_HOUR) {
    const oldestInHour = hourTimestamps[0] ?? nowMs;
    const retryAfterMs = Math.max(1000, oldestInHour + HOUR_WINDOW_MS - nowMs);
    return {
      allowed: false,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
      remainingMinute: Math.max(0, MAX_POSTS_PER_MINUTE - minuteTimestamps.length),
      remainingHour: 0,
    };
  }

  hourTimestamps.push(nowMs);
  // Odświeżenie pozycji w Map (LRU)
  state.entries.delete(clientHash);
  state.entries.set(clientHash, {
    timestamps: hourTimestamps,
    lastSeenMs: nowMs,
  });

  return {
    allowed: true,
    retryAfterSec: 0,
    remainingMinute: Math.max(0, MAX_POSTS_PER_MINUTE - (minuteTimestamps.length + 1)),
    remainingHour: Math.max(0, MAX_POSTS_PER_HOUR - hourTimestamps.length),
  };
}

/**
 * Pomocniczy reset stanu limitera (przydatny w izolowanych testach jednostkowych).
 */
export function resetRateLimiterForTests(): void {
  if (globalForRateLimiter.__trebuszRateLimiter) {
    globalForRateLimiter.__trebuszRateLimiter.entries.clear();
  }
}
