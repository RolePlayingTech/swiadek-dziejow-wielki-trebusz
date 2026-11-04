import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { BUCKET_COUNT, SCORE_CAP } from "@/lib/config";
import type {
  CommunityStatsSnapshot,
  CommunitySubmissionPayload,
} from "@/lib/communitySchema";

export const COMMUNITY_STORE_FILENAME = "wielki-trebusz-community.json";
const MAX_RECENT_RUN_IDS = 500;
const BUCKET_WIDTH = SCORE_CAP / BUCKET_COUNT; // 50 pkt na koszyk (0..49, 50..99, ..., 950..1000)

export interface PersistedCommunityData {
  version: 1;
  buckets: number[];
  totalRuns: number;
  scoreSum: number;
  maxScore: number;
  gdaniskoHits: number;
  campBackfires: number;
  recentRunIds: string[];
  updatedAtIso: string;
}

/**
 * Kalibracyjny rozkład początkowy z testów poligonowych (48 kampanii):
 * realistyczna krzywa z garbem samobójów w obóz (koszyk 0–1) oraz głównym skupiskiem puszkarzy (400–700 pkt),
 * dzięki czemu wykres 20 słupków i percentyle są czytelne już od pierwszego gracza na nowej instancji.
 */
function createSeededInitialData(): PersistedCommunityData {
  const buckets = [
    4, // 0..49   (samobóje w obóz / wbicie w ziemię)
    3, // 50..99
    2, // 100..149
    2, // 150..199
    3, // 200..249
    3, // 250..299
    3, // 300..349
    4, // 350..399
    4, // 400..449
    5, // 450..499
    4, // 500..549
    3, // 550..599
    2, // 600..649
    2, // 650..699
    1, // 700..749
    1, // 750..799
    1, // 800..849
    1, // 850..899
    0, // 900..949
    0, // 950..1000
  ];
  const totalRuns = buckets.reduce((acc, n) => acc + n, 0); // 48
  const scoreSum = buckets.reduce(
    (acc, count, idx) => acc + count * Math.round((idx + 0.5) * BUCKET_WIDTH),
    0
  );

  return {
    version: 1,
    buckets,
    totalRuns,
    scoreSum,
    maxScore: 874,
    gdaniskoHits: 7,
    campBackfires: 19,
    recentRunIds: [],
    updatedAtIso: new Date().toISOString(),
  };
}

interface CommunityStoreSingleton {
  data: PersistedCommunityData | null;
  loadedPath: string | null;
  writeQueue: Promise<void>;
}

const globalForCommunityStore = globalThis as unknown as {
  __trebuszCommunityStore?: CommunityStoreSingleton;
};

function getSingleton(): CommunityStoreSingleton {
  if (!globalForCommunityStore.__trebuszCommunityStore) {
    globalForCommunityStore.__trebuszCommunityStore = {
      data: null,
      loadedPath: null,
      writeQueue: Promise.resolve(),
    };
  }
  return globalForCommunityStore.__trebuszCommunityStore;
}

export function resolveCommunityDataDir(): string {
  const envDir = process.env.PERSISTENT_DATA_DIR?.trim();
  if (envDir && envDir.length > 0) {
    return path.resolve(envDir);
  }
  return path.join(process.cwd(), "data");
}

export function resolveCommunityFilePath(): string {
  return path.join(resolveCommunityDataDir(), COMMUNITY_STORE_FILENAME);
}

export function scoreToBucketIndex(score: number): number {
  const clamped = Math.max(0, Math.min(SCORE_CAP, score));
  const rawIdx = Math.floor(clamped / BUCKET_WIDTH);
  return Math.max(0, Math.min(BUCKET_COUNT - 1, rawIdx));
}

/**
 * Oblicza liniowo interpolowany percentyl (1..99) na podstawie 20 koszyków rozkładu wyników.
 */
export function computeInterpolatedPercentile(
  buckets: readonly number[],
  score: number
): number {
  const clampedScore = Math.max(0, Math.min(SCORE_CAP, score));
  const total = buckets.reduce((acc, v) => acc + (Number.isFinite(v) && v > 0 ? v : 0), 0);

  if (total <= 0) {
    return Math.max(1, Math.min(99, Math.round((clampedScore / SCORE_CAP) * 98 + 1)));
  }

  const bucketIdx = scoreToBucketIndex(clampedScore);
  let countBelow = 0;
  for (let i = 0; i < bucketIdx; i++) {
    countBelow += Math.max(0, buckets[i] ?? 0);
  }

  const bucketLow = bucketIdx * BUCKET_WIDTH;
  const bucketHigh =
    bucketIdx === BUCKET_COUNT - 1 ? SCORE_CAP : (bucketIdx + 1) * BUCKET_WIDTH;
  const span = Math.max(1, bucketHigh - bucketLow);
  const fractionWithinBucket = Math.max(
    0,
    Math.min(1, (clampedScore - bucketLow) / span)
  );

  const countInBucket = Math.max(0, buckets[bucketIdx] ?? 0);
  const effectiveBelow = countBelow + countInBucket * fractionWithinBucket;
  const rawPct = (effectiveBelow / total) * 100;

  return Math.max(1, Math.min(99, Math.round(rawPct)));
}

function isValidPersistedData(raw: unknown): raw is PersistedCommunityData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (!Array.isArray(obj.buckets) || obj.buckets.length !== BUCKET_COUNT) return false;
  for (const b of obj.buckets) {
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0) return false;
  }
  if (typeof obj.totalRuns !== "number" || !Number.isInteger(obj.totalRuns) || obj.totalRuns < 0) {
    return false;
  }
  if (typeof obj.scoreSum !== "number" || !Number.isFinite(obj.scoreSum) || obj.scoreSum < 0) {
    return false;
  }
  if (
    typeof obj.maxScore !== "number" ||
    !Number.isInteger(obj.maxScore) ||
    obj.maxScore < 0 ||
    obj.maxScore > SCORE_CAP
  ) {
    return false;
  }
  if (
    typeof obj.gdaniskoHits !== "number" ||
    !Number.isInteger(obj.gdaniskoHits) ||
    obj.gdaniskoHits < 0
  ) {
    return false;
  }
  if (
    typeof obj.campBackfires !== "number" ||
    !Number.isInteger(obj.campBackfires) ||
    obj.campBackfires < 0
  ) {
    return false;
  }
  if (!Array.isArray(obj.recentRunIds)) return false;
  return true;
}

/**
 * Atomowy zapis pliku JSON z prawdziwym wywołaniem systemowym `fsync` na deskryptorze pliku
 * oraz unikalnym sufiksem `.tmp` przed `rename`.
 */
async function atomicWriteJsonWithFsync(
  targetFilePath: string,
  payload: PersistedCommunityData
): Promise<void> {
  const dir = path.dirname(targetFilePath);
  await fs.mkdir(dir, { recursive: true });

  const uniqueSuffix = `${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}`;
  const tmpFilePath = `${targetFilePath}.${uniqueSuffix}.tmp`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tmpFilePath, "w", 0o600);
    await handle.writeFile(serialized, { encoding: "utf-8" });
    await handle.sync();
    await handle.close();
    handle = null;

    // Krótki retry na Windows EPERM przy równoległym skanowaniu antywirusowym; na Linux POSIX atomowy w 1 kroku
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(tmpFilePath, targetFilePath);
        return;
      } catch (renameErr) {
        const code = (renameErr as NodeJS.ErrnoException)?.code;
        if (attempt < 2 && (code === "EPERM" || code === "EACCES" || code === "EBUSY")) {
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
          continue;
        }
        throw renameErr;
      }
    }
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tmpFilePath).catch(() => {});
  }
}

async function ensureStoreLoaded(): Promise<PersistedCommunityData> {
  const singleton = getSingleton();
  const targetPath = resolveCommunityFilePath();

  if (singleton.data && singleton.loadedPath === targetPath) {
    return singleton.data;
  }

  try {
    const rawText = await fs.readFile(targetPath, "utf-8");
    const parsed: unknown = JSON.parse(rawText);
    if (isValidPersistedData(parsed)) {
      singleton.data = {
        ...parsed,
        buckets: [...parsed.buckets],
        recentRunIds: parsed.recentRunIds
          .filter((id): id is string => typeof id === "string")
          .slice(-MAX_RECENT_RUN_IDS),
      };
      singleton.loadedPath = targetPath;
      return singleton.data;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      // W razie uszkodzenia pliku na dysku inicjalizujemy świeży stan kalibracyjny i nadpisujemy atomowo
    }
  }

  const seeded = createSeededInitialData();
  singleton.data = seeded;
  singleton.loadedPath = targetPath;

  try {
    await atomicWriteJsonWithFsync(targetPath, seeded);
  } catch {
    // Nawet na systemie plików tylko-do-odczytu stan w RAM nadal działa bezbłędnie
  }

  return seeded;
}

function toSnapshot(data: PersistedCommunityData): CommunityStatsSnapshot {
  const avgScore =
    data.totalRuns > 0
      ? Math.max(0, Math.min(SCORE_CAP, Math.round(data.scoreSum / data.totalRuns)))
      : 0;

  return {
    buckets: [...data.buckets],
    totalRuns: data.totalRuns,
    avgScore,
    maxScore: data.maxScore,
    gdaniskoHits: data.gdaniskoHits,
    campBackfires: data.campBackfires,
  };
}

/**
 * Zwraca bieżące statystyki społeczności z kesza w RAM (z leniwym wczytaniem z dysku)
 * oraz opcjonalnie obliczony interpolowany percentyl dla wyniku `score`.
 */
export async function getCommunityStats(score?: number | null): Promise<{
  snapshot: CommunityStatsSnapshot;
  percentile: number | null;
}> {
  const data = await ensureStoreLoaded();
  const snapshot = toSnapshot(data);
  const percentile =
    typeof score === "number" && Number.isFinite(score)
      ? computeInterpolatedPercentile(data.buckets, score)
      : null;

  return { snapshot, percentile };
}

/**
 * Rejestruje nową ukończoną sesję w sposób zserializowany (mutex Promise),
 * aktualizując kesz w RAM i zapisując plik atomowo z `fsync`.
 */
export async function recordCommunityRun(
  submission: CommunitySubmissionPayload
): Promise<{
  snapshot: CommunityStatsSnapshot;
  percentile: number;
  deduplicated: boolean;
}> {
  const singleton = getSingleton();

  let result!: {
    snapshot: CommunityStatsSnapshot;
    percentile: number;
    deduplicated: boolean;
  };

  const task = singleton.writeQueue.then(async () => {
    const current = await ensureStoreLoaded();
    const targetPath = resolveCommunityFilePath();

    // Idempotentna ochrona przed duplikatami tej samej sesji (np. ponowienie sieciowe)
    if (current.recentRunIds.includes(submission.runId)) {
      result = {
        snapshot: toSnapshot(current),
        percentile: computeInterpolatedPercentile(current.buckets, submission.score),
        deduplicated: true,
      };
      return;
    }

    const nextBuckets = [...current.buckets];
    const bucketIdx = scoreToBucketIndex(submission.score);
    nextBuckets[bucketIdx] = (nextBuckets[bucketIdx] ?? 0) + 1;

    const nextRunIds = [...current.recentRunIds, submission.runId].slice(
      -MAX_RECENT_RUN_IDS
    );

    const updated: PersistedCommunityData = {
      version: 1,
      buckets: nextBuckets,
      totalRuns: current.totalRuns + 1,
      scoreSum: current.scoreSum + submission.score,
      maxScore: Math.max(current.maxScore, submission.score),
      gdaniskoHits: current.gdaniskoHits + (submission.gdanisko ? 1 : 0),
      campBackfires: current.campBackfires + (submission.campBackfire ? 1 : 0),
      recentRunIds: nextRunIds,
      updatedAtIso: new Date().toISOString(),
    };

    await atomicWriteJsonWithFsync(targetPath, updated);

    singleton.data = updated;
    singleton.loadedPath = targetPath;

    result = {
      snapshot: toSnapshot(updated),
      percentile: computeInterpolatedPercentile(updated.buckets, submission.score),
      deduplicated: false,
    };
  });

  singleton.writeQueue = task.catch(() => {});
  await task;
  return result;
}

/**
 * Pomocniczy reset kesza RAM (przydatny przy zmianie `PERSISTENT_DATA_DIR` w testach).
 */
export function invalidateCommunityCacheForTests(): void {
  const singleton = getSingleton();
  singleton.data = null;
  singleton.loadedPath = null;
}
