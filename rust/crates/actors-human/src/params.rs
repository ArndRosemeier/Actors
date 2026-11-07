//! Human shape parameters. Macro values are 0..1 like MakeHuman's sliders (0.5 = average),
//! except age, which is in years.

use serde::{Deserialize, Serialize};

/// Hard lower age bound. Enforced in the data path: every value is clamped here before any
/// target weight is computed, and the packs ship no baby targets.
pub const ADULT_MIN_AGE: f64 = 18.0;
pub const MAX_AGE: f64 = 90.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HumanParams {
    /// 0 = female, 1 = male.
    pub gender: f64,
    /// Years, clamped to ADULT_MIN_AGE..=MAX_AGE.
    pub age_years: f64,
    pub muscle: f64,
    pub weight: f64,
    pub height: f64,
    pub proportions: f64,
    pub cup_size: f64,
    pub firmness: f64,
    /// Ethnic shape mix; normalized to sum 1.
    pub african: f64,
    pub asian: f64,
    pub caucasian: f64,
}

impl Default for HumanParams {
    fn default() -> Self {
        Self {
            gender: 0.5,
            age_years: 25.0,
            muscle: 0.5,
            weight: 0.5,
            height: 0.5,
            proportions: 0.5,
            cup_size: 0.5,
            firmness: 0.5,
            african: 1.0 / 3.0,
            asian: 1.0 / 3.0,
            caucasian: 1.0 / 3.0,
        }
    }
}

/// MakeHuman's age axis: 0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90 (piecewise linear), clamped to adults.
pub fn age_years_to_value(years: f64) -> f64 {
    let y = years.clamp(ADULT_MIN_AGE, MAX_AGE);
    if y < 25.0 {
        0.1875 + (y - 11.0) / (25.0 - 11.0) * (0.5 - 0.1875)
    } else {
        0.5 + (y - 25.0) / (MAX_AGE - 25.0) * 0.5
    }
}

fn clamp01(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.5
    }
}

impl HumanParams {
    /// A copy with every value in its legal range (adult age, normalized ethnicity).
    pub fn sanitized(&self) -> Self {
        let pos = |v: f64| if v > 0.0 { v } else { 0.0 };
        let (mut a, mut b, mut c) = (pos(self.african), pos(self.asian), pos(self.caucasian));
        let sum = a + b + c;
        if sum <= 0.0 || !sum.is_finite() {
            (a, b, c) = (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0);
        } else {
            (a, b, c) = (a / sum, b / sum, c / sum);
        }
        Self {
            gender: clamp01(self.gender),
            age_years: if self.age_years.is_finite() { self.age_years } else { 25.0 }.clamp(ADULT_MIN_AGE, MAX_AGE),
            muscle: clamp01(self.muscle),
            weight: clamp01(self.weight),
            height: clamp01(self.height),
            proportions: clamp01(self.proportions),
            cup_size: clamp01(self.cup_size),
            firmness: clamp01(self.firmness),
            african: a,
            asian: b,
            caucasian: c,
        }
    }

    /// The ethnic weight by name ("african", "asian", "caucasian").
    pub fn ethnicity(&self, name: &str) -> f64 {
        match name {
            "african" => self.african,
            "asian" => self.asian,
            "caucasian" => self.caucasian,
            _ => 0.0,
        }
    }
}
