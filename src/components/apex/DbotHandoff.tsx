// APEX SENTINEL — EXECUTION HANDOFF.
//
// The operator does not trade from this app. They load a bot on DBot, then WAIT
// for the measured entry digit to print before letting the bot fire. This card
// is that handoff, and nothing else: MARKET → CONTRACT → ENTRY DIGIT →
// CONFIDENCE → VALIDITY WINDOW, plus what would invalidate the wait.
//
// Every value shown here comes from the Sentinel engines already computed for
// this candidate. Nothing is re-derived, guessed, or hardcoded per contract.
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { RankedOpportunity } from "@/lib/apex/types";
import { Button } from "@/components/ui/button";
import TradeFeedback from "@/components/apex/TradeFeedback";

function Field({
  label,
  value,
  sub,
  tone,
  big,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "warn" | "neon";
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-display font-bold ${big ? "text-4xl leading-none" : "text-lg"}`}
        style={{ color: tone ? `var(--${tone})` : undefined }}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function DbotHandoff({ item }: { item: RankedOpportunity }) {
  const [copied, setCopied] = useState(false);
  const ep = item.entryPoint;
  const c = item.contract;
  const d = ep.preferred;

  const signal = item.signal;
  const ready = (ep.status === "ENTER NOW" || ep.status === "ARMED") && !!d;
  // REFINEMENT 2 — a valid setup without a validated digit is never presented
  // as BLOCKED or as "no opportunity", and never receives a fabricated digit.
  const waitForEntry = signal?.waitForEntry ?? !d;
  const entryDigitText = d && !waitForEntry ? String(d.digit) : "WAIT";
  const statusLabel = signal?.label ?? ep.status;
  const statusTone = ready
    ? "bull"
    : signal?.state === "BLOCKED" || ep.status === "INVALIDATED"
      ? "bear"
      : "warn";
  const marginText = `${ep.entryMargin >= 0 ? "+" : ""}${ep.entryMargin}`;

  const plan = [
    `APEX SENTINEL — EXECUTION HANDOFF (analysis only)`,
    `MARKET        : ${item.symbol} (${item.name})`,
    `CONTRACT      : ${c.label} — ${c.side} ${c.barrier}, winners ${c.winners.join("/")}`,
    `ENTRY DIGIT   : ${entryDigitText}`,
    `ENTRY STATUS  : ${statusLabel}`,
    d && !waitForEntry
      ? `ENTRY MARGIN  : ${marginText} (score ${d.score.toFixed(0)}${ep.runnerUpDigit !== null ? ` vs runner-up digit ${ep.runnerUpDigit} at ${ep.runnerUpScore?.toFixed(0)}` : ""})`
      : "",
    d
      ? `ENTRY BASIS   : P(win | digit ${d.digit} showing) ${(d.pWin * 100).toFixed(1)}% (95% LB ${(d.pWinLower * 100).toFixed(1)}%) vs theoretical ${(c.theoretical * 100).toFixed(1)}% over N=${d.n}`
      : `ENTRY BASIS   : no digit has enough conditional evidence yet`,
    `STATUS        : ${ep.status}`,
    `CONFIDENCE    : ${ep.confidence}/100 (setup ${item.setup.grade} ${item.setup.score.toFixed(0)}/100, danger ${c.danger.toFixed(0)}/100)`,
    `VALIDITY      : ${ep.window.label} — ${ep.window.basis}`,
    d ? `TYPICAL WAIT  : ~${d.expectedWaitTicks} ticks between appearances (last seen ${d.sinceSeen} ticks ago)` : "",
    `RESOLUTION    : contract resolves on digits ${ep.resolutionDigits.join("/")} — this is NOT the entry digit`,
    `INVALIDATES IF: ${ep.invalidation.join(" | ") || "—"}`,
    `HOW TO USE    : load your bot on DBot for ${item.symbol} / ${c.label}, keep it idle, and start it only when digit ${d ? d.digit : "?"} prints. Re-scan when the window expires.`,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the plan is still fully readable on screen.
    }
  };

  return (
    <section
      className="mt-5 rounded-xl border p-4"
      style={{
        borderColor: `var(--${statusTone})`,
        background: "color-mix(in oklch, var(--background) 88%, var(--neon))",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-bold tracking-[0.28em] text-[var(--neon)]">
          EXECUTION HANDOFF · DBOT
        </p>
        <div className="flex items-center gap-2">
          <span
            className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ borderColor: `var(--${statusTone})`, color: `var(--${statusTone})` }}
          >
            {ep.status}
          </span>
          <Button size="sm" variant="outline" onClick={copy} className="h-7 gap-1.5 text-[11px]">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy plan"}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Market" value={item.symbol} sub={item.name} />
        <Field
          label="Contract"
          value={c.label}
          sub={`${c.side} ${c.barrier} · resolves on ${ep.resolutionDigits.join("/")}`}
        />
        <Field
          label="Wait for this digit"
          value={entryDigitText}
          sub={
            d && !waitForEntry
              ? `P(win | digit ${d.digit}) ${(d.pWin * 100).toFixed(1)}% · N=${d.n} · ~${d.expectedWaitTicks} ticks apart`
              : signal?.reason ?? "No digit has validated conditional evidence yet"
          }
          tone={d && !waitForEntry ? "bull" : waitForEntry ? "warn" : "bear"}
          big
        />
        <Field
          label="Confidence"
          value={`${ep.confidence}/100`}
          sub={`Setup ${item.setup.grade} ${item.setup.score.toFixed(0)} · danger ${c.danger.toFixed(0)} · persistence ${item.persistence.scans < 2 ? "no history" : `${item.persistence.persistence}/100`}`}
          tone={ep.confidence >= 65 ? "bull" : ep.confidence >= 45 ? "warn" : "bear"}
        />
        <Field
          label="Entry margin"
          value={d && !waitForEntry ? marginText : "—"}
          sub={
            ep.runnerUpDigit !== null && d && !waitForEntry
              ? `Runner-up digit ${ep.runnerUpDigit} at ${ep.runnerUpScore?.toFixed(0)}/100 vs preferred ${d.score.toFixed(0)}/100 — separation, not a replacement.`
              : "Separation from the runner-up is only reported once a digit is validated."
          }
          tone={d && !waitForEntry ? (ep.entryMargin >= 5 ? "bull" : "warn") : "warn"}
        />
        <Field
          label="Validity window"
          value={ep.window.label}
          sub={ep.window.basis}
          tone={ready ? "neon" : "warn"}
        />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {waitForEntry
          ? `${statusLabel} — ${signal?.reason ?? "Wait for a validated entry digit."} Load your bot on DBot against ${item.symbol} / ${c.label} and keep it idle until Sentinel validates an entry digit.`
          : d && ready
          ? `Load your bot on DBot against ${item.symbol} / ${c.label}, keep it idle, and start it only when digit ${d.digit} prints. The entry digit is the digit showing at the moment you start — the contract still resolves on ${ep.resolutionDigits.join("/")}.`
          : `No entry digit is being offered. ${ep.summary}`}
      </p>
      <TradeFeedback item={item} />

      <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Analysis only · this app never places a trade
      </p>
    </section>
  );
}
