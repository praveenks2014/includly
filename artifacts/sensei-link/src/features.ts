export type FeatureStatus = "enabled" | "coming_soon" | "hidden";

export const FEATURES = {
  professional_search: "coming_soon",
  resources: "hidden",
  ask_includly: "hidden",
  pro_clients: "hidden",
} as const satisfies Record<string, FeatureStatus>;

export const STAT_THRESHOLDS = {
  specialists: 50,
  centres: 20,
  parents: 100,
} as const;
