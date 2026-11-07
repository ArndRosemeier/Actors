//! Checks that need no pack (the golden test compares everything else with TypeScript).

use actors_generator::*;
use actors_human::RaceId;

fn empty_catalog() -> CharacterCatalog {
    CharacterCatalog {
        races: RaceId::ALL
            .iter()
            .map(|&id| RaceChoice { id, label: id.as_str().into(), description: String::new(), themes: None })
            .collect(),
        animations: Vec::new(),
        libraries: Vec::new(),
        garments: Vec::new(),
        outfits: Vec::new(),
        hair: Vec::new(),
        hair_colors: Vec::new(),
        garment_colors: Vec::new(),
        brows: Vec::new(),
        eyes: Vec::new(),
        expressions: Vec::new(),
        details: Vec::new(),
        photo_skin: false,
        robot: None,
        skeletal: None,
        people: None,
        height: None,
    }
}

#[test]
fn seeded_random_matches_javascript() {
    // Values printed by `seededRandom` in TypeScript.
    let mut r = SeededRandom::new(42.0);
    assert_eq!([r.next(), r.next(), r.next()], [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
    assert_eq!(SeededRandom::new(-7.5).next(), 0.43306733411736786);
    assert_eq!(SeededRandom::new(4294967296.0 * 3.0 + 5.0).next(), 0.6897749109193683);
}

#[test]
fn partial_json_takes_defaults() {
    let c: CharacterConfig = serde_json::from_str(r#"{ "race": "elf", "body": { "gender": 1 }, "outfit": ["tshirt"] }"#).unwrap();
    assert_eq!(c.race, RaceId::Elf);
    assert_eq!(c.body.gender, 1.0);
    assert_eq!(c.body.age_years, 25.0);
    assert_eq!(c.expression, "neutral");
    assert!(c.robot_look.glow_strength > 0.0);
    let back: CharacterConfig = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
    assert_eq!(back, c);
}

#[test]
fn children_never_show_anatomy_and_ages_stay_adult() {
    let cat = empty_catalog();
    let mut c = default_config(&cat);
    c.youth = 0.6;
    c.anatomy = true;
    c.body.age_years = 3.0;
    let s = sanitize_config(&cat, &c);
    assert!(!s.anatomy);
    assert_eq!(s.body.age_years, actors_human::ADULT_MIN_AGE);
    assert_eq!(s.youth, 0.6);
}

#[test]
fn catalog_without_robots_turns_them_off() {
    let mut cat = empty_catalog();
    let c = CharacterConfig { robot: true, horns: "ram".into(), ..default_config(&cat) };
    assert!(!fit_config(&cat, &c).robot);
    // Only humans: no horns.
    cat.races.retain(|r| r.id == RaceId::Human);
    assert_eq!(fit_config(&cat, &c).horns, "none");
}

#[test]
fn flags_and_heights() {
    let list: Flags = serde_json::from_str(r#"["human", "robot"]"#).unwrap();
    let map: Flags = serde_json::from_str(r#"{ "robot": false }"#).unwrap();
    assert!(list.on("robot") && !list.on("elf"));
    assert!(!map.on("robot") && map.on("elf"));
    let range = HeightRange { min: Some(1.5), max: Some(2.0) };
    assert_eq!(height_fit(1.0, Some(&range)), 1.5);
    assert_eq!(height_fit(1.8, Some(&range)), 1.0);
    assert_eq!(height_fit(4.0, Some(&range)), 0.5);
    assert!(AllowOptions::preset("fantasy").is_some());
}

#[test]
fn random_characters_are_reproducible() {
    let cat = empty_catalog();
    let base = default_config(&cat);
    let opts = RandomOptions { race: Some(RaceChoiceOption::Any), ..Default::default() };
    let a = random_config(&cat, &base, &opts, &mut SeededRandom::new(9.0));
    let b = random_config(&cat, &base, &opts, &mut SeededRandom::new(9.0));
    assert_eq!(a, b);
    assert!(a.body.age_years >= actors_human::ADULT_MIN_AGE);
}
