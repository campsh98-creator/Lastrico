export type NavigationDirection =
  | "left"
  | "right"
  | "straight"
  | "uturn"
  | "roundabout"
  | "depart"
  | "arrive";

export type NavigationInstruction = {
  id: string;
  text: string;
  roadName: string;
  distance: number;
  location: [number, number];
  type: string;
  modifier: string;
  exit?: number;
  direction: NavigationDirection;
};

export function directionGlyph(direction: NavigationDirection | undefined) {
  const glyphs: Record<NavigationDirection, string> = {
    left: "↰",
    right: "↱",
    straight: "↑",
    uturn: "↶",
    roundabout: "⟳",
    depart: "↑",
    arrive: "●",
  };
  return direction ? glyphs[direction] : "↑";
}

export function currentInstructionIndex(
  instructions: NavigationInstruction[],
  currentInstructionId: string | undefined,
) {
  if (!instructions.length) return -1;
  if (!currentInstructionId) return 0;
  const index = instructions.findIndex((instruction) => instruction.id === currentInstructionId);
  return index >= 0 ? index : 0;
}

export function formatInstructionDistance(meters: number) {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}
