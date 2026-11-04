export const APP_SLUG = "wielki-trebusz" as const;
export const BASE_PATH = `/${APP_SLUG}` as const;
export const SITE_ORIGIN = "https://swiadek-dziejow.pl" as const;
export const CANONICAL_URL = `${SITE_ORIGIN}${BASE_PATH}` as const;

/** Maksymalny wynik w 4-salwowej kampanii Mistrza Blidy */
export const SCORE_CAP = 1000 as const;

/** Liczba koszyków histogramu społeczności */
export const BUCKET_COUNT = 20 as const;

/** Minimalny i maksymalny wiarygodny czas ukończenia kampanii [ms] */
export const MIN_RUN_MS = 4_000 as const;
export const MAX_RUN_MS = 3_600_000 as const;

export const ALLOWED_MODES = ["kampania", "dzienny", "piaskownica"] as const;
export type GameModeId = (typeof ALLOWED_MODES)[number];

/** Helper ścieżki statycznych zasobów w public/ z uwzględnieniem basePath */
export function assetUrl(relativePath: string): string {
  const clean = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${BASE_PATH}${clean}`;
}

/** Helper ścieżki API z uwzględnieniem basePath */
export function apiUrl(endpointPath: string): string {
  const clean = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  return `${BASE_PATH}/api${clean}`;
}
