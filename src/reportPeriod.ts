// Date maths for the Reports period picker. Everything is a local-calendar
// YYYY-MM-DD string, never a UTC timestamp, so "Monday" is the Monday the
// person sees on their own calendar.

export function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromIso(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function todayIso(): string {
  return toIso(new Date());
}

export function addDays(s: string, n: number): string {
  const d = fromIso(s);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// The Monday of the week containing `s` (weeks run Monday to Sunday).
export function mondayOf(s: string): string {
  const d = fromIso(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIso(d);
}

export function monthStartOf(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function addMonths(s: string, n: number): string {
  const d = fromIso(monthStartOf(s));
  d.setMonth(d.getMonth() + n);
  return toIso(d);
}

export function monthEndOf(s: string): string {
  return addDays(addMonths(s, 1), -1);
}

export function weekLabel(monday: string): string {
  const a = fromIso(monday);
  const b = fromIso(addDays(monday, 6));
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  const left = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${month(a)}`;
  return `${left} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`;
}

export function monthLabel(first: string): string {
  return fromIso(first).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
