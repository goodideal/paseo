import type { PaseoAgentHandle } from "@getpaseo/client";
import {
  createHarnessTransitionTimelineItem,
  type HarnessTransitionWireData,
} from "../shared/contracts.js";
import type {
  DomainRole,
  HarnessPhase,
  HarnessTransitionKind,
  MatrixTier,
} from "../shared/types.js";

export interface EmitHarnessTransitionParams {
  handle: PaseoAgentHandle;
  transitionKind: HarnessTransitionKind;
  role: DomainRole;
  fromTier: MatrixTier | null;
  toTier: MatrixTier;
  fromModel: string | null;
  toModel: string | null;
  phase: HarnessPhase;
  reason: string;
  turnNumber: number;
  childAgentId?: string | null;
  childAgentTitle?: string | null;
}

export type EmitHarnessTransitionPayload = Omit<EmitHarnessTransitionParams, "handle">;

export async function emitHarnessTimelineTransition(
  params: EmitHarnessTransitionParams,
): Promise<void>;
export async function emitHarnessTimelineTransition(
  handle: PaseoAgentHandle,
  payload: EmitHarnessTransitionPayload,
): Promise<void>;
export async function emitHarnessTimelineTransition(
  handleOrParams: PaseoAgentHandle | EmitHarnessTransitionParams,
  maybePayload?: EmitHarnessTransitionPayload,
): Promise<void> {
  if (!handleOrParams) {
    return;
  }

  const params: EmitHarnessTransitionParams = maybePayload
    ? { handle: handleOrParams as PaseoAgentHandle, ...maybePayload }
    : (handleOrParams as EmitHarnessTransitionParams);

  const {
    handle,
    transitionKind,
    role,
    fromTier,
    toTier,
    fromModel,
    toModel,
    phase,
    reason,
    turnNumber,
    childAgentId,
    childAgentTitle,
  } = params;

  if (!handle?.timeline?.append) {
    return;
  }

  const wireData: HarnessTransitionWireData = {
    transitionKind,
    role,
    fromTier: fromTier ?? null,
    toTier,
    fromModel: fromModel ?? null,
    toModel: toModel ?? null,
    phase,
    reason,
    turnNumber: Math.max(0, turnNumber),
    childAgentId: childAgentId ?? null,
    childAgentTitle: childAgentTitle ?? null,
    timestamp: new Date().toISOString(),
  };

  const itemId = `harness_tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const item = createHarnessTransitionTimelineItem(wireData, itemId);

  try {
    await handle.timeline.append(item);
  } catch (error) {
    // Gracefully ignore timeline append failures (e.g. host doesn't support or agent closed)
  }
}
