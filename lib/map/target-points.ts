import type {
  MapState,
  TargetInfluence,
  TargetPoint,
  TargetRadiusMinutes,
} from "@/lib/domain/types";

export const WALKING_METERS_PER_MINUTE = 80;

export type TargetPlanningFieldPatch = Partial<
  Pick<TargetPoint, "name" | "purpose" | "influence" | "priority" | "radiusMinutes" | "notes">
>;

export function formatTargetLabel(target: Pick<TargetPoint, "purpose" | "name">) {
  const purpose = target.purpose.trim();
  const name = target.name.trim();

  if (purpose.length === 0 || purpose === name) {
    return name;
  }

  if (name.length === 0) {
    return purpose;
  }

  return `${purpose} · ${name}`;
}

export function targetRadiusMeters(target: Pick<TargetPoint, "radiusMinutes">) {
  return target.radiusMinutes * WALKING_METERS_PER_MINUTE;
}

export function applyTargetPlanningFieldPatch(
  mapState: MapState,
  targetId: string,
  patch: TargetPlanningFieldPatch,
) {
  const target = mapState.targets.find((item) => item.id === targetId);

  if (!target) {
    return null;
  }

  const nextTarget = { ...target };

  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) {
      Object.assign(nextTarget, { [field]: value });
    }
  }

  if (targetsEqual(target, nextTarget)) {
    return null;
  }

  return {
    ...mapState,
    targets: mapState.targets.map((item) => (item.id === targetId ? nextTarget : item)),
  };
}

export function isTargetInfluence(value: unknown): value is TargetInfluence {
  return value === "positive" || value === "negative" || value === "neutral";
}

export function isTargetRadiusMinutes(value: unknown): value is TargetRadiusMinutes {
  return value === 5 || value === 10 || value === 15 || value === 20;
}

function targetsEqual(left: TargetPoint, right: TargetPoint) {
  return (
    left.name === right.name &&
    left.purpose === right.purpose &&
    left.influence === right.influence &&
    left.priority === right.priority &&
    left.radiusMinutes === right.radiusMinutes &&
    left.notes.length === right.notes.length &&
    left.notes.every((note, index) => note === right.notes[index])
  );
}
