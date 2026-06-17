export const AUTOPILOT_DEFAULT_MAX_CONTINUES = 10;
export const AUTOPILOT_MAX_CONTINUES_HARD_LIMIT = 50;
export const AUTOPILOT_DEFAULT_MAX_DURATION_MS = 15 * 60 * 1000;
export const AUTOPILOT_DEFAULT_MAX_TOKENS = 200000;
export const AUTOPILOT_DEFAULT_NO_PROGRESS_TOKEN_THRESHOLD = 50;
export const AUTOPILOT_DEFAULT_NO_PROGRESS_TURNS = 2;

export function normalizeMaxContinues(value: unknown): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return AUTOPILOT_DEFAULT_MAX_CONTINUES;
  }

  return Math.min(AUTOPILOT_MAX_CONTINUES_HARD_LIMIT, Math.max(1, Math.floor(numeric)));
}

export function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);

  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    return fallback;
  }

  return numeric;
}
