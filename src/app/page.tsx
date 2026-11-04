import type { Metadata } from "next";
import { BASE_PATH, CANONICAL_URL, SITE_ORIGIN } from "@/lib/config";
import {
  parseAndVerifyChallenge,
  resolveRankForScore,
} from "@/lib/challengeCodec";
import WielkiTrebuszExperience from "@/components/WielkiTrebuszExperience";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const rawToken =
    (typeof params.w === "string" ? params.w : undefined) ??
    (typeof params.challenge === "string" ? params.challenge : undefined);

  const parsed = rawToken ? parseAndVerifyChallenge(params) : null;

  if (!parsed) {
    return {
      title: "Wielki Trebusz: Tajemnica Palca Spustowego (3D) | Świadek Dziejów",
      description:
        "Interaktywny eksponat i minigra 3D Świadka Dziejów. Naciągnij 15-metrową średniowieczną blidę, wygnij żelazny palec spustowy, odkryj fizykę potrójnego wahadła Lagrange’a i skrusz ceglany mur zamku Zakonu — albo zbombarduj własny obóz!",
      openGraph: {
        title:
          "Wielki Trebusz: Tajemnica Palca Spustowego (3D) | Świadek Dziejów",
        description:
          "9 na 10 adeptów przy złym kącie żelaznego palca posyła 100-kilowy głaz we własne namioty. Opanuj fizykę średniowiecznej blidy w 3D!",
        url: CANONICAL_URL,
        siteName: "Świadek Dziejów",
        locale: "pl_PL",
        type: "website",
        images: [
          {
            url: `${SITE_ORIGIN}${BASE_PATH}/api/og`,
            width: 1200,
            height: 630,
            alt: "Wielki Trebusz: Tajemnica Palca Spustowego — Świadek Dziejów",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title:
          "Wielki Trebusz: Tajemnica Palca Spustowego (3D) | Świadek Dziejów",
        description:
          "Odkryj tajemnicę 15-centymetrowego żelaznego palca na czubku średniowiecznej blidy 3D i rzuć wyzwanie znajomym!",
        images: [`${SITE_ORIGIN}${BASE_PATH}/api/og`],
      },
    };
  }

  const rank = resolveRankForScore(parsed.score);
  const challengerPrefix = parsed.callsign
    ? `${parsed.callsign} rzuca Ci rękawicę: `
    : "Rzucono Ci rękawicę: ";
  const ogTitle = `${challengerPrefix}pobijesz ${parsed.score} pkt? | Wielki Trebusz 3D`;
  const ogDescription = `Scenariusz ${parsed.seedCode} · Ranga: „${rank.titlePl}” · Najdalszy rzut: ${parsed.maxDistM
    .toFixed(1)
    .replace(".", ",")} m. Wejdź do gry 3D Świadka Dziejów i sprawdź, czy przebijesz ten wynik pod tym samym wiatrem!`;
  const ogImageUrl = `${SITE_ORIGIN}${BASE_PATH}/api/og?w=${encodeURIComponent(
    rawToken!
  )}`;

  return {
    title: ogTitle,
    description: ogDescription,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: `${CANONICAL_URL}?w=${encodeURIComponent(rawToken!)}`,
      siteName: "Świadek Dziejów",
      locale: "pl_PL",
      type: "website",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: ogTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
      images: [ogImageUrl],
    },
  };
}

export default async function WielkiTrebuszPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const initialChallenge = parseAndVerifyChallenge(params);

  return <WielkiTrebuszExperience initialChallenge={initialChallenge} />;
}
