"use client";

import type {} from "@geoman-io/leaflet-geoman-free";
import L, { type LatLngExpression, type LatLngTuple, type PathOptions } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import type { Coordinate, ListingCandidate, MapState, Priority } from "@/lib/domain/types";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type LeafletMapProps = {
  mapState: MapState;
  listings: ListingCandidate[];
  selectedZoneIds: string[];
  onMapStateChange: (state: MapState) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
};

type LeafletDefaultIconPrototype = L.Icon.Default & {
  _getIconUrl?: () => string;
};

type ImportedLeafletImage = string | {
  src: string;
};

type LeafletGlobal = typeof globalThis & {
  L?: typeof L;
};

const SF_CENTER: LatLngTuple = [37.7749, -122.4194];
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function imageUrl(image: ImportedLeafletImage) {
  return typeof image === "string" ? image : image.src;
}

delete (L.Icon.Default.prototype as LeafletDefaultIconPrototype)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: imageUrl(markerIcon2x),
  iconUrl: imageUrl(markerIcon),
  shadowUrl: imageUrl(markerShadow),
});

function toLatLng([lng, lat]: Coordinate): LatLngTuple {
  return [lat, lng];
}

function formatCoordinate([lng, lat]: Coordinate) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function zonePathOptions(selected: boolean, kind: "neighborhood" | "caution"): PathOptions {
  if (selected) {
    return {
      color: "#f97316",
      fillColor: "#fed7aa",
      fillOpacity: 0.48,
      opacity: 1,
      weight: 3,
    };
  }

  if (kind === "caution") {
    return {
      color: "#dc2626",
      fillColor: "#fecaca",
      fillOpacity: 0.28,
      opacity: 0.85,
      weight: 2,
    };
  }

  return {
    color: "#0f766e",
    fillColor: "#99f6e4",
    fillOpacity: 0.28,
    opacity: 0.85,
    weight: 2,
  };
}

function corridorPathOptions(priority: Priority): PathOptions {
  if (priority === "high") {
    return { color: "#be123c", opacity: 0.95, weight: 5 };
  }

  if (priority === "medium") {
    return { color: "#ca8a04", opacity: 0.9, weight: 4 };
  }

  return { color: "#475569", opacity: 0.8, weight: 3 };
}

function GeomanControls({
  mapState,
  onMapStateChange,
}: Pick<LeafletMapProps, "mapState" | "onMapStateChange">) {
  const map = useMap();
  const mapStateRef = useRef(mapState);
  const onMapStateChangeRef = useRef(onMapStateChange);

  useEffect(() => {
    mapStateRef.current = mapState;
    onMapStateChangeRef.current = onMapStateChange;
  }, [mapState, onMapStateChange]);

  useEffect(() => {
    map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawCircle: false,
      drawRectangle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    });
    map.pm.setGlobalOptions({
      allowSelfIntersection: false,
    });
    map.invalidateSize();

    const handleManualEdit = () => {
      onMapStateChangeRef.current(mapStateRef.current);
    };

    map.on("pm:edit", handleManualEdit);
    map.on("pm:update", handleManualEdit);

    return () => {
      map.off("pm:edit", handleManualEdit);
      map.off("pm:update", handleManualEdit);
      map.pm.removeControls();
    };
  }, [map]);

  return null;
}

export function LeafletMap({
  mapState,
  listings,
  selectedZoneIds,
  onMapStateChange,
  onSelectedZoneIdsChange,
}: LeafletMapProps) {
  const [geomanReady, setGeomanReady] = useState(false);
  const selectedZoneSet = useMemo(() => new Set(selectedZoneIds), [selectedZoneIds]);
  const listingPins = useMemo(
    () => listings.filter((listing): listing is ListingCandidate & { coordinates: Coordinate } => listing.coordinates !== null),
    [listings],
  );
  const tileUrl = process.env.NEXT_PUBLIC_TILE_URL ?? DEFAULT_TILE_URL;
  const tileAttribution = process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? DEFAULT_TILE_ATTRIBUTION;

  useEffect(() => {
    let mounted = true;

    (globalThis as LeafletGlobal).L = L;
    void import("@geoman-io/leaflet-geoman-free").then(() => {
      if (mounted) {
        setGeomanReady(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  function toggleZone(zoneId: string) {
    onSelectedZoneIdsChange(
      selectedZoneSet.has(zoneId)
        ? selectedZoneIds.filter((id) => id !== zoneId)
        : [...selectedZoneIds, zoneId],
    );
  }

  if (!geomanReady) {
    return (
      <div className="flex h-full min-h-[58vh] items-center justify-center bg-background text-sm text-muted-foreground lg:min-h-screen">
        Loading map...
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[58vh] min-w-0 overflow-hidden bg-background lg:min-h-screen">
      <MapContainer
        center={SF_CENTER}
        zoom={13}
        zoomControl={false}
        scrollWheelZoom
        className="apartment-leaflet-map lg:min-h-screen"
      >
        <TileLayer attribution={tileAttribution} url={tileUrl} />
        <ZoomControl position="bottomright" />
        <GeomanControls mapState={mapState} onMapStateChange={onMapStateChange} />

        {mapState.zones.map((zone) => {
          const selected = selectedZoneSet.has(zone.id);
          const positions = zone.geometry.coordinates.map((ring) => ring.map(toLatLng));

          return (
            <Polygon
              key={zone.id}
              positions={positions as LatLngExpression[][]}
              pathOptions={zonePathOptions(selected, zone.kind)}
              eventHandlers={{ click: () => toggleZone(zone.id) }}
            >
              <Tooltip sticky>{zone.name}</Tooltip>
              <Popup>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{zone.name}</p>
                  <p>{selected ? "Selected search zone" : "Click to select this zone"}</p>
                  <p>
                    Fit {zone.fitnessScore}/5, rent {zone.affordabilityScore}/5, transit {zone.carFreeScore}/5
                  </p>
                </div>
              </Popup>
            </Polygon>
          );
        })}

        {mapState.corridors.map((corridor) => (
          <Polyline
            key={corridor.id}
            positions={corridor.geometry.coordinates.map(toLatLng)}
            pathOptions={corridorPathOptions(corridor.priority)}
          >
            <Tooltip sticky>{corridor.name}</Tooltip>
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{corridor.name}</p>
                <p>{corridor.priority} priority corridor</p>
                <p>{corridor.notes[0]}</p>
              </div>
            </Popup>
          </Polyline>
        ))}

        {mapState.targets.map((target) => (
          <Marker key={target.id} position={toLatLng(target.coordinates)}>
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{target.name}</p>
                <p>{target.priority} priority target</p>
                <p>{formatCoordinate(target.coordinates)}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {listingPins.map((listing) => (
          <Marker key={listing.id} position={toLatLng(listing.coordinates)}>
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{listing.title}</p>
                <p>Marker precision: {listing.markerPrecision}</p>
                <p>{formatCoordinate(listing.coordinates)}</p>
                {listing.priceMonthly ? <p>${listing.priceMonthly.toLocaleString()}/mo</p> : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[450] max-w-md border border-border bg-background/95 p-3 text-xs text-foreground shadow-sm backdrop-blur sm:inset-x-auto sm:left-3">
        <p>Boundaries are approximate apartment-search zones, not official boundaries.</p>
        <p className="mt-1 text-muted-foreground">
          {selectedZoneIds.length} selected zones, {listingPins.length} listing{" "}
          {listingPins.length === 1 ? "pin" : "pins"}.
        </p>
      </div>
    </div>
  );
}
