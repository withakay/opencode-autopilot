export const AUTOPILOT_DEFAULT_MAX_CONTINUES = 10;
export const AUTOPILOT_MAX_CONTINUES_HARD_LIMIT = 50;

export function normalizeMaxContinues(value: unknown): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return AUTOPILOT_DEFAULT_MAX_CONTINUES;
  }

  return Math.min(
    AUTOPILOT_MAX_CONTINUES_HARD_LIMIT,
    Math.max(1, Math.floor(numeric)),
  );
}
