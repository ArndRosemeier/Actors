//! Theme tags: which settings an option fits ("modern", "medieval", "future", ...). A game passes
//! the themes it allows ([`ThemeFilter`]) and its catalog keeps only what fits one of them;
//! options without tags fit every setting.

use crate::catalog::CharacterCatalog;
use crate::data::data;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Which options a game offers.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeFilter {
    /// Themes the game allows; an option fits when it has none of its own or shares one. None: every theme.
    pub themes: Option<Vec<String>>,
    /// Tags left out whatever the themes (theme flags such as "real-faith").
    pub without: Option<Vec<String>>,
}

/// Whether an option with these tags fits the filter.
pub fn fits_themes(tags: Option<&[String]>, filter: &ThemeFilter) -> bool {
    let Some(tags) = tags.filter(|t| !t.is_empty()) else { return true };
    if filter.without.as_ref().is_some_and(|w| w.iter().any(|t| tags.contains(t))) {
        return false;
    }
    let flags = &data().theme_flags;
    let eras: Vec<&String> = tags.iter().filter(|t| !flags.iter().any(|f| &f.id == *t)).collect();
    match &filter.themes {
        None => true,
        Some(themes) => eras.is_empty() || eras.iter().any(|t| themes.contains(t)),
    }
}

/// The catalog with only what fits `filter`: garments, hairstyles and races by their tags, outfit
/// presets whose garments all remain, and robots and skeletons only with their theme.
pub fn filter_catalog(catalog: &CharacterCatalog, filter: &ThemeFilter) -> CharacterCatalog {
    let garments: Vec<_> = catalog.garments.iter().filter(|g| fits_themes(g.themes.as_deref(), filter)).cloned().collect();
    let outfits = keep_outfits(catalog, &garments.iter().map(|g| g.id.as_str()).collect());
    let kinds = &data().kind_themes;
    CharacterCatalog {
        races: catalog.races.iter().filter(|r| fits_themes(r.themes.as_deref(), filter)).cloned().collect(),
        hair: catalog.hair.iter().filter(|h| fits_themes(h.themes.as_deref(), filter)).cloned().collect(),
        robot: if fits_themes(Some(&kinds.robot), filter) { catalog.robot.clone() } else { None },
        skeletal: if fits_themes(Some(&kinds.skeletal), filter) { catalog.skeletal.clone() } else { None },
        garments,
        outfits,
        ..catalog.clone()
    }
}

/// Outfit presets whose garments are all in `have`, their female extras cut to those too.
pub(crate) fn keep_outfits(catalog: &CharacterCatalog, have: &HashSet<&str>) -> Vec<crate::catalog::OutfitPreset> {
    catalog
        .outfits
        .iter()
        .filter(|o| o.garments.iter().all(|g| have.contains(g.as_str())))
        .map(|o| {
            let mut o = o.clone();
            if let Some(f) = &mut o.female {
                f.retain(|g| have.contains(g.as_str()));
            }
            o
        })
        .collect()
}
