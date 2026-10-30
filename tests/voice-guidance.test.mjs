import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVoiceGuidance,
  evaluateArrivalConfirmation,
} from "../lib/voice-guidance.ts";

test("evaluateVoiceGuidance suppresses announcement when voice is disabled or journey inactive", () => {
  const baseInstruction = {
    id: "inst-1",
    text: "Svolta a destra in Via Roma",
    distanceMeters: 50,
    pointIndex: 2,
    direction: "right",
    type: "turn",
  };

  const disabled = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: false,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 10,
    transportMode: "car",
    instruction: baseInstruction,
    instructionDistance: 50,
    lastSpokenInstructionId: "",
  });
  assert.equal(disabled.shouldSpeak, false);
  assert.equal(disabled.suppressionReason, "disabled");

  const inactive = evaluateVoiceGuidance({
    isJourneyActive: false,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 10,
    transportMode: "car",
    instruction: baseInstruction,
    instructionDistance: 50,
    lastSpokenInstructionId: "",
  });
  assert.equal(inactive.shouldSpeak, false);
  assert.equal(inactive.suppressionReason, "not_active");
});

test("evaluateVoiceGuidance suppresses maneuver announcements beyond approach thresholds", () => {
  const instruction = {
    id: "inst-2",
    text: "Tra 300 metri svolta a sinistra",
    distanceMeters: 300,
    pointIndex: 5,
    direction: "left",
    type: "turn",
  };

  // Car threshold is 250m
  const carTooFar = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 15,
    transportMode: "car",
    instruction,
    instructionDistance: 280,
    lastSpokenInstructionId: "",
  });
  assert.equal(carTooFar.shouldSpeak, false);
  assert.equal(carTooFar.suppressionReason, "too_far");

  const carInRange = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 15,
    transportMode: "car",
    instruction,
    instructionDistance: 230,
    lastSpokenInstructionId: "",
  });
  assert.equal(carInRange.shouldSpeak, true);
  assert.equal(carInRange.textToSpeak, "Tra 300 metri svolta a sinistra");
  assert.equal(carInRange.spokenInstructionId, "inst-2");

  // Bicycle threshold is 80m
  const bikeTooFar = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 10,
    transportMode: "bicycle",
    instruction,
    instructionDistance: 120,
    lastSpokenInstructionId: "",
  });
  assert.equal(bikeTooFar.shouldSpeak, false);
  assert.equal(bikeTooFar.suppressionReason, "too_far");

  const bikeInRange = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 10,
    transportMode: "bicycle",
    instruction,
    instructionDistance: 60,
    lastSpokenInstructionId: "",
  });
  assert.equal(bikeInRange.shouldSpeak, true);
});

test("evaluateVoiceGuidance suppresses arrive instruction as a maneuver", () => {
  const arriveInstruction = {
    id: "inst-dest",
    text: "Sei arrivato a destinazione",
    distanceMeters: 20,
    pointIndex: 10,
    direction: "arrive",
    type: "arrive",
  };

  const result = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 10,
    transportMode: "car",
    instruction: arriveInstruction,
    instructionDistance: 20,
    lastSpokenInstructionId: "",
  });
  assert.equal(result.shouldSpeak, false);
  assert.equal(result.suppressionReason, "arrive_instruction");
});

test("evaluateVoiceGuidance suppresses already spoken instruction and inaccurate GPS", () => {
  const instruction = {
    id: "inst-turn",
    text: "Gira a destra",
    distanceMeters: 40,
    pointIndex: 4,
    direction: "right",
    type: "turn",
  };

  const alreadySpoken = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 10,
    transportMode: "car",
    instruction,
    instructionDistance: 40,
    lastSpokenInstructionId: "inst-turn",
  });
  assert.equal(alreadySpoken.shouldSpeak, false);
  assert.equal(alreadySpoken.suppressionReason, "already_spoken");

  const inaccurateGps = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "live",
    accuracy: 65, // > 45m
    transportMode: "car",
    instruction,
    instructionDistance: 40,
    lastSpokenInstructionId: "",
  });
  assert.equal(inaccurateGps.shouldSpeak, false);
  assert.equal(inaccurateGps.suppressionReason, "gps_unreliable");

  const weakGps = evaluateVoiceGuidance({
    isJourneyActive: true,
    voiceEnabled: true,
    journeyMode: "gps",
    gpsState: "weak",
    accuracy: 20,
    transportMode: "car",
    instruction,
    instructionDistance: 40,
    lastSpokenInstructionId: "",
  });
  assert.equal(weakGps.shouldSpeak, false);
  assert.equal(weakGps.suppressionReason, "gps_unreliable");
});

test("evaluateArrivalConfirmation requires accurate GPS fix and 2 consecutive readings in GPS mode", () => {
  const baseInput = {
    routeEnd: [38.321, 16.401],
    currentPosition: [38.32105, 16.40105],
    accuracy: 12,
    distanceToEnd: 15,
    remainingRouteMeters: 15,
    journeyTravelledMeters: 500,
    minimumTravelBeforeArrival: 35,
    arrivalToleranceMeters: 25,
    currentArrivalReadings: 0,
    journeyMode: "gps",
  };

  // First reading: not confirmed yet, returns consecutiveArrivalReadings = 1
  const firstFix = evaluateArrivalConfirmation(baseInput);
  assert.equal(firstFix.isConfirmedArrival, false);
  assert.equal(firstFix.consecutiveArrivalReadings, 1);
  assert.equal(firstFix.arrivalNotice, null);

  // Second reading: confirmed!
  const secondFix = evaluateArrivalConfirmation({
    ...baseInput,
    currentArrivalReadings: firstFix.consecutiveArrivalReadings,
  });
  assert.equal(secondFix.isConfirmedArrival, true);
  assert.equal(secondFix.consecutiveArrivalReadings, 2);
  assert.equal(secondFix.arrivalNotice, "Sei arrivato a destinazione");

  // Inaccurate GPS reading (> 25m) should reject arrival and reset readings
  const noisyFix = evaluateArrivalConfirmation({
    ...baseInput,
    accuracy: 38,
    currentArrivalReadings: 1,
  });
  assert.equal(noisyFix.isConfirmedArrival, false);
  assert.equal(noisyFix.consecutiveArrivalReadings, 0);

  // Position too far from destination should reject arrival and reset readings
  const farFix = evaluateArrivalConfirmation({
    ...baseInput,
    distanceToEnd: 45, // > arrivalToleranceMeters (25)
    remainingRouteMeters: 45,
    currentArrivalReadings: 1,
  });
  assert.equal(farFix.isConfirmedArrival, false);
  assert.equal(farFix.consecutiveArrivalReadings, 0);
});

test("evaluateArrivalConfirmation confirms immediately in simulation mode", () => {
  const simInput = {
    routeEnd: [38.321, 16.401],
    currentPosition: [38.32105, 16.40105],
    accuracy: null,
    distanceToEnd: 12,
    remainingRouteMeters: 12,
    journeyTravelledMeters: 300,
    minimumTravelBeforeArrival: 35,
    arrivalToleranceMeters: 25,
    currentArrivalReadings: 0,
    journeyMode: "simulation",
  };

  const simResult = evaluateArrivalConfirmation(simInput);
  assert.equal(simResult.isConfirmedArrival, true);
  assert.equal(simResult.consecutiveArrivalReadings, 1);
  assert.equal(simResult.arrivalNotice, "Sei arrivato a destinazione");
});
