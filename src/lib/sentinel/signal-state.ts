// APEX SENTINEL — UNIFIED SIGNAL STATE (translation layer only).
//
// REFINEMENT 1 + 2 + 4.
//
// This module DOES NOT compute anything new. Every underlying engine keeps its
// own vocabulary and its own maths:
//
//   EntryPointStatus   (entry-point.ts)
//   EntryVerdict       (entry-clearance.ts)
//   SetupGrade         (setup.ts)
//   RelativeEdgeLabel  (relative-edge.ts)
//
// It only normalises those existing states into ONE presentation vocabulary so
// the UI stops having to interpret four enums at once:
//
//   STRONG · VALID · WATCH · EXPLORATORY · BLOCKED
//
// plus the explicit REFINEMENT 2 sub-state "VALID — WAIT FOR ENTRY": the market
// and contract qualify, but the Entry-Point Engine has not validated a digit.
// In that case the entry digit is reported as WAIT. It is never fabricated.
import type { ApexContractId } from "../apex/types";
import {
  DEFAULT_MIN_SETUP,
  DEFAULT_MIN_WEIGHTED_N,
  type EntryVerdict,
} from "./entry-clearance";
import type { EntryPointReport } from "./entry-point";
import type { RelativeEdgeLabel } from "./relative-edge";
import type { SetupGrade } from "./setup";

export type SentinelSignalState =
  | "STRONG"
  | "VALID"
  | "WATCH"
  | "EXPLORATORY"
  | "BLOCKED";

export interface SentinelSignal {
  state: SentinelSignalState;
  /** True only for REFINEMENT 2: setup qualifies, entry digit does not yet. */
  waitForEntry: boolean;
  /** Presentation label, e.g. "VALID — WAIT FOR ENTRY". */
  label: string;
  /** What the operator should type into the ENTRY DIGIT field. */
  entryDigit: string;
  /** Short reason, built from the existing engine states. */
  reason: string;
  /** The unchanged source states this was translated from. */
  source: {
    entryStatus: EntryPointReport["status"];
    verdict: EntryVerdict;
    grade: SetupGrade;
    relative: RelativeEdgeLabel;
  };
}

// ── REFINEMENT 4 — per-contract-family qualification thresholds ──────────
// The families share the current global defaults, so behaviour is unchanged.
// They exist so each family can be tuned independently later.
export type ContractFamily = "OVER1_UNDER8" | "OVER2_UNDER7" | "OVER3_UNDER6";

export interface EntryQualification {
  minSetup: number;
  minWeightedN: number;
}

export const entryQualificationByFamily: Record<ContractFamily, EntryQualification> = {
  OVER1_UNDER8: { minSetup: DEFAULT_MIN_SETUP, minWeightedN: DEFAULT_MIN_WEIGHTED_N },
  OVER2_UNDER7: { minSetup: DEFAULT_MIN_SETUP, minWeightedN: DEFAULT_MIN_WEIGHTED_N },
  OVER3_UNDER6: { minSetup: DEFAULT_MIN_SETUP, minWeightedN: DEFAULT_MIN_WEIGHTED_N },
};

const FAMILY_OF: Partial<Record<ApexContractId, ContractFamily>> = {
  OVER1: "OVER1_UNDER8",
  UNDER8: "OVER1_UNDER8",
  OVER2: "OVER2_UNDER7",
  UNDER7: "OVER2_UNDER7",
  OVER3: "OVER3_UNDER6",
  UNDER6: "OVER3_UNDER6",
};

export function contractFamilyOf(contract: string): ContractFamily | null {
  return FAMILY_OF[contract as ApexContractId] ?? null;
}

/** Thresholds for a contract; falls back to the existing global defaults. */
export function qualificationFor(contract: string): EntryQualification {
  const family = contractFamilyOf(contract);
  return family
    ? entryQualificationByFamily[family]
    : { minSetup: DEFAULT_MIN_SETUP, minWeightedN: DEFAULT_MIN_WEIGHTED_N };
}

export interface SignalStateInputs {
  entryPoint: EntryPointReport;
  verdict: EntryVerdict;
  grade: SetupGrade;
  relative: RelativeEdgeLabel;
  /** Hard invalidation / danger clearance already decided elsewhere. */
  blocked: boolean;
}

/** A digit is validated only when the Entry-Point Engine says so. */
export function hasValidatedEntryDigit(ep: EntryPointReport): boolean {
  return (
    ep.preferred !== null &&
    (ep.status === "ENTER NOW" || ep.status === "ARMED")
  );
}

export function resolveSignalState(input: SignalStateInputs): SentinelSignal {
  const { entryPoint: ep, verdict, grade, relative, blocked } = input;
  const source = { entryStatus: ep.status, verdict, grade, relative: relative };

  if (blocked || verdict === "BLOCKED" || ep.status === "INVALIDATED") {
    return {
      state: "BLOCKED",
      waitForEntry: false,
      label: "BLOCKED",
      entryDigit: "—",
      reason:
        ep.status === "INVALIDATED"
          ? "Hard invalidation on the entry point (danger clearance, severe exposure or chaotic fluctuation)."
          : "A blocking requirement is unmet in the entry-clearance stage.",
      source,
    };
  }

  const digit = hasValidatedEntryDigit(ep);
  // "Meaningful setup" reuses the existing grades and relative-edge labels; no
  // new scoring is introduced here.
  const setupQualifies = grade === "PRIME" || grade === "GOOD";
  const edgeSufficient =
    relative === "STRONG" || relative === "MODERATE" || relative === "MARGINAL";

  if (setupQualifies && edgeSufficient && !digit) {
    // REFINEMENT 2 — valid setup, no validated entry digit. Not BLOCKED, and
    // not "no opportunity". Wait for the Entry-Point Engine to validate a digit.
    return {
      state: "VALID",
      waitForEntry: true,
      label: "VALID — WAIT FOR ENTRY",
      entryDigit: "WAIT",
      reason:
        "Setup and relative edge qualify, but no entry digit has sufficient conditional evidence yet. Wait for a validated entry digit — none will be fabricated.",
      source,
    };
  }

  if (digit && setupQualifies && (relative === "STRONG" || relative === "MODERATE") && verdict === "CLEARED") {
    return {
      state: "STRONG",
      waitForEntry: false,
      label: "STRONG",
      entryDigit: String(ep.preferred!.digit),
      reason: `Entry cleared with a validated digit and ${relative.toLowerCase()} relative edge (margin ${ep.entryMargin >= 0 ? "+" : ""}${ep.entryMargin} over runner-up ${ep.runnerUpDigit ?? "—"}).`,
      source,
    };
  }

  if (digit && (setupQualifies || edgeSufficient)) {
    return {
      state: "VALID",
      waitForEntry: false,
      label: "VALID",
      entryDigit: String(ep.preferred!.digit),
      reason: `Validated entry digit ${ep.preferred!.digit} with entry margin ${ep.entryMargin >= 0 ? "+" : ""}${ep.entryMargin} over the runner-up.`,
      source,
    };
  }

  if (grade === "MARGINAL" || relative === "LEVEL") {
    return {
      state: "WATCH",
      waitForEntry: !digit,
      label: digit ? "WATCH" : "WATCH — NO VALIDATED ENTRY",
      entryDigit: digit ? String(ep.preferred!.digit) : "WAIT",
      reason: `Setup ${grade} with ${relative} relative edge — monitored, not actionable.`,
      source,
    };
  }

  return {
    state: "EXPLORATORY",
    waitForEntry: !digit,
    label: "EXPLORATORY",
    entryDigit: digit ? String(ep.preferred!.digit) : "WAIT",
    reason: `Evidence is immature for this candidate (setup ${grade}, relative edge ${relative}) — exploratory only.`,
    source,
  };
}
