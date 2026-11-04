import fs from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import {
  parseAndVerifyChallenge,
  resolveRankForScore,
  type ParsedChallenge,
} from "@/lib/challengeCodec";
import type { GameModeId } from "@/lib/config";

export const runtime = "nodejs";

interface CachedOgAssets {
  playfairBold: ArrayBuffer;
  spaceGroteskSemiBold: ArrayBuffer;
  jetBrainsMonoBold: ArrayBuffer;
  portraitDataUri: string | null;
}

let cachedAssetsPromise: Promise<CachedOgAssets | null> | null = null;

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

async function readPortraitDataUri(): Promise<string | null> {
  try {
    const primaryBuf = await fs.readFile(
      /* turbopackIgnore: true */ path.join(process.cwd(), "public", "swiadek-portrait.jpg")
    );
    if (primaryBuf.byteLength > 1024) {
      return `data:image/jpeg;base64,${primaryBuf.toString("base64")}`;
    }
  } catch {
    // Przejdź do fallbacku
  }
  try {
    const fallbackBuf = await fs.readFile(
      /* turbopackIgnore: true */ path.join(process.cwd(), "public", "swiadek-ref.jpg")
    );
    if (fallbackBuf.byteLength > 1024) {
      return `data:image/jpeg;base64,${fallbackBuf.toString("base64")}`;
    }
  } catch {
    // Brak pliku portretu
  }
  return null;
}

function getOgAssets(): Promise<CachedOgAssets | null> {
  if (!cachedAssetsPromise) {
    cachedAssetsPromise = (async () => {
      try {
        const [playfairBuf, spaceBuf, monoBuf, portraitDataUri] = await Promise.all([
          fs.readFile(path.join(process.cwd(), "public", "fonts", "PlayfairDisplay-Bold.ttf")),
          fs.readFile(path.join(process.cwd(), "public", "fonts", "SpaceGrotesk-SemiBold.ttf")),
          fs.readFile(path.join(process.cwd(), "public", "fonts", "JetBrainsMono-Bold.ttf")),
          readPortraitDataUri(),
        ]);

        return {
          playfairBold: bufferToArrayBuffer(playfairBuf),
          spaceGroteskSemiBold: bufferToArrayBuffer(spaceBuf),
          jetBrainsMonoBold: bufferToArrayBuffer(monoBuf),
          portraitDataUri,
        };
      } catch {
        cachedAssetsPromise = null;
        return null;
      }
    })();
  }
  return cachedAssetsPromise;
}

const MODE_LABELS: Record<GameModeId, string> = {
  kampania: "KAMPANIA 4 SALW",
  dzienny: "WYZWANIE DNIA",
  piaskownica: "PIASKOWNICA FIZYKI",
};

function formatPolishMeters(distM: number): string {
  const rounded = Math.round(distM * 10) / 10;
  return Number.isInteger(rounded)
    ? `${rounded} m`
    : `${rounded.toFixed(1).replace(".", ",")} m`;
}

function buildChallengeHeadline(challenge: ParsedChallenge): string {
  if (challenge.verified && challenge.callsign) {
    return `${challenge.callsign} rzuca Ci rękawicę: ${challenge.score} pkt!`;
  }
  if (challenge.score === 0 && challenge.maxDistM < 0) {
    return `Samobój w obóz (${Math.round(challenge.maxDistM)} m)! Pobijesz ten rzut?`;
  }
  return `Pobijesz wynik ${challenge.score} pkt?`;
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const assets = await getOgAssets();

    let challenge: ParsedChallenge | null = null;
    try {
      const { searchParams } = new URL(req.url);
      challenge = parseAndVerifyChallenge(searchParams);
    } catch {
      challenge = null;
    }

    const fonts = assets
      ? [
          {
            name: "Playfair Display",
            data: assets.playfairBold,
            weight: 700 as const,
            style: "normal" as const,
          },
          {
            name: "Space Grotesk",
            data: assets.spaceGroteskSemiBold,
            weight: 600 as const,
            style: "normal" as const,
          },
          {
            name: "JetBrains Mono",
            data: assets.jetBrainsMonoBold,
            weight: 700 as const,
            style: "normal" as const,
          },
        ]
      : undefined;

    const portraitUri = assets?.portraitDataUri ?? null;
    const rank = challenge ? resolveRankForScore(challenge.score) : null;
    const headline = challenge ? buildChallengeHeadline(challenge) : "";
    const headlineFontSize =
      challenge && headline.length > 36 ? "46px" : challenge ? "54px" : "52px";

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            padding: "22px",
            backgroundColor: "#08070a",
            backgroundImage:
              "radial-gradient(circle at 82% 22%, rgba(212, 160, 84, 0.24), rgba(8, 7, 10, 0) 54%), radial-gradient(circle at 16% 84%, rgba(78, 205, 196, 0.14), rgba(8, 7, 10, 0) 48%), linear-gradient(155deg, #0d0a0e 0%, #08070a 55%, #120e0b 100%)",
            color: "#f3ede2",
            fontFamily: '"Space Grotesk", sans-serif',
          }}
        >
          {/* Zewnętrzna mosiężna ramka */}
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              padding: "8px",
              border: "2px solid rgba(212, 160, 84, 0.55)",
              borderRadius: "14px",
              backgroundColor: "rgba(12, 10, 8, 0.58)",
            }}
          >
            {/* Wewnętrzna giloszowa ramka */}
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "30px 40px",
                border: "1px solid rgba(240, 200, 120, 0.24)",
                borderRadius: "10px",
              }}
            >
              {/* Górny pasek archiwalny */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid rgba(212, 160, 84, 0.26)",
                  paddingBottom: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "5px",
                      backgroundColor: "#d4a054",
                      display: "flex",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "17px",
                      letterSpacing: "2.5px",
                      color: "#d4a054",
                    }}
                  >
                    {challenge
                      ? "ŚWIADEK DZIEJÓW · RĘKAWICA OBLĘŻNICZA 3D"
                      : "ŚWIADEK DZIEJÓW · EKSPONAT INTERAKTYWNY 3D"}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  {challenge ? (
                    <div
                      style={{
                        display: "flex",
                        padding: "5px 14px",
                        borderRadius: "999px",
                        backgroundColor: "rgba(78, 205, 196, 0.13)",
                        border: "1px solid rgba(78, 205, 196, 0.45)",
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "16px",
                        color: "#7ee8e0",
                      }}
                    >
                      {`SCENARIUSZ ${challenge.seedCode}`}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      padding: "5px 14px",
                      borderRadius: "999px",
                      backgroundColor: "rgba(212, 160, 84, 0.14)",
                      border: "1px solid rgba(212, 160, 84, 0.42)",
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "15px",
                      color: "#f0c878",
                    }}
                  >
                    {challenge
                      ? MODE_LABELS[challenge.modeId]
                      : "XIV–XV W. · WEBGL 3D"}
                  </div>
                </div>
              </div>

              {/* Środkowa sekcja główna: lewa kolumna treści + prawy medalion Świadka */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "34px",
                  flexGrow: 1,
                  paddingTop: "14px",
                  paddingBottom: "14px",
                }}
              >
                {/* Lewa kolumna */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "18px",
                    width: "760px",
                  }}
                >
                  {challenge && rank ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                      }}
                    >
                      {/* Pasek rangi */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            padding: "6px 16px",
                            borderRadius: "8px",
                            backgroundColor: "rgba(212, 160, 84, 0.16)",
                            border: "1px solid rgba(240, 200, 120, 0.46)",
                            fontSize: "20px",
                            color: "#f0c878",
                          }}
                        >
                          {`Ranga: ${rank.titlePl}`}
                        </div>
                        {challenge.gdanisko ? (
                          <div
                            style={{
                              display: "flex",
                              padding: "6px 14px",
                              borderRadius: "8px",
                              backgroundColor: "rgba(78, 205, 196, 0.16)",
                              border: "1px solid rgba(78, 205, 196, 0.55)",
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: "16px",
                              color: "#7ee8e0",
                            }}
                          >
                            POGROMCA GDANISKA
                          </div>
                        ) : null}
                      </div>

                      {/* Wielki wiralowy nagłówek wyzwania */}
                      <div
                        style={{
                          display: "flex",
                          fontFamily: '"Playfair Display", serif',
                          fontSize: headlineFontSize,
                          fontWeight: 700,
                          lineHeight: 1.1,
                          color: "#f3ede2",
                        }}
                      >
                        {headline}
                      </div>

                      {/* Kafelki telemetrii pojedynku */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          gap: "14px",
                          marginTop: "4px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            padding: "12px 20px",
                            borderRadius: "10px",
                            backgroundColor: "rgba(255, 255, 255, 0.035)",
                            border: "1px solid rgba(212, 160, 84, 0.34)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: "13px",
                              color: "#c2b7a6",
                            }}
                          >
                            WYNIK KAMPANII
                          </div>
                          <div
                            style={{
                              display: "flex",
                              fontFamily: '"Playfair Display", serif',
                              fontSize: "30px",
                              color: "#f0c878",
                            }}
                          >
                            {`${challenge.score} / 1000 pkt`}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            padding: "12px 20px",
                            borderRadius: "10px",
                            backgroundColor: "rgba(255, 255, 255, 0.035)",
                            border: "1px solid rgba(212, 160, 84, 0.28)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: "13px",
                              color: "#c2b7a6",
                            }}
                          >
                            NAJDALSZY RZUT
                          </div>
                          <div
                            style={{
                              display: "flex",
                              fontFamily: '"Playfair Display", serif',
                              fontSize: "30px",
                              color: "#f3ede2",
                            }}
                          >
                            {formatPolishMeters(challenge.maxDistM)}
                          </div>
                        </div>

                        {challenge.percentile ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              padding: "12px 20px",
                              borderRadius: "10px",
                              backgroundColor: "rgba(78, 205, 196, 0.08)",
                              border: "1px solid rgba(78, 205, 196, 0.36)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: "13px",
                                color: "#7ee8e0",
                              }}
                            >
                              SPOŁECZNOŚĆ
                            </div>
                            <div
                              style={{
                                display: "flex",
                                fontFamily: '"Playfair Display", serif',
                                fontSize: "30px",
                                color: "#4ecdc4",
                              }}
                            >
                              {`Lepszy niż ${challenge.percentile}%`}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          fontSize: "21px",
                          lineHeight: 1.35,
                          color: "#c2b7a6",
                        }}
                      >
                        {`„Wygnij żelazny palec spustowy pod tym samym wiatrem (${challenge.seedCode}) i sprawdź, czy skruszysz gotycki mur!”`}
                      </div>
                    </div>
                  ) : (
                    /* Widok główny: Wielki Trebusz (gdy brak ?w= lub token uszkodzony) */
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "18px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          fontFamily: '"Playfair Display", serif',
                          fontSize: "52px",
                          fontWeight: 700,
                          lineHeight: 1.08,
                          color: "#f3ede2",
                        }}
                      >
                        Wielki Trebusz: Tajemnica Palca Spustowego
                      </div>

                      <div
                        style={{
                          display: "flex",
                          fontSize: "27px",
                          color: "#f0c878",
                          lineHeight: 1.25,
                        }}
                      >
                        Interaktywna Fizyka Oblężenia 3D — skrusz gotycki mur albo zbombarduj własny obóz!
                      </div>

                      <div
                        style={{
                          display: "flex",
                          fontSize: "21px",
                          lineHeight: 1.4,
                          color: "#c2b7a6",
                        }}
                      >
                        {
                          "„9 na 10 adeptów przy złym kącie żelaznego palca posyła 100-kilowy głaz prosto we własne namioty. Opanuj potrójne wahadło Lagrange’a!”"
                        }
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          gap: "12px",
                          marginTop: "4px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            backgroundColor: "rgba(212, 160, 84, 0.13)",
                            border: "1px solid rgba(212, 160, 84, 0.36)",
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "15px",
                            color: "#f0c878",
                          }}
                        >
                          SKRZYNIA DO 16 TON
                        </div>
                        <div
                          style={{
                            display: "flex",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            backgroundColor: "rgba(78, 205, 196, 0.11)",
                            border: "1px solid rgba(78, 205, 196, 0.36)",
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "15px",
                            color: "#7ee8e0",
                          }}
                        >
                          PALEC SPUSTOWY 0°–80°
                        </div>
                        <div
                          style={{
                            display: "flex",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            backgroundColor: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(243, 237, 226, 0.22)",
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "15px",
                            color: "#f3ede2",
                          }}
                        >
                          4 SALWY MISTRZA BLIDY
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Prawa kolumna: Medalion Świadka Dziejów */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "260px",
                    gap: "14px",
                  }}
                >
                  <div
                    style={{
                      width: "204px",
                      height: "204px",
                      borderRadius: "102px",
                      padding: "7px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background:
                        "linear-gradient(135deg, #f0c878 0%, #d4a054 48%, #6d4c1d 100%)",
                      boxShadow: "0 16px 42px rgba(0, 0, 0, 0.72)",
                    }}
                  >
                    <div
                      style={{
                        width: "190px",
                        height: "190px",
                        borderRadius: "95px",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#161310",
                        border: "3px solid #08070a",
                      }}
                    >
                      {portraitUri ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={portraitUri}
                          alt="Świadek Dziejów"
                          width={190}
                          height={190}
                          style={{
                            width: "190px",
                            height: "190px",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            fontFamily: '"Playfair Display", serif',
                            fontSize: "58px",
                            color: "#f0c878",
                          }}
                        >
                          ŚD
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "6px 18px",
                      borderRadius: "999px",
                      backgroundColor: "rgba(212, 160, 84, 0.14)",
                      border: "1px solid rgba(212, 160, 84, 0.44)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "14px",
                        letterSpacing: "2px",
                        color: "#f0c878",
                      }}
                    >
                      ŚWIADEK DZIEJÓW
                    </div>
                  </div>
                </div>
              </div>

              {/* Dolny pasek stopki */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: "1px solid rgba(212, 160, 84, 0.26)",
                  paddingTop: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: "18px",
                    color: "#9e9383",
                  }}
                >
                  Symulacja RK4 · Potrójne wahadło Lagrange’a · Żywy komentarz lektorski
                </div>
                <div
                  style={{
                    display: "flex",
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "20px",
                    fontWeight: 700,
                    color: "#d4a054",
                  }}
                >
                  swiadek-dziejow.pl/wielki-trebusz
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        ...(fonts ? { fonts } : {}),
        headers: {
          "Cache-Control":
            "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
        },
      }
    );
  } catch {
    // Pancerny bezpiecznik awaryjny — endpoint /api/og nigdy nie zwraca HTTP 500
    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#08070a",
            border: "4px solid #d4a054",
            color: "#f3ede2",
            padding: "60px",
          }}
        >
          <div style={{ display: "flex", fontSize: "24px", color: "#d4a054", marginBottom: "20px" }}>
            SWIADEK DZIEJOW
          </div>
          <div style={{ display: "flex", fontSize: "54px", fontWeight: 700, textAlign: "center" }}>
            Wielki Trebusz: Tajemnica Palca Spustowego (3D)
          </div>
          <div style={{ display: "flex", fontSize: "26px", color: "#f0c878", marginTop: "24px" }}>
            swiadek-dziejow.pl/wielki-trebusz
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }
}
