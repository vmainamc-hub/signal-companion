// APEX SENTINEL — PROACTIVE HIGH-QUALITY OPPORTUNITY ALERT LAYER.
//
// This module is ADDITIVE. It computes no new edge, no new score and no new
// entry digit. It only WATCHES the outputs the existing engines already
// produce (ranking score, unified signal state, clearance, relative edge,
// persistence, entry-point report) and decides when a qualifying opportunity
// deserves the operator's attention.
//
// Hard rules honoured here:
//   • It never overrides, filters or re-ranks the scoring engine.
//   • It never fabricates an entry digit or a validity window — both come from
//     the Entry-Point Engine verbatim.
//   • It does not require perfect agreement between engines. SUPPORT, NEUTRAL
//     and MODERATE-quality evidence all qualify; only a genuine hard conflict
//     or hard invalidation disqualifies.
//   • Normal updates are silent. Only a NEW episode or a MATERIAL CHANGE may
//     alert again, so the operator is never spammed tick by tick.
//   • An alert is an observation, never a trade outcome. Nothing here trains
//     Sentinel; only confirmed trades / operator feedback do.
import type { RankedOpportunity } from "../apex/types";

// ── Configuration ────────────────────────────────────────────────────────
export interface AlertConfig {
  enabled: boolean;
  /** Minimum ranking score (opportunity score) to qualify. */
  minScore: number;
  /** Minimum entry-point confidence to qualify. */
  minConfidence: number;
  /** Minimum acceptable persistence (not "prolonged", just acceptable). */
  minPersistence: number;
  /** Minimum acceptable edge stability. */
  minStability: number;
  /** Require a validated entry digit (ENTER NOW / ARMED). */
  requireEntryDigit: boolean;
  /** Reject candidates whose signal state is BLOCKED. */
  rejectBlocked: boolean;
  /** Sound on alert. */
  sound: boolean;
  /** Browser notification on alert. */
  notifications: boolean;
  /** Minimum gap between two alerts for the SAME opportunity, ms. */
  cooldownMs: number;
  /** Score improvement, in points, that counts as a material change. */
  materialScoreDelta: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  minScore: 70,
  minConfidence: 55,
  minPersistence: 35,
  minStability: 35,
  requireEntryDigit: true,
  rejectBlocked: true,
  sound: true,
  notifications: true,
  cooldownMs: 45_000,
  materialScoreDelta: 6,
};

export const ALERT_CONFIG_KEY = "apex.alerts.config.v2";
export const ALERT_STATE_KEY = "apex.alerts.history.v2";

// ── Qualification ────────────────────────────────────────────────────────
export interface AlertSnapshot {
  key: string;
  symbol: string;
  name: string;
  contract: string;
  contractLabel: string;
  score: number;
  confidence: number;
  state: string;
  stateLabel: string;
  entryDigit: number | null;
  entryStatus: string;
  /** Entry-Point Engine's own validity window — never invented here. */
  windowLabel: string;
  windowBasis: string;
  entryChangeState: string;
  entryMargin: number;
  relativeEdge: string;
  persistence: number;
  stability: number;
  agreement: string;
  clearance: string;
  danger: number;
  edgePct: number;
  reasons: string[];
  cautions: string[];
}

export interface Qualification {
  ok: boolean;
  snapshot: AlertSnapshot;
  failures: string[];
}

export function opportunityKey(o: RankedOpportunity): string {
  return `${o.symbol}|${o.contract.id}`;
}

/** A hard conflict/invalidation — the ONLY agreement-based disqualifier. */
function hardConflict(o: RankedOpportunity): string | null {
  if (o.agreement === "STRONG CONFLICT") return "Hard engine conflict (STRONG CONFLICT)";
  if (o.entryPoint?.status === "INVALIDATED") return "Entry-Point Engine reports the entry INVALIDATED";
  if (o.entryClearance?.verdict === "BLOCKED") return "Entry clearance verdict is BLOCKED";
  return null;
}

export function qualify(o: RankedOpportunity, cfg: AlertConfig): Qualification {
  const ep = o.entryPoint;
  const entryValidated = ep?.status === "ENTER NOW" || ep?.status === "ARMED";
  const entryDigit = entryValidated ? (ep?.preferred?.digit ?? null) : null;
  const confidence = Math.round(ep?.confidence ?? 0);
  const score = Math.round(o.score);
  const persistence = Math.round(o.persistence?.persistence ?? 0);
  const stability = Math.round(o.contract?.stability ?? 0);
  const relativeEdge = o.relative?.label ?? "—";
  const hasRelative = !!o.relative?.label;
  const agreement = o.agreement ?? "NEUTRAL";

  const failures: string[] = [];
  if (score < cfg.minScore) failures.push(`Opportunity ${score} below threshold ${cfg.minScore}`);
  if (cfg.requireEntryDigit && entryDigit === null)
    failures.push(`No qualified entry digit (${ep?.status ?? "UNVALIDATED"})`);
  if (entryDigit !== null && confidence < cfg.minConfidence)
    failures.push(`Entry confidence ${confidence} below ${cfg.minConfidence}`);
  if (cfg.rejectBlocked && (o.blocked || o.signal?.state === "BLOCKED"))
    failures.push("Signal is BLOCKED by the safety layer");
  if (persistence < cfg.minPersistence)
    failures.push(`Persistence ${persistence} below ${cfg.minPersistence}`);
  if (stability < cfg.minStability)
    failures.push(`Stability ${stability} below ${cfg.minStability}`);
  const hard = hardConflict(o);
  if (hard) failures.push(hard);

  const reasons: string[] = [`Opportunity crossed ${cfg.minScore} — now ${score}/100`];
  if (entryDigit !== null)
    reasons.push(`Entry digit ${entryDigit} validated — ${ep.status}, confidence ${confidence}/100`);
  if (hasRelative) reasons.push(`Relative edge ${relativeEdge} in the current field`);
  reasons.push(`Signal persistence ${persistence}/100 · edge stability ${stability}/100`);
  if (!hard) reasons.push("No hard invalidation or hard engine conflict");
  if (ep?.window?.label) reasons.push(`Entry remains within its validity window (${ep.window.label})`);

  const cautions: string[] = [];
  if (agreement !== "SUPPORT") cautions.push(`Engine agreement is ${agreement.toLowerCase()} — supporting evidence is not unanimous.`);
  if (Math.round(o.contract?.danger ?? 0) >= 50) cautions.push("Danger is elevated; size and timing matter.");
  if ((ep?.entryMargin ?? 0) < 6) cautions.push("The preferred entry digit only narrowly leads its runner-up.");
  if (persistence < 55) cautions.push("Persistence is short-lived; the edge may not hold.");
  cautions.push("This is an observation, not a guarantee of any outcome.");

  return {
    ok: failures.length === 0,
    failures,
    snapshot: {
      key: opportunityKey(o),
      symbol: o.symbol,
      name: o.name,
      contract: o.contract.id,
      contractLabel: o.contract.label,
      score,
      confidence,
      state: o.signal?.state ?? "UNKNOWN",
      stateLabel: o.signal?.label ?? "UNKNOWN",
      entryDigit,
      entryStatus: ep?.status ?? "UNVALIDATED",
      windowLabel: ep?.window?.label ?? "Validity window unavailable",
      windowBasis: ep?.window?.basis ?? "—",
      entryChangeState: ep?.changeState ?? "HELD",
      entryMargin: Math.round(ep?.entryMargin ?? 0),
      relativeEdge,
      persistence,
      stability,
      agreement,
      clearance: o.entryClearance?.verdict ?? "—",
      danger: Math.round(o.contract?.danger ?? 0),
      edgePct: Number(((o.contract?.edge ?? 0) * 100).toFixed(2)),
      reasons,
      cautions,
    },
  };
}

// ── Episodes and history ─────────────────────────────────────────────────
export type AlertKind = "NEW" | "MATERIAL CHANGE" | "RE-ARM" | "SUPERIOR MARKET";

export interface AlertEvent {
  id: string;
  ts: number;
  kind: AlertKind;
  detail: string;
  snapshot: AlertSnapshot;
}

export interface AlertEpisode {
  key: string;
  openedAt: number;
  lastSeenAt: number;
  lastAlertAt: number;
  alerts: number;
  peakScore: number;
  entryDigit: number | null;
  state: string;
  status: "ACTIVE" | "EXPIRED" | "CLOSED";
  closedAt?: number;
  closeReason?: string;
  snapshot: AlertSnapshot;
}

export interface AlertState {
  /** Only ONE episode is actionable at a time (existing ranking decides which). */
  episode: AlertEpisode | null;
  history: AlertEvent[];
}

export const EMPTY_ALERT_STATE: AlertState = { episode: null, history: [] };

export const MAX_HISTORY = 60;
/** An opportunity that stops qualifying for longer than this closes its episode. */
export const EPISODE_GRACE_MS = 20_000;

function eventId(key: string, ts: number): string {
  return `${key}@${ts}`;
}

/**
 * Material change WITHIN the same market × contract episode. Small score
 * wobble and a one-tick entry-digit reshuffle deliberately do NOT qualify.
 */
export function materialChange(
  ep: AlertEpisode,
  next: AlertSnapshot,
  cfg: AlertConfig,
): string | null {
  if (
    ep.entryDigit !== next.entryDigit &&
    (next.entryChangeState === "MATERIAL CHANGE" || next.entryChangeState === "NEW")
  )
    return `Entry digit materially changed ${ep.entryDigit ?? "—"} → ${next.entryDigit ?? "—"}`;
  if (ep.state !== next.state && next.state === "STRONG")
    return `Signal upgraded ${ep.state} → STRONG`;
  if (next.score - ep.peakScore >= cfg.materialScoreDelta)
    return `Opportunity improved ${ep.peakScore} → ${next.score}`;
  if (
    ep.snapshot.relativeEdge !== next.relativeEdge &&
    next.relativeEdge === "STRONG"
  )
    return `Relative edge strengthened ${ep.snapshot.relativeEdge} → STRONG`;
  if (next.persistence - ep.snapshot.persistence >= 20)
    return `Persistence strengthened ${ep.snapshot.persistence} → ${next.persistence}`;
  return null;
}

/**
 * Pure reducer: given the previous alert state and the CURRENT ranked field,
 * return the next state plus any alert that should fire now. At most ONE alert
 * per pass — several qualifying markets never produce several sounds.
 */
export function reduceAlerts(
  prev: AlertState,
  ranked: RankedOpportunity[],
  cfg: AlertConfig,
  now: number,
): { state: AlertState; fired: AlertEvent[] } {
  if (!cfg.enabled) return { state: prev, fired: [] };

  // The existing ranking decides the field order; we only read it.
  const qualifying = ranked
    .map((o) => qualify(o, cfg))
    .filter((q) => q.ok)
    .map((q) => q.snapshot)
    .sort((a, b) => b.score - a.score);

  const fired: AlertEvent[] = [];
  const prevEpisode = prev.episode;
  let episode = prevEpisode;

  const push = (kind: AlertKind, detail: string, snap: AlertSnapshot) => {
    const ev: AlertEvent = { id: eventId(snap.key, now), ts: now, kind, detail, snapshot: snap };
    fired.push(ev);
    episode = {
      key: snap.key,
      openedAt: kind === "MATERIAL CHANGE" && episode ? episode.openedAt : now,
      lastSeenAt: now,
      lastAlertAt: now,
      alerts: kind === "MATERIAL CHANGE" && episode ? episode.alerts + 1 : 1,
      peakScore: kind === "MATERIAL CHANGE" && episode ? Math.max(episode.peakScore, snap.score) : snap.score,
      entryDigit: snap.entryDigit,
      state: snap.state,
      status: "ACTIVE",
      snapshot: snap,
    };
  };

  const best = qualifying[0] ?? null;
  const sameKeySnap = episode && episode.status === "ACTIVE"
    ? (qualifying.find((s) => s.key === episode!.key) ?? null)
    : null;

  if (!best) {
    // Nothing qualifies. Close the episode after the grace period.
    if (episode && episode.status === "ACTIVE" && now - episode.lastSeenAt >= EPISODE_GRACE_MS) {
      episode = {
        ...episode,
        status: episode.snapshot.entryStatus === "ENTER NOW" || episode.snapshot.entryStatus === "ARMED"
          ? "CLOSED"
          : "EXPIRED",
        closedAt: now,
        closeReason: "Opportunity fell below the quality bar or its entry window expired",
      };
    }
    return { state: { episode, history: prev.history }, fired };
  }

  if (!episode || episode.status !== "ACTIVE") {
    push(episode ? "RE-ARM" : "NEW",
      episode
        ? "Opportunity re-qualified after the previous episode closed"
        : "New high-quality opportunity qualified",
      best);
  } else if (sameKeySnap) {
    // Same opportunity episode — silent unless materially different.
    const change = materialChange(episode, sameKeySnap, cfg);
    const cooled = now - episode.lastAlertAt >= cfg.cooldownMs;
    if (change && cooled) {
      push("MATERIAL CHANGE", change, sameKeySnap);
    } else {
      episode = {
        ...episode,
        lastSeenAt: now,
        peakScore: Math.max(episode.peakScore, sameKeySnap.score),
        entryDigit: sameKeySnap.entryDigit,
        state: sameKeySnap.state,
        snapshot: sameKeySnap,
      };
    }
  } else {
    // Current episode no longer qualifies, but another market does.
    const cooled = now - episode.lastAlertAt >= cfg.cooldownMs;
    const superior = best.score - episode.snapshot.score >= cfg.materialScoreDelta;
    if (superior && cooled) {
      push("SUPERIOR MARKET",
        `${best.symbol} · ${best.contractLabel} is materially superior (${best.score} vs ${episode.snapshot.score})`,
        best);
    } else if (now - episode.lastSeenAt >= EPISODE_GRACE_MS) {
      episode = {
        ...episode,
        status: "CLOSED",
        closedAt: now,
        closeReason: "Opportunity no longer meets the quality bar",
      };
    }
  }

  const history = fired.length
    ? [...fired, ...prev.history].slice(0, MAX_HISTORY)
    : prev.history;

  return { state: { episode, history }, fired };
}

/** True when the alerted entry is no longer actionable per the Entry-Point Engine. */
export function isExpired(ep: AlertEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === "EXPIRED" || ep.snapshot.entryStatus === "INVALIDATED";
}

// ── Persistence (local only; nothing here belongs to the engines) ────────
export function loadAlertConfig(): AlertConfig {
  if (typeof window === "undefined") return DEFAULT_ALERT_CONFIG;
  try {
    const raw = window.localStorage.getItem(ALERT_CONFIG_KEY);
    if (!raw) return DEFAULT_ALERT_CONFIG;
    return { ...DEFAULT_ALERT_CONFIG, ...(JSON.parse(raw) as Partial<AlertConfig>) };
  } catch {
    return DEFAULT_ALERT_CONFIG;
  }
}

export function saveAlertConfig(cfg: AlertConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore quota */
  }
}

export function loadAlertHistory(): AlertEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ALERT_STATE_KEY);
    return raw ? (JSON.parse(raw) as AlertEvent[]) : [];
  } catch {
    return [];
  }
}

export function saveAlertHistory(history: AlertEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERT_STATE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore quota */
  }
}
