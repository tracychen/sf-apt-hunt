import { isCoordinateInSfBounds } from "@/lib/map/sf-bounds";

type GoogleGeocodeResult = {
  formatted_address: string;
  geometry: {
    location: {
      lng: number;
      lat: number;
    };
    location_type: string;
  };
};

type GoogleGeocodeResponse = {
  status: string;
  error_message?: string;
  results: unknown[];
};

export type ListingGeocodeResult =
  | {
      status: "ok";
      coordinates: [number, number];
      markerPrecision: "exact" | "approximate";
      formattedAddress: string;
    }
  | {
      status: "failed" | "outside_sf";
      error: string;
    };

type GeocodeListingLocationOptions = {
  apiKey: string;
  query: string;
};

export async function geocodeListingLocation({
  apiKey,
  query,
}: GeocodeListingLocationOptions): Promise<ListingGeocodeResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    "components",
    "locality:San Francisco|administrative_area:CA|country:US",
  );

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return { status: "failed", error: "Google Geocoding request failed." };
    }

    const data = await parseGoogleGeocodeResponse(response);

    if (!data) {
      return { status: "failed", error: "Google Geocoding response was invalid." };
    }

    if (data.status !== "OK") {
      return {
        status: "failed",
        error: data.error_message ?? `Google Geocoding returned ${data.status}.`,
      };
    }

    const firstResult = data.results[0];

    if (!firstResult) {
      return { status: "failed", error: "No geocode result found." };
    }

    const parsedResult = parseGoogleGeocodeResult(firstResult);

    if (!parsedResult) {
      return { status: "failed", error: "Google Geocoding response was invalid." };
    }

    const coordinates: [number, number] = [
      parsedResult.geometry.location.lng,
      parsedResult.geometry.location.lat,
    ];

    if (!isCoordinateInSfBounds(coordinates)) {
      return { status: "outside_sf", error: "Geocode result is outside San Francisco." };
    }

    return {
      status: "ok",
      coordinates,
      markerPrecision:
        parsedResult.geometry.location_type === "ROOFTOP" ? "exact" : "approximate",
      formattedAddress: parsedResult.formatted_address,
    };
  } catch {
    return { status: "failed", error: "Google Geocoding request failed." };
  }
}

async function parseGoogleGeocodeResponse(
  response: Response,
): Promise<GoogleGeocodeResponse | null> {
  const data: unknown = await response.json();

  if (!isRecord(data) || typeof data.status !== "string" || !Array.isArray(data.results)) {
    return null;
  }

  return {
    status: data.status,
    error_message: typeof data.error_message === "string" ? data.error_message : undefined,
    results: data.results,
  };
}

function parseGoogleGeocodeResult(result: unknown): GoogleGeocodeResult | null {
  if (!isRecord(result)) {
    return null;
  }

  const geometry = result.geometry;
  if (!isRecord(geometry)) {
    return null;
  }

  const location = geometry.location;
  if (!isRecord(location)) {
    return null;
  }

  const lng = location.lng;
  const lat = location.lat;

  if (
    typeof result.formatted_address !== "string" ||
    typeof geometry.location_type !== "string" ||
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  ) {
    return null;
  }

  return {
    formatted_address: result.formatted_address,
    geometry: {
      location: { lng, lat },
      location_type: geometry.location_type,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
