/**
 * Human shape parameters. Macro values are 0..1 like MakeHuman's sliders
 * (0.5 = average), except age, which is in years.
 */
export interface HumanParams {
  /** 0 = female, 1 = male. */
  gender: number;
  /** Years. Clamped to ADULT_MIN_AGE..MAX_AGE; this tool only produces adults. */
  ageYears: number;
  muscle: number;
  weight: number;
  height: number;
  proportions: number;
  cupSize: number;
  firmness: number;
  /** Ethnic shape mix; normalized to sum 1. */
  african: number;
  asian: number;
  caucasian: number;
}

/**
 * Hard lower age bound. Enforced in the data path (not just the UI): every
 * slider value is clamped here before any target weight is computed, and the
 * importer drops the baby targets entirely.
 */
export const ADULT_MIN_AGE = 18;
export const MAX_AGE = 90;

export const DEFAULT_PARAMS: HumanParams = {
  gender: 0.5,
  ageYears: 25,
  muscle: 0.5,
  weight: 0.5,
  height: 0.5,
  proportions: 0.5,
  cupSize: 0.5,
  firmness: 0.5,
  african: 1 / 3,
  asian: 1 / 3,
  caucasian: 1 / 3,
};

/**
 * MakeHuman's age axis: 0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90 (piecewise linear).
 * Clamped to adults.
 */
export function ageYearsToValue(years: number): number {
  const y = Math.min(MAX_AGE, Math.max(ADULT_MIN_AGE, years));
  if (y < 25) return 0.1875 + ((y - 11) / (25 - 11)) * (0.5 - 0.1875);
  return 0.5 + ((y - 25) / (MAX_AGE - 25)) * 0.5;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));

/** Returns a copy with every value in its legal range (adult age, normalized ethnicity). */
export function sanitizeParams(p: HumanParams): HumanParams {
  let a = Math.max(0, p.african), b = Math.max(0, p.asian), c = Math.max(0, p.caucasian);
  const sum = a + b + c;
  if (sum <= 0) a = b = c = 1 / 3;
  else (a /= sum), (b /= sum), (c /= sum);
  return {
    gender: clamp01(p.gender),
    ageYears: Math.min(MAX_AGE, Math.max(ADULT_MIN_AGE, Number.isFinite(p.ageYears) ? p.ageYears : 25)),
    muscle: clamp01(p.muscle),
    weight: clamp01(p.weight),
    height: clamp01(p.height),
    proportions: clamp01(p.proportions),
    cupSize: clamp01(p.cupSize),
    firmness: clamp01(p.firmness),
    african: a,
    asian: b,
    caucasian: c,
  };
}
