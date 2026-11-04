import type { Metadata, Viewport } from "next";
import { Playfair_Display, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { CANONICAL_URL, SITE_ORIGIN, BASE_PATH } from "@/lib/config";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  display: "swap",
  weight: ["400", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "700"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#08070a",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Wielki Trebusz: Tajemnica Palca Spustowego (3D) | Świadek Dziejów",
  description:
    "Interaktywny eksponat i minigra 3D Świadka Dziejów. Naciągnij 15-metrową średniowieczną blidę, wygnij żelazny palec spustowy, odkryj fizykę potrójnego wahadła Lagrange’a i skrusz ceglany mur zamku Zakonu — albo zbombarduj własny obóz!",
  alternates: {
    canonical: CANONICAL_URL,
  },
  openGraph: {
    title: "Wielki Trebusz: Tajemnica Palca Spustowego (3D) | Świadek Dziejów",
    description:
      "9 na 10 graczy przy złym kącie żelaznego palca posyła 100-kilowy głaz we własny obóz oblężniczy. Odkryj fizykę średniowiecznej blidy w 3D i rzuć wyzwanie znajomym!",
    url: CANONICAL_URL,
    siteName: "Świadek Dziejów",
    locale: "pl_PL",
    type: "website",
    images: [
      {
        url: `${SITE_ORIGIN}${BASE_PATH}/api/og`,
        width: 1200,
        height: 630,
        alt: "Wielki Trebusz: Tajemnica Palca Spustowego — Interaktywna Fizyka 3D Świadka Dziejów",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wielki Trebusz: Tajemnica Palca Spustowego (3D) | Świadek Dziejów",
    description:
      "Wygnij żelazny palec spustowy na końcu 15-metrowej dębowej belki i skrusz gotycki mur w 3D — z żywym komentarzem Świadka Dziejów.",
    images: [`${SITE_ORIGIN}${BASE_PATH}/api/og`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className="dark">
      <body
        className={`${playfair.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased bg-[#08070a] text-[#f3ede2] selection:bg-[#d4a054]/30 selection:text-[#f0c878]`}
      >
        <div className="film-grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
