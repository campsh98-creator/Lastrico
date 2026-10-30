/**
 * Voice Guidance and Arrival Confirmation Engine
 * Phase 4.9: Prevent premature announcements and ensure reliable arrival confirmation
 */
import type { NavigationInstruction } from "./navigation-instructions";

export type TransportMode = "car" | "motorcycle" | "bicycle";

export type GpsState =
  | "live"
  | "weak"
  | "temporarily-unavailable"
  | "outside"
  | "offroute"
  | "requesting"
  | "recalculating"
  | "unavailable"
  | "idle";

export type VoiceGuidanceInput = {
  isJourneyActive: boolean;
  voiceEnabled: boolean;
  journeyMode: "gps" | "simulation" | null;
  gpsState: GpsState;
  accuracy: number | null;
  transportMode: TransportMode;
  instruction: NavigationInstruction | null;
  instructionDistance: number;
  lastSpokenInstructionId: string;
};

export type VoiceGuidanceResult = {
  shouldSpeak: boolean;
  textToSpeak: string | null;
  spokenInstructionId: string | null;
  suppressionReason?:
    | "disabled"
    | "not_active"
    | "no_instruction"
    | "arrive_instruction"
    | "already_spoken"
    | "too_far"
    | "gps_unreliable";
};

export const VOICE_ANNOUNCEMENT_DISTANCE_METERS: Record<TransportMode, number> = {
  car: 250,
  motorcycle: 250,
  bicycle: 80,
};

/**
 * Evaluates whether an upcoming maneuver should be spoken.
 * Suppresses premature announcements, destination "arrive" as a maneuver,
 * and fixes during weak or missing GPS.
 */
export function evaluateVoiceGuidance(input: VoiceGuidanceInput): VoiceGuidanceResult {
  if (!input.isJourneyActive) {
    return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "not_active" };
  }
  if (!input.voiceEnabled) {
    return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "disabled" };
  }
  if (!input.instruction) {
    return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "no_instruction" };
  }

  // Arrival instructions must never be announced as an upcoming maneuver.
  // Destination arrival is announced exclusively upon verified arrival confirmation.
  if (input.instruction.type === "arrive" || input.instruction.direction === "arrive") {
    return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "arrive_instruction" };
  }

  // Avoid repeating the exact same instruction
  if (input.lastSpokenInstructionId === input.instruction.id) {
    return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "already_spoken" };
  }

  // In GPS navigation mode, verify GPS fix reliability before speaking
  if (input.journeyMode === "gps") {
    if (
      input.gpsState !== "live" ||
      input.accuracy === null ||
      input.accuracy > 45
    ) {
      return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "gps_unreliable" };
    }
  }

  // Distance threshold check: suppress until within approach threshold
  const maxDistance = VOICE_ANNOUNCEMENT_DISTANCE_METERS[input.transportMode] ?? 200;
  if (input.instructionDistance > maxDistance) {
    return { shouldSpeak: false, textToSpeak: null, spokenInstructionId: null, suppressionReason: "too_far" };
  }

  return {
    shouldSpeak: true,
    textToSpeak: input.instruction.text,
    spokenInstructionId: input.instruction.id,
  };
}

export type ArrivalEvaluationInput = {
  routeEnd: [number, number] | null;
  currentPosition: [number, number] | null;
  accuracy: number | null;
  distanceToEnd: number;
  remainingRouteMeters: number;
  journeyTravelledMeters: number;
  minimumTravelBeforeArrival: number;
  arrivalToleranceMeters: number;
  currentArrivalReadings: number;
  journeyMode: "gps" | "simulation" | null;
};

export type ArrivalEvaluationResult = {
  isConfirmedArrival: boolean;
  consecutiveArrivalReadings: number;
  arrivalNotice: string | null;
};

/**
 * Reliably verifies whether the user has reached destination.
 * Requires GPS fix quality within 25m, position within arrival tolerance,
 * and multiple consecutive confirmed readings in GPS mode.
 */
export function evaluateArrivalConfirmation(input: ArrivalEvaluationInput): ArrivalEvaluationResult {
  if (!input.routeEnd || !input.currentPosition) {
    return { isConfirmedArrival: false, consecutiveArrivalReadings: 0, arrivalNotice: null };
  }

  if (input.journeyMode === "gps") {
    // In GPS mode, reject inaccurate fixes (> 25m) as unreliable for confirming arrival
    if (input.accuracy === null || input.accuracy > 25) {
      return { isConfirmedArrival: false, consecutiveArrivalReadings: 0, arrivalNotice: null };
    }
  }

  const isReadingAtDestination = (
    input.distanceToEnd <= input.arrivalToleranceMeters &&
    input.remainingRouteMeters <= input.arrivalToleranceMeters * 1.5 &&
    input.journeyTravelledMeters >= input.minimumTravelBeforeArrival
  );

  if (!isReadingAtDestination) {
    return { isConfirmedArrival: false, consecutiveArrivalReadings: 0, arrivalNotice: null };
  }

  const nextReadings = input.currentArrivalReadings + 1;
  const isConfirmed = input.journeyMode === "simulation" ? true : nextReadings >= 2;

  return {
    isConfirmedArrival: isConfirmed,
    consecutiveArrivalReadings: nextReadings,
    arrivalNotice: isConfirmed ? "Sei arrivato a destinazione" : null,
  };
}
