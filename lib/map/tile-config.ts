export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function resolveTileConfig({
  tileUrl,
  tileAttribution,
}: {
  tileUrl: string | undefined;
  tileAttribution: string | undefined;
}) {
  return {
    tileUrl: normalizePublicTileValue(tileUrl) ?? DEFAULT_TILE_URL,
    tileAttribution: normalizePublicTileValue(tileAttribution) ?? DEFAULT_TILE_ATTRIBUTION,
  };
}

function normalizePublicTileValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
