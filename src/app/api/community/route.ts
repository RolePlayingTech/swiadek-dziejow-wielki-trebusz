import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_URL } from "@/lib/config";
import { signChallengePayload } from "@/lib/challengeCodec";
import {
  MAX_COMMUNITY_BODY_BYTES,
  validateCommunitySubmission,
  validateScoreQueryParam,
  type CommunityGetResponse,
  type CommunityPostResponse,
} from "@/lib/communitySchema";
import { getCommunityStats, recordCommunityRun } from "@/lib/communityStore";
import { checkCommunityRateLimit } from "@/lib/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

type StreamReadResult =
  | { status: "ok"; text: string }
  | { status: "too_large" }
  | { status: "bad_stream"; message: string };

/**
 * Strumieniowy odczyt ciała żądania z twardym limitem `2048` bajtów.
 * Natychmiast przerywa czytanie strumienia również dla `Transfer-Encoding: chunked` bez `Content-Length`.
 */
async function readBoundedRequestBody(
  req: NextRequest,
  maxBytes: number
): Promise<StreamReadResult> {
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { status: "too_large" };
    }
  }

  if (!req.body) {
    return { status: "bad_stream", message: "Puste ciało żądania JSON." };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          return { status: "too_large" };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { status: "bad_stream", message: "Błąd odczytu strumienia żądania." };
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return { status: "bad_stream", message: "Puste ciało żądania JSON." };
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
    return { status: "ok", text };
  } catch {
    return { status: "bad_stream", message: "Nieprawidłowe kodowanie znaków UTF-8." };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const hasScoreParam = searchParams.has("score");
  const rawScore = searchParams.get("score");

  const scoreValidation = validateScoreQueryParam(rawScore, hasScoreParam);
  if (!scoreValidation.ok) {
    return NextResponse.json(
      { ok: false, error: scoreValidation.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { snapshot, percentile } = await getCommunityStats(scoreValidation.data);

  const responsePayload: CommunityGetResponse = {
    ok: true,
    ...snapshot,
    percentile,
  };

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Twardy limit rozmiaru strumienia 2048 B -> HTTP 413
  const bodyResult = await readBoundedRequestBody(req, MAX_COMMUNITY_BODY_BYTES);
  if (bodyResult.status === "too_large") {
    return NextResponse.json(
      {
        ok: false,
        error: `Przekroczono maksymalny rozmiar ładunku (${MAX_COMMUNITY_BODY_BYTES} bajtów).`,
      },
      { status: 413, headers: NO_STORE_HEADERS }
    );
  }

  if (bodyResult.status === "bad_stream") {
    return NextResponse.json(
      { ok: false, error: bodyResult.message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  // 2. Parsowanie JSON + ostra walidacja schematu i anty-cheat -> HTTP 400
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(bodyResult.text);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowa składnia JSON w ciele żądania." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const validation = validateCommunitySubmission(rawJson);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  // 3. Rate-limiting per zahaszowane IP (8 POST / 60 s, 40 POST / 3600 s) -> HTTP 429
  const rateDecision = checkCommunityRateLimit(req.headers);
  if (!rateDecision.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Zbyt wiele zgłoszeń wyników w krótkim czasie. Odczekaj chwilę przed kolejną salwą.",
        retryAfterSec: rateDecision.retryAfterSec,
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rateDecision.retryAfterSec),
        },
      }
    );
  }

  // 4. Atomowy zapis z fsync + obliczenie interpolowanego percentyla + podpis HMAC tokenu wyzwania
  const submission = validation.data;
  const { snapshot, percentile, deduplicated } = await recordCommunityRun(submission);

  const challengeToken = signChallengePayload({
    v: 1,
    seed: submission.seed,
    modeId: submission.modeId,
    score: submission.score,
    maxDistM: submission.maxDistM,
    gdanisko: submission.gdanisko,
    percentile,
    ...(submission.callsign ? { callsign: submission.callsign } : {}),
  });

  const shareUrl = `${CANONICAL_URL}?w=${challengeToken}`;

  const responsePayload: CommunityPostResponse = {
    ok: true,
    ...snapshot,
    percentile,
    challengeToken,
    shareUrl,
    ...(deduplicated ? { deduplicated: true } : {}),
  };

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
