//! MakeHuman-style macro targets, named by the variable values they represent
//! ("female-young-maxmuscle-averageweight-maxheight"). A target's weight is the product of its
//! tokens' weights: the documented MakeHuman interpolation scheme, reimplemented.

use crate::params::{age_years_to_value, HumanParams};
use actors_core::{Error, Weights};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MacroTargetDef {
    pub name: String,
    pub tokens: Vec<String>,
}

/// Linear blend between named breakpoints; "" marks an average with no target.
fn axis(value: f64, breaks: &[f64], names: &[&'static str], out: &mut HashMap<&'static str, f64>) {
    for n in names {
        if !n.is_empty() {
            out.insert(n, 0.0);
        }
    }
    let v = value.clamp(breaks[0], breaks[breaks.len() - 1]);
    for i in 0..breaks.len() - 1 {
        if v <= breaks[i + 1] || i == breaks.len() - 2 {
            let t = (v - breaks[i]) / (breaks[i + 1] - breaks[i]);
            if !names[i].is_empty() {
                *out.get_mut(names[i]).unwrap() += 1.0 - t;
            }
            if !names[i + 1].is_empty() {
                *out.get_mut(names[i + 1]).unwrap() += t;
            }
            return;
        }
    }
}

/// Weight of each macro token (female, young, maxmuscle, african, ...) for the parameters.
pub fn macro_token_weights(params: &HumanParams) -> HashMap<&'static str, f64> {
    let p = params.sanitized();
    let mut w = HashMap::new();
    axis(p.gender, &[0.0, 1.0], &["female", "male"], &mut w);
    // Baby targets are never shipped; adults never reach that range anyway.
    axis(age_years_to_value(p.age_years), &[0.0, 0.1875, 0.5, 1.0], &["baby", "child", "young", "old"], &mut w);
    axis(p.muscle, &[0.0, 0.5, 1.0], &["minmuscle", "averagemuscle", "maxmuscle"], &mut w);
    axis(p.weight, &[0.0, 0.5, 1.0], &["minweight", "averageweight", "maxweight"], &mut w);
    axis(p.height, &[0.0, 0.5, 1.0], &["minheight", "", "maxheight"], &mut w);
    axis(p.proportions, &[0.0, 0.5, 1.0], &["uncommonproportions", "", "idealproportions"], &mut w);
    axis(p.cup_size, &[0.0, 0.5, 1.0], &["mincup", "averagecup", "maxcup"], &mut w);
    axis(p.firmness, &[0.0, 0.5, 1.0], &["minfirmness", "averagefirmness", "maxfirmness"], &mut w);
    w.insert("african", p.african);
    w.insert("asian", p.asian);
    w.insert("caucasian", p.caucasian);
    w
}

/// Macro target weights (only those above 1e-5).
pub fn macro_target_weights(defs: &[MacroTargetDef], params: &HumanParams) -> Result<Weights, Error> {
    let tw = macro_token_weights(params);
    let mut out = Weights::new();
    for def in defs {
        let mut w = 1.0;
        for token in &def.tokens {
            let v = tw.get(token.as_str()).ok_or_else(|| Error::Format(format!("unknown macro token \"{token}\" in {}", def.name)))?;
            w *= v;
            if w == 0.0 {
                break;
            }
        }
        if w > 1e-5 {
            out.insert(def.name.clone(), w);
        }
    }
    Ok(out)
}
