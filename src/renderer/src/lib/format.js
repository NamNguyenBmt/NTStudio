const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const integer = new Intl.NumberFormat("en-US");
export const formatCompact = (n) => compact.format(n);
export const formatInt = (n) => integer.format(n);
export const formatPct = (n, digits = 1) => `${n.toFixed(digits)}%`;
export const formatSignedPct = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

const rtf = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });

export function formatRelative(date, now = Date.now()) {
  const diff = (typeof date === "number" ? date : date.getTime()) - now;
  const abs = Math.abs(diff);
  if (abs < 6e4) return "vừa xong";
  if (abs < 36e5) return rtf.format(Math.round(diff / 6e4), "minute");
  if (abs < 864e5) return rtf.format(Math.round(diff / 36e5), "hour");
  return rtf.format(Math.round(diff / 864e5), "day");
}
