// APEX SENTINEL — cross-market ranking + SCAN NOW.
// SCAN NOW does NOT start analysis. The core is always analysing; this
// interrogates the latest intelligence state and answers: what is the
// strongest opportunity right now?
//
// The ranking is built in three passes so that RELATIVE measures are real:
//   1. per-candidate absolute evidence (unchanged from the original model),
//   2. RELATIVE EDGE against the rest of the current field,
//   3. SIGNAL PERSISTENCE / EDGE STABILITY from the retained scan history.
// Nothing in passes 2–3 can delete a candidate; they adjust ranking only.
import { apexCore } from "./core";
import { lookupAnalogue, fingerprint } from "./memory";
import { entryLab } from "./entry-conditions";
import { apexSimulator, engineAgreement, simulatorAdjustment } from "./simulator";
import { assessClearance } from "./clearance";
import { classifyEvidence } from "./evidence-status";
import { marketProfiles } from "./profiles";
import { computeDirection } from "../sentinel/direction";
import { composeDanger } from "../sentinel/danger";
import { computeSetup } from "../sentinel/setup";
import {
  comboLearning,
  IMMEDIATE_CONDITION,
  UNKNOWN_REGIME,
} from "../sentinel/combination-learning";
import { assessEntryClearance } from "../sentinel/entry-clearance";
import { computeEntryPoint } from "../sentinel/entry-point";
import { operatorLearningLookup } from "../sentinel/operator-learning";
import { qualificationFor, resolveSignalState } from "../sentinel/signal-state";
import { computeRelativeEdges, type RelativeEdgeInput } from "../sentinel/relative-edge";
import { scanMemory, type ScanMemoryEntry } from "../sentinel/scan-memory";
import type { MarketIntel, RankedOpportunity, ScanResult } from "./types";
import { PRIMARY_CONTRACTS } from "./types";


export interface ScanOptions {
  /** Extra score awarded to Under 7 / Over 2 — the operator's primary
   *  contracts. A preference window, not a hard override. */
  preferenceWindow: number;
  /** Minimum opportunity score to call something a real opportunity. */
  opportunityThreshold: number;
  /** Reject contracts above this danger level. */
  maxDanger: number;
  /** Minimum ticks required for a market to be considered. */
  minTicks: number;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  preferenceWindow: 4,
  opportunityThreshold: 70,
  maxDanger: 65,
  minTicks: 400,
};

export function globalDanger(intels: MarketIntel[]): number {
  const usable = intels.filter((i) => i.dataState === "OK" || i.dataState === "THIN");
  if (!usable.length) return 100;
  const mean = usable.reduce((a, i) => a + i.danger, 0) / usable.length;
  const hostile = usable.filter((i) => i.danger > 60).length / usable.length;
  return Math.round(Math.max(0, Math.min(100, mean * 0.7 + hostile * 100 * 0.3)));
}

export function rankOpportunities(
  intels: MarketIntel[],
  opts: ScanOptions = DEFAULT_SCAN_OPTIONS,
  /**
   * Only an explicit SCAN NOW writes to the rolling scan history. The live
   * table re-ranks every second and must not pollute scan-to-scan persistence.
   */
  recordHistory = false,
): { ranked: RankedOpportunity[]; rejected: ScanResult["rejected"] } {
  const ranked: RankedOpportunity[] = [];
  const rejected: ScanResult["rejected"] = [];
  // Derived once per ranking pass from the EXISTING persisted feedback store.
  const operatorLearning = operatorLearningLookup();


  for (const intel of intels) {
    if (intel.dataState === "UNAVAILABLE") {
      rejected.push({ symbol: intel.symbol, contract: "—", reason: "DATA UNAVAILABLE" });
      continue;
    }
    if (intel.dataState === "STALE") {
      rejected.push({ symbol: intel.symbol, contract: "—", reason: "DATA STALE — feed silent" });
      continue;
    }
    if (intel.ticks < opts.minTicks) {
      rejected.push({
        symbol: intel.symbol,
        contract: "—",
        reason: `DATA THIN — ${intel.ticks} ticks (< ${opts.minTicks})`,
      });
      continue;
    }
    for (const c of intel.contracts) {
      // ── Safety is assessed SEPARATELY from direction ──────────────────
      // Nothing below deletes a candidate. A blocked candidate stays in the
      // ranking, labelled BLOCKED with its reasons, so a genuine opportunity
      // is never silently lost and a weak one is never silently promoted.
      const sim = simulatorAdjustment(intel.symbol, c.id, c.theoretical);
      const recentPerf = apexSimulator.recentPerformance(intel.symbol, c.id, c.theoretical);
      const clearance = assessClearance({
        intel,
        contract: c,
        recent: recentPerf,
        lifetime: sim.perf,
        maxDanger: opts.maxDanger,
        maxLosingThreat: 82,
      });
      const entryRec = entryLab.recommend(intel.symbol, c.id, c.theoretical);
      const evidence = classifyEvidence({
        lifetime: sim.perf,
        recent: recentPerf,
        theoretical: c.theoretical,
        clearance,
        entry: entryRec,
      });

      // ══ SENTINEL STAGED VERDICT ══════════════════════════════════════
      // Stage 1: which way does the measured evidence point?
      const direction = computeDirection(intel, c);
      // Stage 2a: what is dangerous right now, component by component?
      const dangerComposition = composeDanger({
        intel,
        contract: c,
        lifetime: sim.perf,
        recent: recentPerf,
      });
      // Stage 2: belief discounted by danger and by evidence maturity.
      const setup = computeSetup({
        intel,
        contract: c,
        lifetime: sim.perf,
        recent: recentPerf,
        direction,
        danger: dangerComposition,
      });
      // Stage 3.5: has THIS market × contract × regime × entry condition
      // ever actually worked? Never pooled across any of those dimensions.
      const activeCondition =
        entryRec.best?.rule ?? (entryRec.activeNow ? entryRec.currentTrigger : IMMEDIATE_CONDITION);
      const combination = comboLearning.lookup({
        symbol: intel.symbol,
        contract: c.id,
        regime: intel.regime?.label ?? UNKNOWN_REGIME,
        entryCondition: activeCondition || IMMEDIATE_CONDITION,
      });
      // Stage 3: the CLEARED / WAIT / BLOCKED verdict.
      const entryClearance = assessEntryClearance({
        setup,
        danger: dangerComposition,
        combo: combination,
        triggerActive: entryRec.activeNow,
        // REFINEMENT 4 — thresholds resolved per contract family. The families
        // currently carry the existing global defaults, so behaviour is
        // unchanged; they exist so each family can be tuned independently.
        ...qualificationFor(c.id),
        // A brand-new combination may still be surfaced as an exploratory
        // candidate; it just cannot be reported as CLEARED evidence-backed.
        allowUntested: false,
      });
      // Stage 3.75: DYNAMIC ENTRY POINT — which observed digit should the bot
      // enter on for THIS market and THIS contract? Discovered, never hardcoded.
      const entryPoint = computeEntryPoint({
        intel,
        contract: c,
        digits: apexCore.getDeepDigits(intel.symbol),
        danger: dangerComposition,
        entry: entryRec,
        clearanceBlocked: clearance.state === "BLOCKED",
        // Additive, bounded, market/contract-isolated operator learning.
        operator: operatorLearning,
      });



      if (clearance.state === "BLOCKED") {
        rejected.push({
          symbol: intel.symbol,
          contract: c.label,
          reason: clearance.blockers.map((b) => b.text).join(" · "),
        });
      } else if (c.compositeEdge <= 0) {
        rejected.push({
          symbol: intel.symbol,
          contract: c.label,
          reason: `No composite edge (${c.compositeEdge.toFixed(1)}) — retained as an exploratory candidate only`,
        });
      }
      const agreement = engineAgreement(c);

      const preferred = PRIMARY_CONTRACTS.includes(c.id);
      // Historical analogue from this app's own observed memory.
      const analogue = c.analogue ?? lookupAnalogue(fingerprint(intel, c));
      const analogueBonus =
        analogue && analogue.n >= 30
          ? Math.max(-6, Math.min(6, (analogue.rate - c.theoretical) * 60))
          : 0;
      // Validated models can nudge the ranking; unvalidated ones cannot.
      const modelBonus =
        c.ensemble && c.ensemble.validated > 0
          ? Math.max(-5, Math.min(5, c.ensemble.signal * 5))
          : 0;
      const agreementBonus =
        agreement === "SUPPORT" ? 3 : agreement === "CONFLICT" ? -8 : 0;
      // Entry-condition discovery: which way of ENTERING has actually improved
      // contract-resolved expectancy on this market/contract?
      const entry = entryRec;
      // Multi-dimensional, confidence-adjusted adjustments. Authority scales
      // with evidence maturity, so a 3-trade 100% record cannot outrank a
      // mature one — and a new candidate is not deleted for being new.
      const clearancePenalty =
        clearance.state === "BLOCKED"
          ? -45
          : clearance.state === "UNSTABLE"
            ? -12
            : clearance.state === "CAUTION"
              ? -5
              : clearance.state === "INSUFFICIENT EVIDENCE"
                ? -8
                : 2;
      const confidenceAdjustment = Math.round(((evidence.confidence - 50) / 50) * 4 * 10) / 10;
      const recentDelta =
        recentPerf.n >= 10
          ? Math.max(-8, Math.min(6, (recentPerf.winRate - c.theoretical) * 60 * evidence.authority))
          : 0;
      const factors = [
        {
          label: "Statistical opportunity",
          points: c.opportunity,
          detail: `Composite edge ${c.compositeEdge.toFixed(1)} over ${c.n} ticks, phase ${c.phase}`,
        },
        {
          label: "Contract preference",
          points: preferred ? opts.preferenceWindow : 0,
          detail: preferred
            ? "Primary Sentinel contract (Under 7 / Over 2)"
            : "Secondary contract — no preference bonus",
        },
        {
          label: "Historical analogue",
          points: analogueBonus,
          detail:
            analogue && analogue.n >= 30
              ? `${(analogue.rate * 100).toFixed(1)}% over N=${analogue.n} matching past states`
              : "No sufficient analogue memory yet — no influence",
        },
        {
          label: "Learned model",
          points: modelBonus,
          detail: c.ensemble
            ? c.ensemble.validated > 0
              ? `${c.ensemble.validated} validated model(s), signal ${c.ensemble.signal.toFixed(2)}`
              : "Models present but not yet validated — no influence"
            : "No model output",
        },
        {
          label: "Simulator evidence",
          points: sim.delta,
          detail: sim.note,
        },
        {
          label: "Entry condition evidence",
          points: entry.rankingDelta,
          detail: entry.best
            ? `${entry.best.label} (${entry.best.state}) — ${entry.activeNow ? "trigger ACTIVE now" : "trigger not firing now"}. ${entry.best.note}`
            : entry.note,
        },
        {
          label: "Engine agreement",
          points: agreementBonus,
          detail: agreement,
        },
        {
          label: "Recent window (this market)",
          points: recentDelta,
          detail: recentPerf.n
            ? `Last ${Math.round(apexSimulator.getConfig().recentWindowMs / 60000)} min on ${intel.name}: ${recentPerf.n} qualifying entries, ${recentPerf.wins} wins, ${recentPerf.losses} losses, ${(recentPerf.winRate * 100).toFixed(1)}% win rate (authority ×${evidence.authority.toFixed(2)}).`
            : `No qualifying entries in the last ${Math.round(apexSimulator.getConfig().recentWindowMs / 60000)} minutes on this market — no recent influence.`,
        },
        {
          label: "Danger clearance",
          points: clearancePenalty,
          detail: clearance.summary,
        },
        {
          label: "Evidence confidence",
          points: confidenceAdjustment,
          detail: `${evidence.status} · confidence ${evidence.confidence}/100 · uncertainty ${evidence.uncertainty}/100. ${evidence.note}`,
        },
      ];

      // ── Stage: LOSING-DIGIT EXPOSURE ─────────────────────────────────
      const exposure = c.exposure ?? null;
      const exposurePenalty = exposure
        ? -Math.round(
            (exposure.losingDigitExposure > 45 ? (exposure.losingDigitExposure - 45) * 0.22 : 0) * 10,
          ) / 10
        : 0;
      factors.push({
        label: "Losing-digit exposure",
        points: exposurePenalty,
        detail: exposure
          ? exposure.summary
          : "Losing-digit exposure not computed for this candidate.",
      });

      // ── Stage: SPECIAL DIGIT RISK (0/1/8/9) ──────────────────────────
      const special = c.specialRisk ?? null;
      const specialPenalty = special
        ? -Math.round((special.exposureRisk > 50 ? (special.exposureRisk - 50) * 0.16 : 0) * 10) / 10
        : 0;
      factors.push({
        label: "Special digit risk (0/1/8/9)",
        points: specialPenalty,
        detail: special ? special.summary : "Special digit monitor unavailable.",
      });

      // ── Stage: FLUCTUATION / STABILITY OF THE EVIDENCE ───────────────
      const fluct = intel.fluctuation;
      const fluctPenalty = fluct
        ? -Math.round((fluct.score > 25 ? (fluct.score - 25) * 0.18 : -2) * 10) / 10
        : 0;
      factors.push({
        label: "Fluctuation (calm-market preference)",
        points: fluctPenalty,
        detail: fluct ? fluct.summary : "Fluctuation not yet measurable.",
      });

      // ── Stage: DIGIT PSYCHOLOGY (hypothesis, capped influence) ───────
      const psy = intel.psychology;
      const pattern = psy ? (c.side === "OVER" ? psy.over : psy.under) : null;
      const psyPoints = pattern
        ? Math.round(
            Math.max(-4, Math.min(4, ((pattern.score - 55) / 45) * 4 * (pattern.confidence / 100))) * 10,
          ) / 10
        : 0;
      factors.push({
        label: "Digit psychology configuration",
        points: psyPoints,
        detail: pattern
          ? `${pattern.side} pattern ${pattern.score}/100 (confidence ${pattern.confidence}/100). ${pattern.supporting.length} supporting, ${pattern.contradictions.length} contradicting observation(s).`
          : "Psychology engine has no reading for this market yet.",
      });

      // ── Stage: MARKET-SPECIFIC LEARNING (never inherited) ────────────
      const learned = marketProfiles.prior(intel.symbol, c.label, c.theoretical);
      factors.push({
        label: "Market-specific learning",
        points: learned.points,
        detail: learned.detail,
      });

      const invalidation = [
        `Danger rising above ${Math.min(100, Math.round(intel.danger + 12))} on this market`,
        `Losing-side pressure taking control on the ${c.label} losing digits`,
        "Sensitive digit flipping from green (winning) to red (losing) role",
        "Regime transition away from " + (intel.regime?.label ?? "the current regime"),
        entry.best
          ? `Entry condition "${entry.best.label}" ceasing to trigger, or its expectancy turning negative`
          : "No validated entry condition emerging for this contract",
        exposure && exposure.bursting.length
          ? `Losing digit(s) ${exposure.bursting.join(", ")} continuing to burst`
          : "A losing digit starting to burst (2+ prints in 10 ticks)",
        intel.fluctuation && intel.fluctuation.state !== "CALM"
          ? `Fluctuation rising above ${Math.min(100, intel.fluctuation.score + 15)}/100`
          : "Fluctuation rising — the leading contract flickering between candidates",
        c.phase === "MATURE"
          ? "Edge decaying as the mature phase completes"
          : "Composite edge falling to zero or below",
      ];

      // ── Stage 1/2/3 contributions, each fully attributed ─────────────
      // Stage 2 replaces nothing above: it adds a bounded, measured opinion
      // about the QUALITY of the setup that the raw statistics produced.
      const setupPoints = Math.round(((setup.score - 55) / 45) * 8 * 10) / 10;
      factors.push({
        label: "Stage 2 setup score",
        points: setupPoints,
        detail: setup.summary,
      });
      const comboPoints = combination.exact.rankingDelta;
      factors.push({
        label: "Combination learning (mkt × contract × regime × entry)",
        points: comboPoints,
        detail: combination.exact.note,
      });
      const verdictPoints =
        entryClearance.verdict === "CLEARED"
          ? 4
          : entryClearance.verdict === "BLOCKED"
            ? -20
            : -3;
      factors.push({
        label: "Stage 3 entry clearance",
        points: verdictPoints,
        detail: entryClearance.summary,
      });
      // Validated operator learning may nudge the market/contract ranking, but
      // it is bounded (±2.5) and never replaces an engine verdict.
      const operatorRankingPoints = operatorLearning.rankingAdjustment(intel.symbol, c.id);
      if (operatorRankingPoints !== 0) {
        factors.push({
          label: "Validated operator learning",
          points: operatorRankingPoints,
          detail: operatorLearning
            .forMarket(intel.symbol, c.id)
            .map((p) => p.summary)
            .join(" "),
        });
      }
      const entryPointPoints = entryPoint.rankingDelta;
      factors.push({
        label: "Dynamic entry point",
        points: entryPointPoints,
        detail: entryPoint.summary,
      });

      invalidation.push(
        entryClearance.verdict === "CLEARED"
          ? `Any Stage 3 requirement failing — currently all ${entryClearance.requirements.length} are met`
          : `Stage 3 requirement(s) still unmet: ${entryClearance.unmet.map((u) => u.label).join(", ")}`,
        combination.exact.n
          ? `Combination ${combination.exact.entryCondition} in regime ${combination.exact.regime} drifting below break-even (weighted expectancy ${combination.exact.weightedExpectancy.toFixed(3)})`
          : `This exact combination (regime ${combination.exact.regime} · entry ${combination.exact.entryCondition}) remaining UNTESTED`,
        entryPoint.preferred
          ? `Entry digit ${entryPoint.preferred.digit} losing its measured conditional support`
          : "No entry digit reaching validated support on this market × contract",
      );

      if (entryClearance.verdict === "BLOCKED" && clearance.state !== "BLOCKED") {
        rejected.push({
          symbol: intel.symbol,
          contract: c.label,
          reason: `STAGE 3 BLOCKED — ${entryClearance.blockers.map((b) => b.label).join(" · ")}`,
        });
      }

      const score =
        c.opportunity +
        (preferred ? opts.preferenceWindow : 0) +
        analogueBonus +
        modelBonus +
        sim.delta +
        entry.rankingDelta +
        agreementBonus +
        recentDelta +
        clearancePenalty +
        confidenceAdjustment +
        exposurePenalty +
        specialPenalty +
        fluctPenalty +
        psyPoints +
        learned.points +
        setupPoints +
        comboPoints +
        verdictPoints +
        entryPointPoints +
        operatorRankingPoints;

      ranked.push({
        rank: 0,
        symbol: intel.symbol,
        name: intel.name,
        contract: c,
        intel,
        score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10,
        preferred,
        simulator: sim.perf,
        simNote: sim.note,
        recent: recentPerf,
        entry,
        agreement,
        clearance,
        evidence,
        blocked: clearance.state === "BLOCKED" || entryClearance.verdict === "BLOCKED",
        factors,
        invalidation,
        direction,
        dangerComposition,
        setup,
        entryClearance,
        combination,
        entryPoint,
        // REFINEMENT 1/2 — filled in once relative edge is known (pass 4).
        signal: resolveSignalState({
          entryPoint,
          verdict: entryClearance.verdict,
          grade: setup.grade,
          relative: "LEVEL",
          blocked: clearance.state === "BLOCKED" || entryClearance.verdict === "BLOCKED",
        }),
        // Passes 2 and 3 fill these in once the whole field is known.
        relative: {
          key: `${intel.symbol}:${c.id}`,
          absoluteEdge: c.compositeEdge,
          riskAdjustedEdge: c.compositeEdge,
          relativeEdge: 0,
          relativeWithinMarket: 0,
          normalized: 0,
          fieldRank: 0,
          fieldSize: 0,
          label: "LEVEL",
          rankingDelta: 0,
          detail: "Relative edge not yet computed for this field.",
        },
        persistence: {
          key: `${intel.symbol}:${c.id}`,
          persistence: 0,
          currentRank: 0,
          previousRank: null,
          averageRank: 0,
          topThree: 0,
          scans: 0,
          edgeStability: 50,
          edgeSeries: [],
          edgeRange: 0,
          edgeStdDev: 0,
          rotation: "LOW",
          rotationChanges: 0,
          changeClass: "NEW",
          changeReasons: [],
          rankingDelta: 0,
          summary: "Persistence not yet computed.",
        },
      });


    }
  }

  // ══ PASS 2 — RELATIVE EDGE ═══════════════════════════════════════════
  // Every candidate is now measured against the rest of the field. Danger is
  // priced into the comparison instead of vetoing it, so the calmest market is
  // not automatically preferred over a materially stronger edge.
  const relInputs: RelativeEdgeInput[] = ranked.map((r) => ({
    key: `${r.symbol}:${r.contract.id}`,
    symbol: r.symbol,
    contract: r.contract.label,
    absoluteEdge: r.contract.compositeEdge,
    danger: r.contract.danger,
  }));
  const relatives = computeRelativeEdges(relInputs);
  for (const r of ranked) {
    const rel = relatives.get(`${r.symbol}:${r.contract.id}`);
    if (!rel) continue;
    r.relative = rel;
    r.factors.push({
      label: "Relative edge vs alternatives",
      points: rel.rankingDelta,
      detail: rel.detail,
    });
    r.score = Math.round(Math.max(0, Math.min(100, r.score + rel.rankingDelta)) * 10) / 10;
    r.invalidation.push(
      rel.relativeEdge > 0
        ? `Relative edge (${rel.relativeEdge >= 0 ? "+" : ""}${rel.relativeEdge.toFixed(2)}, ${rel.label}) collapsing as another candidate improves`
        : `This candidate remaining behind the field leader by ${Math.abs(rel.relativeEdge).toFixed(2)} risk-adjusted edge`,
    );
  }

  // Provisional ranking — required before persistence can be assessed, since
  // persistence is measured on RANK across scans.
  ranked.sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score);
  ranked.forEach((r, i) => (r.rank = i + 1));

  // ══ PASS 3 — SIGNAL PERSISTENCE / EDGE STABILITY ══════════════════════
  const snapshot: ScanMemoryEntry[] = [];
  for (const r of ranked) {
    const entryRow: ScanMemoryEntry = {
      key: `${r.symbol}:${r.contract.id}`,
      symbol: r.symbol,
      name: r.name,
      contract: r.contract.id,
      contractLabel: r.contract.label,
      rank: r.rank,
      score: r.score,
      absoluteEdge: r.contract.compositeEdge,
      relativeEdge: r.relative.relativeEdge,
      danger: r.contract.danger,
      agreement: r.agreement,
      evidenceConfidence: r.evidence.confidence,
      regime: r.intel.regime?.label ?? UNKNOWN_REGIME,
      verdict: r.entryClearance.verdict,
      entryDigit: r.entryPoint.preferred?.digit ?? null,
      entryCondition: r.entry?.best?.rule ?? null,
    };
    snapshot.push(entryRow);
    const assessment = scanMemory.assess(entryRow);
    r.persistence = assessment;
    r.factors.push({
      label: "Signal persistence & edge stability",
      points: assessment.rankingDelta,
      detail: assessment.summary,
    });
    r.score = Math.round(Math.max(0, Math.min(100, r.score + assessment.rankingDelta)) * 10) / 10;
  }

  // Final ordering. Blocked candidates are ordered last but never deleted: the
  // operator can always see WHY an otherwise attractive setup is unavailable.
  ranked.sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score);
  ranked.forEach((r, i) => (r.rank = i + 1));

  // ══ PASS 4 — UNIFIED SIGNAL STATE (translation only) ══════════════════
  // Nothing is recomputed here: the existing engine states are normalised into
  // the single STRONG / VALID / WATCH / EXPLORATORY / BLOCKED vocabulary, plus
  // the explicit "VALID — WAIT FOR ENTRY" sub-state.
  for (const r of ranked) {
    r.signal = resolveSignalState({
      entryPoint: r.entryPoint,
      verdict: r.entryClearance.verdict,
      grade: r.setup.grade,
      relative: r.relative.label,
      blocked: r.blocked,
    });
  }

  if (recordHistory) {
    // Ranks may have shifted after the persistence adjustment — the history
    // stores the FINAL ranks so the next scan compares like with like.
    scanMemory.record(
      snapshot.map((s) => ({
        ...s,
        rank: ranked.find((r) => `${r.symbol}:${r.contract.id}` === s.key)?.rank ?? s.rank,
        score: ranked.find((r) => `${r.symbol}:${r.contract.id}` === s.key)?.score ?? s.score,
      })),
    );
  }

  return { ranked, rejected };
}


export function scanNow(
  intels: MarketIntel[],
  opts: ScanOptions = DEFAULT_SCAN_OPTIONS,
): ScanResult {
  const online = intels.filter((i) => i.dataState === "OK");
  const { ranked, rejected } = rankOpportunities(intels, opts, true);
  const gd = globalDanger(intels);
  // Multiple simultaneous opportunities are allowed — the operator is not
  // restricted to a single market. Blocked candidates are excluded from the
  // surfaced set but remain in `ranked` with their reasons intact.
  const top = ranked.filter((r) => !r.blocked).slice(0, 5);

  let verdict: ScanResult["verdict"];
  let message: string;
  if (!online.length) {
    verdict = "DATA_UNAVAILABLE";
    message = "DATA UNAVAILABLE — no market is currently streaming enough ticks to analyse.";
  } else if (!top.length) {
    verdict = "NONE";
    message = `NO CLEARED OPPORTUNITY. ${ranked.filter((r) => r.blocked).length} candidate(s) exist but are blocked by danger clearance or a Stage 3 blocker.`;
  } else if (
    top[0].score >= opts.opportunityThreshold &&
    top[0].entryClearance.verdict === "CLEARED" &&
    (top[0].intel.fluctuation?.state ?? "CALM") !== "CHAOTIC" &&
    (top[0].contract.exposure?.state ?? "LOW") !== "SEVERE" &&
    top[0].agreement !== "STRONG CONFLICT"
  ) {
    verdict = "OPPORTUNITY";
    message = `${top[0].contract.label} on ${top[0].name} — direction ${top[0].direction.score.toFixed(0)} (${top[0].direction.label}), setup ${top[0].setup.score.toFixed(0)} (${top[0].setup.grade}), relative edge ${top[0].relative.relativeEdge >= 0 ? "+" : ""}${top[0].relative.relativeEdge.toFixed(2)} (${top[0].relative.label}), persistence ${top[0].persistence.persistence}/100, Stage 3 CLEARED. ${top[0].entryPoint.preferred ? `Entry on digit ${top[0].entryPoint.preferred.digit} (${top[0].entryPoint.status}) — ${top[0].entryPoint.window.label}.` : "No validated entry digit yet."}`;
  } else {
    verdict = "MODERATE";
    message = `NO HIGH-QUALITY OPPORTUNITY. Best available candidate ${top[0].contract.label} on ${top[0].name} is ${top[0].entryClearance.verdict} at setup ${top[0].setup.score.toFixed(0)}/100 (${top[0].setup.grade}) — ${top[0].entryClearance.summary}`;

  }

  return {
    scannedAt: Date.now(),
    marketsOnline: online.length,
    marketsTotal: intels.length,
    evaluated: ranked.length,
    globalDanger: gd,
    globalDangerLabel: gd < 35 ? "CALM" : gd < 65 ? "ELEVATED" : "HOSTILE",
    top,
    rejected: rejected.slice(0, 40),
    verdict,
    message,
  };
}


/**
 * WHY NOT THE RUNNER-UP — a like-for-like comparison of the two best
 * candidates using only measured values. No narrative is invented: each line
 * is a real gap between two engine outputs.
 */
export function whyNotRunnerUp(
  top: RankedOpportunity,
  runner: RankedOpportunity,
): string[] {
  const out: string[] = [];
  const a = top.contract;
  const b = runner.contract;
  const gap = (label: string, x: number, y: number, unit = "", invert = false) => {
    const diff = x - y;
    if (Math.abs(diff) < 2) return;
    const better = invert ? diff < 0 : diff > 0;
    if (!better) return;
    out.push(
      `${label}: ${top.contract.label} ${x.toFixed(0)}${unit} vs ${runner.contract.label} ${y.toFixed(0)}${unit}.`,
    );
  };
  gap("Opportunity", top.score, runner.score);
  // ── Why #1 beat #2 on the relative / persistence dimensions ───────────
  out.push(
    `Relative edge: ${top.contract.label} ${top.relative.relativeEdge >= 0 ? "+" : ""}${top.relative.relativeEdge.toFixed(2)} (${top.relative.label}, risk-adjusted ${top.relative.riskAdjustedEdge.toFixed(2)}) vs ${runner.contract.label} ${runner.relative.relativeEdge >= 0 ? "+" : ""}${runner.relative.relativeEdge.toFixed(2)} (${runner.relative.label}, risk-adjusted ${runner.relative.riskAdjustedEdge.toFixed(2)}).`,
  );
  out.push(
    `Absolute edge: ${top.contract.compositeEdge.toFixed(1)} vs ${runner.contract.compositeEdge.toFixed(1)}.`,
  );
  out.push(
    `Persistence: ${top.persistence.persistence}/100 (top-3 in ${top.persistence.topThree}/${top.persistence.scans} scans, avg rank ${top.persistence.averageRank}) vs ${runner.persistence.persistence}/100 (${runner.persistence.topThree}/${runner.persistence.scans}, avg rank ${runner.persistence.averageRank}).`,
  );
  out.push(
    `Edge stability across scans: ${top.persistence.edgeStability}/100 vs ${runner.persistence.edgeStability}/100.`,
  );
  out.push(
    `Entry point: ${top.contract.label} — ${top.entryPoint.preferred ? `digit ${top.entryPoint.preferred.digit} (${top.entryPoint.status}, confidence ${top.entryPoint.confidence}/100)` : "no validated entry digit"}; ${runner.contract.label} — ${runner.entryPoint.preferred ? `digit ${runner.entryPoint.preferred.digit} (${runner.entryPoint.status}, confidence ${runner.entryPoint.confidence}/100)` : "no validated entry digit"}.`,
  );
  gap("Quality", a.quality, b.quality);
  gap("Stability", a.stability, b.stability);
  gap("Freshness", a.freshness, b.freshness);
  gap("Danger (lower is better)", a.danger, b.danger, "", true);
  gap("Contradiction (lower is better)", a.contradiction, b.contradiction, "", true);
  if (a.threat && b.threat && Math.abs(a.threat.groupThreat - b.threat.groupThreat) >= 4) {
    out.push(
      a.threat.groupThreat < b.threat.groupThreat
        ? `Losing-side threat is lower: ${a.threat.groupThreat.toFixed(0)} (${a.threat.state}) vs ${b.threat.groupThreat.toFixed(0)} (${b.threat.state}).`
        : `Runner-up has the calmer losing side (${b.threat.groupThreat.toFixed(0)} vs ${a.threat.groupThreat.toFixed(0)}) but loses on other measures.`,
    );
  }
  if (top.simulator && runner.simulator && (top.simulator.n >= 25 || runner.simulator.n >= 25)) {
    out.push(
      `Simulator: ${top.contract.label} ${top.simulator.n ? `${(top.simulator.winRate * 100).toFixed(1)}% (N=${top.simulator.n})` : "no sample"} vs ${runner.contract.label} ${runner.simulator.n ? `${(runner.simulator.winRate * 100).toFixed(1)}% (N=${runner.simulator.n})` : "no sample"}.`,
    );
  }
  if (top.entry?.best || runner.entry?.best) {
    const fmt = (r: RankedOpportunity) =>
      r.entry?.best
        ? `${r.entry.best.label} (${r.entry.best.state}, expectancy ${(r.entry.best.expectancy * 100).toFixed(1)}% over N=${r.entry.best.n}${r.entry.activeNow ? ", trigger active" : ", trigger not firing"})`
        : "no validated entry condition";
    out.push(`Entry condition: ${top.contract.label} — ${fmt(top)}; ${runner.contract.label} — ${fmt(runner)}.`);
  }
  if (top.agreement !== runner.agreement) {
    out.push(`Engine agreement: ${top.agreement} vs ${runner.agreement}.`);
  }
  out.push(
    `Evidence: ${top.evidence.status} at confidence ${top.evidence.confidence}/100 vs ${runner.evidence.status} at ${runner.evidence.confidence}/100.`,
  );
  if (!out.length) out.push("The two candidates are statistically close — the ranking gap is not material.");
  return out.slice(0, 12);
}


/**
 * WHY THIS MARKET RANKS WHERE IT DOES — a plain reading of the measured
 * dimensions behind a candidate's position. Every line is a real measurement:
 * supports, neutrals and cautions are separated instead of blended.
 */
export function whyRanksHere(r: RankedOpportunity): {
  headline: string;
  supports: string[];
  neutral: string[];
  cautions: string[];
} {
  const supports: string[] = [];
  const neutral: string[] = [];
  const cautions: string[] = [];

  const rel = r.relative;
  if (rel.relativeEdge >= 1.5)
    supports.push(
      `${rel.label} relative edge vs alternatives (${rel.relativeEdge >= 0 ? "+" : ""}${rel.relativeEdge.toFixed(2)}, field position ${rel.fieldRank}/${rel.fieldSize})`,
    );
  else if (rel.relativeEdge > -0.4)
    neutral.push(`Relative edge is level with the field (${rel.relativeEdge.toFixed(2)})`);
  else
    cautions.push(
      `Behind the field leader by ${Math.abs(rel.relativeEdge).toFixed(2)} risk-adjusted edge`,
    );

  if (r.contract.compositeEdge > 0)
    supports.push(`Absolute composite edge ${r.contract.compositeEdge.toFixed(1)} over ${r.contract.n} ticks`);
  else cautions.push(`No positive absolute edge (${r.contract.compositeEdge.toFixed(1)})`);

  const p = r.persistence;
  if (p.scans < 2) neutral.push("No scan history yet — persistence and stability are not yet measurable");
  else {
    if (p.persistence >= 65)
      supports.push(`Top-3 in ${p.topThree}/${p.scans} recent scans (persistence ${p.persistence}/100)`);
    else if (p.persistence >= 40) neutral.push(`Persistence ${p.persistence}/100 across ${p.scans} scans`);
    else cautions.push(`Weak persistence ${p.persistence}/100 — average rank ${p.averageRank}`);
    if (p.edgeStability >= 70) supports.push(`Edge held a narrow range across scans (stability ${p.edgeStability}/100)`);
    else if (p.edgeStability < 45)
      cautions.push(`Edge swung across scans (stability ${p.edgeStability}/100, σ ${p.edgeStdDev})`);
  }
  if (p.rotation === "HIGH") cautions.push("Market rotation is HIGH — the field leader keeps changing");

  const d = r.dangerComposition;
  if (d.total < 45) supports.push(`Danger remains acceptable (${d.total}/100, ${d.level})`);
  else if (d.total < 65) neutral.push(`Danger is elevated but priced in (${d.total}/100, ${d.level})`);
  else cautions.push(`Danger is high (${d.total}/100, ${d.level})`);

  if (r.agreement === "SUPPORT") supports.push("Engines agree on the direction");
  else if (r.agreement === "NEUTRAL") neutral.push("Engine agreement is neutral");
  else cautions.push(`Engine agreement is ${r.agreement}`);

  if (r.evidence.confidence >= 60)
    supports.push(`Evidence ${r.evidence.status} at confidence ${r.evidence.confidence}/100`);
  else cautions.push(`Evidence quality limited — ${r.evidence.status} at ${r.evidence.confidence}/100`);

  if (r.recent && r.recent.n >= 10)
    supports.push(
      `Recent window on this market: ${(r.recent.winRate * 100).toFixed(1)}% over N=${r.recent.n}`,
    );
  else neutral.push("Recency: no qualifying entries in the recent window yet");

  if (r.simulator && r.simulator.n < 25)
    cautions.push(`Simulator sample remains limited (N=${r.simulator.n})`);

  if (r.entryPoint.status === "ENTER NOW" || r.entryPoint.status === "ARMED")
    supports.push(
      `Entry point measured: digit ${r.entryPoint.preferred?.digit} at confidence ${r.entryPoint.confidence}/100`,
    );
  else if (r.entryPoint.status === "UNVALIDATED")
    neutral.push("Entry point not yet validated by sufficient conditional evidence");
  else cautions.push("Entry point INVALIDATED by current conditions");

  return {
    headline: `WHY THIS MARKET RANKS #${r.rank} — ${r.contract.label} on ${r.name} at score ${r.score.toFixed(1)}/100`,
    supports,
    neutral,
    cautions,
  };
}
