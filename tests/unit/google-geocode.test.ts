import { describe, expect, it, vi } from "vitest";

import { geocodeListingLocation } from "@/lib/server/google-geocode";

describe("geocodeListingLocation", () => {
  it("returns coordinates for an SF result and treats non-ROOFTOP precision as approximate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Fillmore St & California St, San Francisco, CA 94115, USA",
            geometry: {
              location: { lng: -122.433, lat: 37.789 },
              location_type: "GEOMETRIC_CENTER",
            },
          },
        ],
      }),
    );

    const result = await geocodeListingLocation({
      apiKey: "google-key",
      query: "Fillmore and California, San Francisco, CA",
    });

    expect(result).toEqual({
      status: "ok",
      coordinates: [-122.433, 37.789],
      markerPrecision: "approximate",
      formattedAddress: "Fillmore St & California St, San Francisco, CA 94115, USA",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );
    expect(url.searchParams.get("address")).toBe(
      "Fillmore and California, San Francisco, CA",
    );
    expect(url.searchParams.get("key")).toBe("google-key");
    expect(url.searchParams.get("components")).toBe(
      "locality:San Francisco|administrative_area:CA|country:US",
    );
  });

  it("rejects outside-SF results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "1 Infinite Loop, Cupertino, CA 95014, USA",
            geometry: {
              location: { lng: -122.031, lat: 37.331 },
              location_type: "ROOFTOP",
            },
          },
        ],
      }),
    );

    await expect(
      geocodeListingLocation({ apiKey: "google-key", query: "1 Infinite Loop" }),
    ).resolves.toEqual({
      status: "outside_sf",
      error: "Geocode result is outside San Francisco.",
    });
  });

  it("fails when the top Google result has malformed coordinates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Malformed top result, San Francisco, CA, USA",
            geometry: {
              location: { lng: Number.NaN, lat: 37.789 },
              location_type: "ROOFTOP",
            },
          },
          {
            formatted_address: "Fillmore St & California St, San Francisco, CA 94115, USA",
            geometry: {
              location: { lng: -122.433, lat: 37.789 },
              location_type: "ROOFTOP",
            },
          },
        ],
      }),
    );

    await expect(
      geocodeListingLocation({
        apiKey: "google-key",
        query: "Fillmore and California, San Francisco, CA",
      }),
    ).resolves.toEqual({
      status: "failed",
      error: "Google Geocoding response was invalid.",
    });
  });
});
