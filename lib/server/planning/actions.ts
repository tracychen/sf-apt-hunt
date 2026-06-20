import { z } from "zod";

import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import type {
  ExecutePlanningActionRequest,
  ExecutePlanningActionResponse,
  MapPatchProposal,
  PlanningActionRecord,
  PlanningActionTarget,
  PlanningChatPart,
} from "@/lib/domain/types";
import { applyProposal } from "@/lib/map/proposals";
import type { PlanningStore } from "@/lib/server/planning/store";
import { redactSecrets } from "@/lib/server/redaction";

type PlanningActionErrorCode =
  | "action_not_found"
  | "action_terminal"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "message_not_found"
  | "payload_action_mismatch"
  | "proposal_hash_mismatch"
  | "proposal_apply_failed"
  | "stale_map_revision"
  | "stale_listing_ledger_revision"
  | "listing_snapshot_mismatch"
  | "listing_lead_not_found"
  | "no_allowed_operations";

export class PlanningActionError extends Error {
  constructor(
    readonly code: PlanningActionErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

export async function executePlanningAction(input: {
  store: PlanningStore;
  request: ExecutePlanningActionRequest;
  now: string;
}): Promise<ExecutePlanningActionResponse> {
  const action = await input.store.getAction(input.request.actionId);

  if (!action || action.threadId !== input.request.threadId) {
    throw new PlanningActionError("action_not_found");
  }

  const payloadHash = input.store.hashPayload(input.request.payload);
  const claim = await input.store.claimActionExecution({
    actionId: action.id,
    idempotencyKey: input.request.idempotencyKey,
    payloadHash,
    now: input.now,
  });

  if (claim.status === "completed") {
    const execution = await input.store.getExecution(claim.executionId);

    if (!execution) {
      throw new PlanningActionError("idempotency_in_progress");
    }

    if (execution.payloadHash !== payloadHash) {
      throw new PlanningActionError("idempotency_conflict");
    }

    return input.store.buildExecutionResponse(action.id, execution.id);
  }

  if (claim.status === "conflict") {
    throw new PlanningActionError("idempotency_conflict");
  }

  if (claim.status === "in_progress") {
    throw new PlanningActionError("idempotency_in_progress");
  }

  if (claim.status === "action_not_found") {
    throw new PlanningActionError("action_not_found");
  }

  if (claim.status === "action_terminal") {
    throw new PlanningActionError("action_terminal");
  }

  try {
    if (input.request.payload.kind === "mapProposal") {
      return await executeMapProposalAction(input, action, payloadHash);
    }

    if (
      input.request.payload.kind === "listingSave" ||
      input.request.payload.kind === "listingDismiss"
    ) {
      return await executeListingLifecycleAction(input, action, payloadHash);
    }

    if (input.request.payload.kind === "dismiss") {
      return await dismissAction(input, action, payloadHash);
    }

    return await executeTargetEditAction(input, action, payloadHash);
  } catch (error) {
    await recordFailedExecution(input, action, payloadHash, error);
    throw error;
  }
}

async function executeMapProposalAction(
  input: {
    store: PlanningStore;
    request: ExecutePlanningActionRequest;
    now: string;
  },
  action: PlanningActionRecord,
  payloadHash: string,
) {
  if (input.request.payload.kind !== "mapProposal") {
    throw new PlanningActionError("payload_action_mismatch");
  }

  const target = getMapProposalTarget(action.target);

  if (input.request.payload.expectedMapRevision !== target.mapRevision) {
    throw new PlanningActionError("stale_map_revision");
  }

  const proposal = await loadStoredProposal(input.store, target, "mapProposal");
  const filteredProposal = filterProposalOperations(
    proposal,
    allowedOperationIndexes(target),
    input.request.payload.operationIndexes,
  );

  return applyStoredProposalAction(
    input,
    action,
    payloadHash,
    filteredProposal,
    target.mapRevision,
  );
}

async function executeTargetEditAction(
  input: {
    store: PlanningStore;
    request: ExecutePlanningActionRequest;
    now: string;
  },
  action: PlanningActionRecord,
  payloadHash: string,
) {
  if (input.request.payload.kind !== "targetEdit") {
    throw new PlanningActionError("payload_action_mismatch");
  }

  const target = getTargetEditTarget(action.target);

  if (input.request.payload.expectedMapRevision !== target.mapRevision) {
    throw new PlanningActionError("stale_map_revision");
  }

  const proposal = await loadStoredProposal(input.store, target, "targetEditProposal");
  const filteredProposal = filterProposalOperations(
    proposal,
    target.allowedOperationIndexes,
    input.request.payload.operationIndexes,
  );

  return applyStoredProposalAction(
    input,
    action,
    payloadHash,
    filteredProposal,
    target.mapRevision,
  );
}

async function applyStoredProposalAction(
  input: {
    store: PlanningStore;
    request: ExecutePlanningActionRequest;
    now: string;
  },
  action: PlanningActionRecord,
  payloadHash: string,
  filteredProposal: MapPatchProposal,
  expectedMapRevision: string,
) {
  const mapSnapshot = await input.store.getMapSnapshot(action.threadId);

  if (!mapSnapshot) {
    throw new PlanningActionError("action_not_found");
  }

  const applied = applyProposal(mapSnapshot.mapState, filteredProposal);

  if (!applied.ok) {
    throw new PlanningActionError("proposal_apply_failed", applied.error);
  }

  const parsedState = mapStateSchema.safeParse(applied.state);

  if (!parsedState.success) {
    throw new PlanningActionError("proposal_apply_failed", "Proposal exceeds map limits.");
  }

  const updatedSnapshot = await input.store.updateMapSnapshot({
    threadId: action.threadId,
    expectedRevision: expectedMapRevision,
    mapState: parsedState.data,
    now: input.now,
  });

  if (!updatedSnapshot.ok) {
    throw new PlanningActionError(
      updatedSnapshot.error === "stale_map_revision" ? "stale_map_revision" : "action_not_found",
    );
  }

  const execution = await input.store.createExecution({
    actionId: action.id,
    idempotencyKey: input.request.idempotencyKey,
    payloadHash,
    status: "succeeded",
    now: input.now,
  });
  const updatedAction = await input.store.updateAction({
    actionId: action.id,
    status: "applied",
    now: input.now,
  });

  if (!updatedAction.ok) {
    throw new PlanningActionError("action_not_found");
  }

  return {
    action: updatedAction.action,
    execution,
    mapSnapshot: updatedSnapshot.snapshot,
    mapState: updatedSnapshot.snapshot.mapState,
  };
}

async function executeListingLifecycleAction(
  input: {
    store: PlanningStore;
    request: ExecutePlanningActionRequest;
    now: string;
  },
  action: PlanningActionRecord,
  payloadHash: string,
) {
  if (input.request.payload.kind !== "listingSave" && input.request.payload.kind !== "listingDismiss") {
    throw new PlanningActionError("payload_action_mismatch");
  }

  if (
    action.target.kind !== "listingLead" ||
    (input.request.payload.kind === "listingSave" && action.kind !== "listingSave") ||
    (input.request.payload.kind === "listingDismiss" && action.kind !== "listingDismiss")
  ) {
    throw new PlanningActionError("payload_action_mismatch");
  }

  const listingStatus = input.request.payload.kind === "listingSave" ? "saved" : "dismissed";

  if (input.request.payload.expectedListingSnapshotHash !== action.target.listingSnapshotHash) {
    throw new PlanningActionError("listing_snapshot_mismatch");
  }

  const updatedLead = await input.store.updateListingLeadStatus({
    threadId: action.threadId,
    canonicalUrl: action.target.canonicalUrl,
    expectedRevision: input.request.payload.expectedListingLedgerRevision,
    status: listingStatus,
    now: input.now,
  });

  if (!updatedLead.ok) {
    throw new PlanningActionError(
      updatedLead.error === "thread_not_found" ? "action_not_found" : updatedLead.error,
    );
  }

  const execution = await input.store.createExecution({
    actionId: action.id,
    idempotencyKey: input.request.idempotencyKey,
    payloadHash,
    status: "succeeded",
    now: input.now,
  });
  const updatedAction = await input.store.updateAction({
    actionId: action.id,
    status: "applied",
    now: input.now,
  });

  if (!updatedAction.ok) {
    throw new PlanningActionError("action_not_found");
  }

  return {
    action: updatedAction.action,
    execution,
    listingLead: updatedLead.lead,
    listingLedgerRevision: updatedLead.listingLedgerRevision,
  };
}

async function dismissAction(
  input: {
    store: PlanningStore;
    request: ExecutePlanningActionRequest;
    now: string;
  },
  action: PlanningActionRecord,
  payloadHash: string,
) {
  const execution = await input.store.createExecution({
    actionId: action.id,
    idempotencyKey: input.request.idempotencyKey,
    payloadHash,
    status: "succeeded",
    now: input.now,
  });
  const updatedAction = await input.store.updateAction({
    actionId: action.id,
    status: "dismissed",
    now: input.now,
  });

  if (!updatedAction.ok) {
    throw new PlanningActionError("action_not_found");
  }

  return { action: updatedAction.action, execution };
}

function getMapProposalTarget(
  target: PlanningActionTarget,
): Extract<PlanningActionTarget, { kind: "mapProposal" | "mapProposalItem" }> {
  if (target.kind === "mapProposal" || target.kind === "mapProposalItem") {
    return target;
  }

  throw new PlanningActionError("payload_action_mismatch");
}

function getTargetEditTarget(
  target: PlanningActionTarget,
): Extract<PlanningActionTarget, { kind: "targetEdit" }> {
  if (target.kind !== "targetEdit") {
    throw new PlanningActionError("payload_action_mismatch");
  }

  return target;
}

async function loadStoredProposal(
  store: PlanningStore,
  target: Extract<
    PlanningActionTarget,
    { kind: "mapProposal" | "mapProposalItem" | "targetEdit" }
  >,
  partType: Extract<PlanningChatPart["type"], "mapProposal" | "targetEditProposal">,
) {
  const message = await store.getMessage(target.messageId);

  if (!message) {
    throw new PlanningActionError("message_not_found");
  }

  const part = message.parts[target.partIndex];

  if (part?.type !== partType) {
    throw new PlanningActionError("message_not_found");
  }

  const proposal = mapPatchProposalSchema.parse(part.proposal);

  if (store.hashPayload(proposal) !== target.proposalHash) {
    throw new PlanningActionError("proposal_hash_mismatch");
  }

  return proposal;
}

function allowedOperationIndexes(
  target: Extract<PlanningActionTarget, { kind: "mapProposal" | "mapProposalItem" }>,
) {
  if (target.kind === "mapProposalItem") {
    return [target.operationIndex];
  }

  return target.allowedOperationIndexes;
}

function filterProposalOperations(
  proposal: MapPatchProposal,
  allowedIndexes: number[],
  requestedIndexes: number[],
): MapPatchProposal {
  const requested = new Set(requestedIndexes);
  const allowed = new Set(allowedIndexes);
  const disallowedIndex = requestedIndexes.find((index) => !allowed.has(index));

  if (disallowedIndex !== undefined) {
    throw new PlanningActionError(
      "no_allowed_operations",
      "Requested proposal operation is not allowed.",
    );
  }

  const operations = proposal.operations.filter(
    (_operation, index) => requested.has(index) && allowed.has(index),
  );

  if (operations.length === 0) {
    throw new PlanningActionError("no_allowed_operations");
  }

  return { ...proposal, operations };
}

async function recordFailedExecution(
  input: {
    store: PlanningStore;
    request: ExecutePlanningActionRequest;
    now: string;
  },
  action: PlanningActionRecord,
  payloadHash: string,
  error: unknown,
) {
  const safeError = safeErrorString(error);
  const failureKind = classifyFailure(error);

  await input.store.createExecution({
    actionId: action.id,
    idempotencyKey: input.request.idempotencyKey,
    payloadHash,
    status: "failed",
    now: input.now,
    error: safeError,
  });

  await input.store.updateAction({
    actionId: action.id,
    status: "failed",
    now: input.now,
    error: safeError,
    failureKind,
    onlyIfNotTerminal: true,
  });
}

function classifyFailure(error: unknown) {
  if (!(error instanceof PlanningActionError)) {
    return "retryable";
  }

  if (error.code === "stale_map_revision" || error.code === "stale_listing_ledger_revision") {
    return "retryable";
  }

  return "permanent";
}

function safeErrorString(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSecrets(message);

  return typeof redacted === "string" ? redacted : "Planning action failed.";
}

export function toPlanningActionErrorResponse(error: unknown) {
  if (error instanceof PlanningActionError) {
    const response = planningActionErrorResponse[error.code];

    return Response.json({ ok: false, error: response.message }, { status: response.status });
  }

  if (error instanceof z.ZodError) {
    return Response.json(
      { ok: false, error: "Invalid planning action request.", details: redactSecrets(error.issues) },
      { status: 400 },
    );
  }

  return Response.json(
    { ok: false, error: "Unable to execute planning action.", details: redactSecrets(error) },
    { status: 500 },
  );
}

const planningActionErrorResponse: Record<
  PlanningActionErrorCode,
  { status: number; message: string }
> = {
  action_not_found: { status: 404, message: "Planning action was not found." },
  action_terminal: { status: 409, message: "Planning action is already complete." },
  idempotency_conflict: { status: 409, message: "Idempotency key was reused with a different payload." },
  idempotency_in_progress: { status: 409, message: "Planning action execution is already in progress." },
  message_not_found: { status: 400, message: "Stored planning message was not found." },
  payload_action_mismatch: { status: 400, message: "Planning action payload does not match the stored action." },
  proposal_hash_mismatch: { status: 400, message: "Stored planning proposal does not match the action target." },
  proposal_apply_failed: { status: 400, message: "Planning proposal could not be applied." },
  stale_map_revision: { status: 409, message: "Map revision is stale." },
  stale_listing_ledger_revision: { status: 409, message: "Listing ledger revision is stale." },
  listing_snapshot_mismatch: {
    status: 400,
    message: "Listing snapshot hash does not match the stored action.",
  },
  listing_lead_not_found: { status: 404, message: "Listing lead was not found." },
  no_allowed_operations: { status: 400, message: "No allowed proposal operations were selected." },
};
