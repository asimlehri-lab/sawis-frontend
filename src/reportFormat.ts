import type { CSSProperties } from "react";
import { formatMoney } from "./api";
import type { ReportsSummary } from "./api";

// Small formatting helpers shared by the Reports screen, its charts and the
// PDF sheet (kept out of the component files so those only export components).

export const sectionHeadStyle: CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted)",
  fontWeight: 700,
  margin: 0,
};

export function pct(n: number | null, d = 1) {
  return n === null ? "—" : `${n.toFixed(d)}%`;
}

export function signed(n: number, d: number, unit = ""): string {
  const s = n < 0 ? "−" : "+";
  return `${s}${Math.abs(n).toFixed(d)}${unit}`;
}

// Money with a proper minus sign and the sign outside the currency symbol
// (−£310.00, not £-310.00).
export function signedMoney(n: number, currency?: string, d = 2): string {
  return `${n < 0 ? "−" : ""}${formatMoney(Math.abs(n), currency, d)}`;
}

export function compareLabel(period: ReportsSummary["period"]): string {
  return period === "week" ? "vs week before" : period === "month" ? "vs last month" : "vs month before";
}

export function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function fmtShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
