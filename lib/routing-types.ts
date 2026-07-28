export const TRANSPORT_MODES = ["car", "motorcycle", "bicycle"] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export type RoutingProviderName = "valhalla-fossgis" | "osrm-public-fallback";

export type RoutingProfileMetadata = {
  provider: RoutingProviderName | "mixed";
  profile: "auto" | "motorcycle" | "bicycle" | "driving";
  beta: boolean;
  approximate: boolean;
  fallbackUsed: boolean;
  notice: string;
};

export function isTransportMode(value: string): value is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(value);
}
