export function parseOffsetEnv(raw?: string): number {
  if (raw == null || raw.trim() === "") return 480;
  const hours = Number(raw);
  if (!Number.isFinite(hours)) return 480;
  const minutes = Math.round(hours * 60);
  if (minutes < -720 || minutes > 840) return 480;
  return minutes;
}

export function formatWithOffset(input: unknown, offsetMinutes: number): string | null {
  if (input == null) return null;
  const date = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(date.getTime())) return null;

  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const second = String(shifted.getUTCSeconds()).padStart(2, "0");
  const millisecond = String(shifted.getUTCMilliseconds()).padStart(3, "0");

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}${sign}${hh}:${mm}`;
}
