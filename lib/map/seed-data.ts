import type { Coordinate, MapState, MapZone } from "@/lib/domain/types";

export const samplePlanningMapState: MapState = {
  zones: [
    {
      id: "marina-cow-hollow",
      name: "Marina / Cow Hollow",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.452, 37.809],
            [-122.426, 37.809],
            [-122.426, 37.795],
            [-122.452, 37.795],
            [-122.452, 37.809],
          ],
        ],
      },
      fitnessScore: 5,
      affordabilityScore: 2,
      carFreeScore: 3,
      notes: ["Strong boutique fitness access; rents trend higher."],
    },
    {
      id: "lower-pac-heights",
      name: "Lower Pac Heights",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.444, 37.794],
            [-122.421, 37.794],
            [-122.421, 37.781],
            [-122.444, 37.781],
            [-122.444, 37.794],
          ],
        ],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Good Fillmore access and central bus corridors."],
    },
    {
      id: "mission-dolores-valencia",
      name: "Mission Dolores / Valencia",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.432, 37.77],
            [-122.415, 37.77],
            [-122.415, 37.752],
            [-122.432, 37.752],
            [-122.432, 37.77],
          ],
        ],
      },
      fitnessScore: 5,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Best car-free access and strong studio/fitness density."],
    },
    {
      id: "lower-haight-duboce-hayes",
      name: "Lower Haight / Duboce / Hayes",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.438, 37.78],
            [-122.419, 37.78],
            [-122.419, 37.768],
            [-122.438, 37.768],
            [-122.438, 37.78],
          ],
        ],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Central, transit-rich, and strong access to Hayes and Castro edges."],
    },
    {
      id: "nob-hill-polk-gulch",
      name: "Nob Hill / Polk Gulch",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.425, 37.799],
            [-122.408, 37.799],
            [-122.408, 37.786],
            [-122.425, 37.786],
            [-122.425, 37.799],
          ],
        ],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Dense rental stock and strong Polk corridor access."],
    },
    {
      id: "panhandle-nopa",
      name: "Panhandle / NOPA",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.458, 37.782],
            [-122.432, 37.782],
            [-122.432, 37.769],
            [-122.458, 37.769],
            [-122.458, 37.782],
          ],
        ],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Good park access and Divisadero corridor options."],
    },
    {
      id: "van-ness-lower-russian-hill",
      name: "Van Ness / Lower Russian Hill",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.426, 37.807],
            [-122.416, 37.807],
            [-122.416, 37.792],
            [-122.426, 37.792],
            [-122.426, 37.807],
          ],
        ],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Central north-side access with Van Ness transit."],
    },
  ],
  areas: [],
  corridors: [
    {
      id: "valencia",
      name: "Valencia Street",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.421, 37.752],
          [-122.421, 37.769],
        ],
      },
      priority: "high",
      tags: ["fitness", "rent", "transit"],
      notes: ["Core Mission target corridor."],
    },
    {
      id: "fillmore",
      name: "Fillmore Street",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.433, 37.781],
          [-122.433, 37.794],
        ],
      },
      priority: "high",
      tags: ["fitness", "transit"],
      notes: ["Lower Pac Heights and Japantown access."],
    },
    {
      id: "polk",
      name: "Polk Street",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.421, 37.786],
          [-122.421, 37.802],
        ],
      },
      priority: "medium",
      tags: ["fitness", "rent"],
      notes: ["Dense rental and services corridor."],
    },
  ],
  targets: [
    {
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "Lower Pac Heights reference point",
      coordinates: [-122.433, 37.789],
      priority: "high",
      influence: "positive",
      radiusMinutes: 10,
      notes: ["Lower Pac Heights reference point."],
    },
    {
      id: "valencia-20th",
      name: "Valencia & 20th",
      purpose: "Mission favorite block",
      coordinates: [-122.421, 37.758],
      priority: "high",
      influence: "positive",
      radiusMinutes: 10,
      notes: ["Mission Dolores / Valencia reference point."],
    },
    {
      id: "polk-sacramento",
      name: "Polk & Sacramento",
      purpose: "Polk corridor reference point",
      coordinates: [-122.421, 37.792],
      priority: "medium",
      influence: "neutral",
      radiusMinutes: 10,
      notes: ["Polk Gulch reference point."],
    },
  ],
};

export const seedMapState: MapState = {
  zones: samplePlanningMapState.zones.map(toReferenceZone),
  areas: [],
  corridors: [],
  targets: [],
};

function toReferenceZone(zone: MapZone): MapZone {
  return {
    ...zone,
    geometry: {
      type: zone.geometry.type,
      coordinates: zone.geometry.coordinates.map((ring) =>
        ring.map(([lng, lat]): Coordinate => [lng, lat]),
      ),
    },
    fitnessScore: 3,
    affordabilityScore: 3,
    carFreeScore: 3,
    notes: [],
  };
}
