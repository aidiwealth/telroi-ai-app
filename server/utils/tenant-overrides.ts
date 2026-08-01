// server/utils/tenant-overrides.ts
// Numeric settings a client can be given their own value for.
//
// Each of these used to be added by hand in four places — a Zod field, a patch
// assignment, and the same again at platform level — and forgetting one was
// silent: the form took a value and the endpoint dropped it. That's how a Stripe
// webhook secret went missing for an hour, and how these very settings were nearly
// added without the plan endpoint accepting them.
//
// Declared once here, the schema and the patch are derived, so a new setting is
// one entry rather than four edits and a hope.
import { z } from 'zod';

export interface OverrideSpec {
  min?: number;
  max?: number;
  /** What it means, for the operator reading an admin page. */
  label: string;
}

/** Per-client overrides. Null clears one and falls back to the platform default. */
export const TENANT_OVERRIDES = {
  sandboxCallCap: { min: 0, label: 'Sandbox test calls' },
  sandboxAgentCap: { min: 0, label: 'Sandbox AI numbers' },
  trialAiAllowanceUsdMinor: { min: 0, label: 'Free trial AI (USD minor)' },
  trialCallMaxSeconds: { min: 0, label: 'Trial call limit (seconds)' }
} satisfies Record<string, OverrideSpec>;

/** Platform-wide defaults. Not nullable — something must always be in force. */
export const PLATFORM_LIMITS = {
  sandboxCallCap: { min: 0, label: 'Sandbox test calls' },
  sandboxAgentCap: { min: 0, label: 'Sandbox AI numbers' },
  trialAiAllowanceUsdMinor: { min: 0, label: 'Free trial AI (USD minor)' },
  trialCallMaxSeconds: { min: 0, label: 'Trial call limit (seconds)' }
} satisfies Record<string, OverrideSpec>;

type SpecMap = Record<string, OverrideSpec>;

/** Zod shape for a set of settings. Nullable ones accept null to clear. */
export function overrideSchema(specs: SpecMap, nullable: boolean) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(specs)) {
    let f = z.coerce.number().int();
    if (spec.min !== undefined) f = f.min(spec.min);
    if (spec.max !== undefined) f = f.max(spec.max);
    shape[key] = nullable ? f.nullable().optional() : f.optional();
  }
  return shape;
}

/**
 * Copy whichever of these settings the request actually sent into a patch.
 * Anything absent is left alone; null clears an override where that's allowed.
 */
export function applyOverrides(specs: SpecMap, data: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const key of Object.keys(specs)) {
    if (data[key] !== undefined) patch[key] = data[key];
  }
  return patch;
}
