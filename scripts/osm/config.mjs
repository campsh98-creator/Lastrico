/**
 * Configuration and normalization dictionaries for Lastrico Road Intelligence
 */

export const MILAN_BOUNDS = {
  west: 9.04,
  south: 45.38,
  east: 9.31,
  north: 45.55,
};

export const SURFACE_MATERIAL_MAP = {
  sett: "sett",
  cobblestone: "cobblestone",
  unhewn_cobblestone: "unhewn_cobblestone",
  paving_stones: "paving_stones",
  "paving_stones:lanes": "paving_stones",
  asphalt: "asphalt",
  concrete: "concrete",
  paved: "paved",
  unpaved: "unpaved",
  compacted: "compacted",
  gravel: "gravel",
  fine_gravel: "fine_gravel",
  ground: "unpaved",
  dirt: "unpaved",
  earth: "unpaved",
};

export const SURFACE_CATEGORY_MAP = {
  sett: "confirmed_rough",
  cobblestone: "confirmed_rough",
  unhewn_cobblestone: "confirmed_rough",
  paving_stones: "probable_rough",
  asphalt: "confirmed_smooth",
  concrete: "confirmed_smooth",
  // Paved is a broad class that also includes paving stones; it is not smooth evidence.
  paved: "unknown",
  unpaved: "unpaved_loose",
  compacted: "unpaved_loose",
  gravel: "unpaved_loose",
  fine_gravel: "unpaved_loose",
  other: "unknown",
  unknown: "unknown",
};

export const SURFACE_ROUGHNESS_WEIGHT = {
  sett: 1.0,
  cobblestone: 1.0,
  unhewn_cobblestone: 1.0,
  paving_stones: 0.65,
  asphalt: 0.0,
  concrete: 0.0,
  paved: 0.0,
  compacted: 0.35,
  gravel: 0.7,
  fine_gravel: 0.5,
  unpaved: 0.6,
  other: 0.0,
  unknown: 0.0,
};

export const SMOOTHNESS_MAP = {
  excellent: "excellent",
  good: "good",
  intermediate: "intermediate",
  bad: "bad",
  very_bad: "very_bad",
  horrible: "horrible",
  very_horrible: "very_horrible",
  impassable: "impassable",
};

export const HIGHWAY_MAP = {
  motorway: "motorway",
  motorway_link: "motorway",
  trunk: "trunk",
  trunk_link: "trunk",
  primary: "primary",
  primary_link: "primary",
  secondary: "secondary",
  secondary_link: "secondary",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
  unclassified: "unclassified",
  residential: "residential",
  living_street: "living_street",
  service: "service",
  pedestrian: "pedestrian",
  cycleway: "cycleway",
  footway: "footway",
  path: "path",
  track: "track",
  steps: "steps",
  road: "unknown",
};
