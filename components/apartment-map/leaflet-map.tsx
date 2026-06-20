"use client";

import type {} from "@geoman-io/leaflet-geoman-free";
import L, { type LatLngExpression, type LatLngTuple, type PathOptions } from "leaflet";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
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
import type {
  Coordinate,
  ListingDisplayCandidate,
  MapState,
  Priority,
  TargetInfluence,
  TargetPoint,
} from "@/lib/domain/types";
import {
  applyCorridorGeometryEdit,
  applyTargetCoordinateEdit,
  applyZoneGeometryEdit,
  type PersistResult,
} from "@/components/apartment-map/leaflet-map-state";
import {
  formatTargetLabel,
  targetRadiusMeters,
} from "@/lib/map/target-points";
import { resolveTileConfig } from "@/lib/map/tile-config";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type LeafletMapProps = {
  mapState: MapState;
  listings: ListingDisplayCandidate[];
  selectedEntity: SelectedMapEntity;
  selectedZoneIds: string[];
  visibleLayers: VisibleMapLayers;
  onMapStateChange: (state: MapState) => void;
  onSelectedEntityChange: (entity: SelectedMapEntity) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
};

export type SelectedMapEntity =
  | { kind: "zone"; id: string }
  | { kind: "corridor"; id: string }
  | { kind: "target"; id: string }
  | null;

export type VisibleMapLayers = {
  zones: boolean;
  corridors: boolean;
  targets: boolean;
  listings: boolean;
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

type LeafletWithGeoman = typeof L & {
  PM?: {
    reInitLayer: (layer: L.Layer) => void;
  };
};

const SF_CENTER: LatLngTuple = [37.7749, -122.4194];

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

function fromLatLng(latLng: L.LatLng): Coordinate {
  return [latLng.lng, latLng.lat];
}

function formatCoordinate([lng, lat]: Coordinate) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function polygonRingCoordinates(layer: L.Polygon): Coordinate[] {
  const latLngs = layer.getLatLngs();
  const first = latLngs[0];
  const ring = Array.isArray(first) ? first : latLngs;

  return (ring as L.LatLng[]).map(fromLatLng);
}

function polylineCoordinates(layer: L.Polyline): Coordinate[] {
  const latLngs = layer.getLatLngs();
  const line = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;

  return (line as L.LatLng[]).map(fromLatLng);
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

function hasZonePlanningScores(zone: MapState["zones"][number]) {
  return (
    zone.fitnessScore !== 3 ||
    zone.affordabilityScore !== 3 ||
    zone.carFreeScore !== 3 ||
    zone.notes.length > 0
  );
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

function targetInfluenceColor(influence: TargetInfluence) {
  if (influence === "negative") {
    return "#dc2626";
  }

  if (influence === "neutral") {
    return "#475569";
  }

  return "#0f766e";
}

function targetRadiusPathOptions(target: TargetPoint, selected: boolean): PathOptions {
  const color = targetInfluenceColor(target.influence);

  return {
    color,
    fillColor: color,
    fillOpacity: selected ? 0.12 : 0.07,
    opacity: selected ? 0.55 : 0.35,
    weight: selected ? 2 : 1,
  };
}

function targetMarkerIcon(target: TargetPoint, selected: boolean) {
  return L.divIcon({
    className: [
      "target-anchor-marker",
      `target-anchor-marker-${target.influence}`,
      selected ? "target-anchor-marker-selected" : "",
    ].filter(Boolean).join(" "),
    html: `<span aria-hidden="true"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
}

function GeomanControls() {
  const map = useMap();

  useEffect(() => {
    map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawPolygon: false,
      drawCircle: false,
      drawRectangle: false,
      drawText: false,
      cutPolygon: false,
      removalMode: false,
      rotateMode: false,
    });
    map.pm.setGlobalOptions({
      allowSelfIntersection: false,
    });
    map.pm.enableGlobalEditMode();
    map.invalidateSize();

    return () => {
      if (map.pm.globalEditModeEnabled()) {
        map.pm.disableGlobalEditMode();
      }
      map.pm.removeControls();
    };
  }, [map]);

  return null;
}

function usePersistentEditedLayer<TLayer extends L.Layer>(
  layer: TLayer | null,
  mapState: MapState,
  onMapStateChange: (state: MapState) => void,
  deriveNextState: (layer: TLayer, mapState: MapState) => PersistResult,
) {
  const mapStateRef = useRef(mapState);
  const onMapStateChangeRef = useRef(onMapStateChange);
  const deriveNextStateRef = useRef(deriveNextState);

  useEffect(() => {
    mapStateRef.current = mapState;
    onMapStateChangeRef.current = onMapStateChange;
    deriveNextStateRef.current = deriveNextState;
  }, [deriveNextState, mapState, onMapStateChange]);

  useEffect(() => {
    if (!layer) {
      return;
    }

    let editTimeout: number | null = null;

    const persist = () => {
      const nextState = deriveNextStateRef.current(layer, mapStateRef.current);

      if (!nextState) {
        return;
      }

      mapStateRef.current = nextState;
      onMapStateChangeRef.current(nextState);
    };

    const persistAfterEditSettles = () => {
      if (editTimeout !== null) {
        window.clearTimeout(editTimeout);
      }

      editTimeout = window.setTimeout(persist, 120);
    };

    layer.on("pm:edit", persistAfterEditSettles);
    layer.on("pm:change", persistAfterEditSettles);
    layer.on("pm:update", persist);
    layer.on("pm:markerdragend", persist);
    layer.on("pm:dragend", persist);
    layer.on("dragend", persist);
    layer.on("moveend", persist);

    return () => {
      if (editTimeout !== null) {
        window.clearTimeout(editTimeout);
      }

      layer.off("pm:edit", persistAfterEditSettles);
      layer.off("pm:change", persistAfterEditSettles);
      layer.off("pm:update", persist);
      layer.off("pm:markerdragend", persist);
      layer.off("pm:dragend", persist);
      layer.off("dragend", persist);
      layer.off("moveend", persist);
    };
  }, [layer]);
}

function ZonePolygon({
  children,
  mapState,
  onMapStateChange,
  onToggle,
  positions,
  selected,
  zoneId,
  zoneKind,
  zoneName,
}: {
  children: ReactNode;
  mapState: MapState;
  onMapStateChange: (state: MapState) => void;
  onToggle: () => void;
  positions: LatLngExpression[][];
  selected: boolean;
  zoneId: string;
  zoneKind: "neighborhood" | "caution";
  zoneName: string;
}) {
  const [polygonLayer, setPolygonLayer] = useState<L.Polygon | null>(null);

  usePersistentEditedLayer(polygonLayer, mapState, onMapStateChange, (layer, currentMapState) =>
    applyZoneGeometryEdit(currentMapState, zoneId, polygonRingCoordinates(layer)),
  );

  return (
    <Polygon
      ref={setPolygonLayer}
      positions={positions}
      pathOptions={zonePathOptions(selected, zoneKind)}
      eventHandlers={{ click: onToggle }}
    >
      <Tooltip sticky>{zoneName}</Tooltip>
      {children}
    </Polygon>
  );
}

function CorridorPolyline({
  children,
  corridorId,
  mapState,
  onMapStateChange,
  onSelect,
  pathOptions,
  positions,
}: {
  children: ReactNode;
  corridorId: string;
  mapState: MapState;
  onMapStateChange: (state: MapState) => void;
  onSelect: () => void;
  pathOptions: PathOptions;
  positions: LatLngExpression[];
}) {
  const [polylineLayer, setPolylineLayer] = useState<L.Polyline | null>(null);

  usePersistentEditedLayer(polylineLayer, mapState, onMapStateChange, (layer, currentMapState) =>
    applyCorridorGeometryEdit(currentMapState, corridorId, polylineCoordinates(layer)),
  );

  return (
    <Polyline
      ref={setPolylineLayer}
      positions={positions}
      pathOptions={pathOptions}
      eventHandlers={{ click: onSelect }}
    >
      {children}
    </Polyline>
  );
}

function TargetMarker({
  children,
  mapState,
  onMapStateChange,
  onSelect,
  position,
  selected,
  target,
}: {
  children: ReactNode;
  mapState: MapState;
  onMapStateChange: (state: MapState) => void;
  onSelect: () => void;
  position: LatLngExpression;
  selected: boolean;
  target: TargetPoint;
}) {
  const [markerLayer, setMarkerLayer] = useState<L.Marker | null>(null);
  const label = formatTargetLabel(target);

  usePersistentEditedLayer(markerLayer, mapState, onMapStateChange, (layer, currentMapState) =>
    applyTargetCoordinateEdit(currentMapState, target.id, fromLatLng(layer.getLatLng())),
  );

  return (
    <Marker
      key={`${label}:${target.influence}`}
      ref={setMarkerLayer}
      position={position}
      icon={targetMarkerIcon(target, selected)}
      title={label}
      draggable
      zIndexOffset={selected ? 900 : 0}
      eventHandlers={{ click: onSelect }}
    >
      {children}
    </Marker>
  );
}

function ListingMarker({
  children,
  position,
  title,
}: {
  children: ReactNode;
  position: LatLngExpression;
  title: string;
}) {
  const [markerLayer, setMarkerLayer] = useState<L.Marker | null>(null);

  useEffect(() => {
    if (!markerLayer) {
      return;
    }

    (L as LeafletWithGeoman).PM?.reInitLayer(markerLayer);
  }, [markerLayer]);

  return (
    <Marker ref={setMarkerLayer} position={position} title={title} pmIgnore>
      {children}
    </Marker>
  );
}

export function LeafletMap({
  mapState,
  listings,
  selectedEntity,
  selectedZoneIds,
  visibleLayers,
  onMapStateChange,
  onSelectedEntityChange,
  onSelectedZoneIdsChange,
}: LeafletMapProps) {
  const [geomanReady, setGeomanReady] = useState(false);
  const selectedZoneSet = useMemo(() => new Set(selectedZoneIds), [selectedZoneIds]);
  const listingPins = useMemo(
    () =>
      listings.filter(
        (listing): listing is ListingDisplayCandidate & { coordinates: Coordinate } =>
          listing.coordinates !== null,
      ),
    [listings],
  );
  const { tileUrl, tileAttribution } = resolveTileConfig({
    tileUrl: process.env.NEXT_PUBLIC_TILE_URL,
    tileAttribution: process.env.NEXT_PUBLIC_TILE_ATTRIBUTION,
  });

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
    const nextSelectedZoneIds = selectedZoneSet.has(zoneId)
      ? selectedZoneIds.filter((id) => id !== zoneId)
      : [...selectedZoneIds, zoneId];

    onSelectedZoneIdsChange(
      nextSelectedZoneIds,
    );
    onSelectedEntityChange(
      selectedZoneSet.has(zoneId) ? null : { kind: "zone", id: zoneId },
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
        <GeomanControls />

        {visibleLayers.zones ? mapState.zones.map((zone) => {
          const selected = selectedZoneSet.has(zone.id);
          const active = selectedEntity?.kind === "zone" && selectedEntity.id === zone.id;
          const positions = zone.geometry.coordinates.map((ring) => ring.map(toLatLng));

          return (
            <ZonePolygon
              key={zone.id}
              positions={positions as LatLngExpression[][]}
              selected={selected || active}
              zoneId={zone.id}
              zoneKind={zone.kind}
              zoneName={zone.name}
              mapState={mapState}
              onMapStateChange={onMapStateChange}
              onToggle={() => toggleZone(zone.id)}
            >
              <Popup>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{zone.name}</p>
                  <p>{selected ? "Selected search zone" : "Click to select this zone"}</p>
                  {hasZonePlanningScores(zone) ? (
                    <p>
                      Fit {zone.fitnessScore}/5, rent {zone.affordabilityScore}/5, transit {zone.carFreeScore}/5
                    </p>
                  ) : (
                    <p>Reference neighborhood outline</p>
                  )}
                </div>
              </Popup>
            </ZonePolygon>
          );
        }) : null}

        {visibleLayers.corridors ? mapState.corridors.map((corridor) => {
          const pathOptions = corridorPathOptions(corridor.priority);
          const selected =
            selectedEntity?.kind === "corridor" && selectedEntity.id === corridor.id;

          return (
            <CorridorPolyline
              key={corridor.id}
              corridorId={corridor.id}
              mapState={mapState}
              onMapStateChange={onMapStateChange}
              positions={corridor.geometry.coordinates.map(toLatLng)}
              pathOptions={{
                ...pathOptions,
                className: [
                  "target-corridor",
                  `target-corridor-${corridor.id}`,
                  pathOptions.className,
                ].filter(Boolean).join(" "),
                weight: selected ? (pathOptions.weight ?? 4) + 2 : pathOptions.weight,
              }}
              onSelect={() => onSelectedEntityChange({ kind: "corridor", id: corridor.id })}
            >
              <Tooltip sticky>{corridor.name}</Tooltip>
              <Popup>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{corridor.name}</p>
                  <p>{corridor.priority} priority corridor</p>
                  {corridor.notes[0] ? <p>{corridor.notes[0]}</p> : null}
                </div>
              </Popup>
            </CorridorPolyline>
          );
        }) : null}

        {visibleLayers.targets ? mapState.targets.map((target) => {
          const selected = selectedEntity?.kind === "target" && selectedEntity.id === target.id;
          const label = formatTargetLabel(target);

          return (
            <Fragment key={target.id}>
              <Circle
                center={toLatLng(target.coordinates)}
                className="target-anchor-radius"
                interactive={false}
                pathOptions={targetRadiusPathOptions(target, selected)}
                pmIgnore
                radius={targetRadiusMeters(target)}
              />
              <TargetMarker
                mapState={mapState}
                onMapStateChange={onMapStateChange}
                onSelect={() => onSelectedEntityChange({ kind: "target", id: target.id })}
                position={toLatLng(target.coordinates)}
                selected={selected}
                target={target}
              >
                <Tooltip sticky>{label}</Tooltip>
                <Popup>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">{label}</p>
                    <p>{target.priority} priority / {target.influence}</p>
                    <p>{target.radiusMinutes} min planning radius</p>
                    <p>{formatCoordinate(target.coordinates)}</p>
                  </div>
                </Popup>
              </TargetMarker>
            </Fragment>
          );
        }) : null}

        {visibleLayers.listings ? listingPins.map((listing) => (
          <ListingMarker key={listing.id} position={toLatLng(listing.coordinates)} title={listing.title}>
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{listing.title}</p>
                <p>Marker precision: {listing.markerPrecision}</p>
                <p>{formatCoordinate(listing.coordinates)}</p>
                {listing.priceMonthly ? <p>${listing.priceMonthly.toLocaleString()}/mo</p> : null}
              </div>
            </Popup>
          </ListingMarker>
        )) : null}
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
