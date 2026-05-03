const LAUNCH_DATE_ISO = "2026-01-01"; // YYYY-MM-DD (local)
const BASE_GAME_NO = 1;

function startOfLocalDay(d: Date) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetweenLocal(a: Date, b: Date) {
  const ms = startOfLocalDay(b) - startOfLocalDay(a);
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function formatDateLongES(d: Date) {
  return new Intl.DateTimeFormat("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function getDailyGameNo(today: Date) {
  const launch = new Date(`${LAUNCH_DATE_ISO}T00:00:00`);
  const delta = daysBetweenLocal(launch, today);
  // If someone opens before launch date, clamp to BASE_GAME_NO.
  return BASE_GAME_NO + Math.max(0, delta);
}
