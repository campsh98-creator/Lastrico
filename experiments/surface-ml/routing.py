"""Offline, conservative fixed-candidate sensitivity analysis. Never used at runtime.

The archived choice is a historical baseline, not a replay of today's selector.
Five-metre samples are matched only within 10 m and 35 degrees, with ambiguous
near-parallel ways rejected. OSM is reference evidence, not a field survey.
"""
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

SAMPLE_M = 5.0
PROXIMITY_M = 10.0
AMBIGUITY_M = 3.0
CELL_M = 40.0


def projection(point, latitude):
    return (point[0] * 111320 * math.cos(math.radians(latitude)), point[1] * 111320)


def point_distance(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    squared = dx * dx + dy * dy
    t = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared)) if squared else 0
    return math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)


class RoadIndex:
    def __init__(self, rows, area):
        self.latitude = 45.46 if area == "milan" else 38.32
        self.grid = defaultdict(list)
        for row in rows:
            if row["area"] != area:
                continue
            for edge in row.get("edges", []):
                coordinates = edge["coordinates"]
                for start, end in zip(coordinates, coordinates[1:]):
                    a, b = projection(start, self.latitude), projection(end, self.latitude)
                    if a == b:
                        continue
                    item = (row, edge, a, b)
                    for x in range(math.floor((min(a[0], b[0]) - PROXIMITY_M) / CELL_M), math.floor((max(a[0], b[0]) + PROXIMITY_M) / CELL_M) + 1):
                        for y in range(math.floor((min(a[1], b[1]) - PROXIMITY_M) / CELL_M), math.floor((max(a[1], b[1]) + PROXIMITY_M) / CELL_M) + 1):
                            self.grid[x, y].append(item)

    def match(self, point, heading, mode):
        candidates = {}
        for row, edge, a, b in self.grid.get((math.floor(point[0] / CELL_M), math.floor(point[1] / CELL_M)), []):
            distance = point_distance(point, a, b)
            if distance > PROXIMITY_M:
                continue
            dx, dy = b[0] - a[0], b[1] - a[1]
            dot = (dx * heading[0] + dy * heading[1]) / math.hypot(dx, dy)
            if abs(dot) < math.cos(math.radians(35)):
                continue
            direction = edge.get("modeDirections", {}).get(mode, "unknown")
            legal = edge.get("modeAccess", {}).get(mode, False) and (
                direction == "both" or direction == "forward" and dot > 0 or direction == "backward" and dot < 0)
            old = candidates.get(row["id"])
            if old is None or distance < old[0]:
                candidates[row["id"]] = (distance, row, legal)
        ordered = sorted(candidates.values(), key=lambda item: (item[0], item[1]["id"]))
        if not ordered:
            return None, "unmatched"
        if len(ordered) > 1 and ordered[1][0] <= ordered[0][0] + AMBIGUITY_M:
            return None, "ambiguous"
        if not ordered[0][2]:
            return None, "access_or_direction_rejected"
        return ordered[0][1], "matched"


def score_route(route, mode, index, oof_probs, unknown_probs):
    totals = defaultdict(float)
    for start, end in zip(route["coordinates"], route["coordinates"][1:]):
        a, b = projection(start, index.latitude), projection(end, index.latitude)
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if not length:
            continue
        count = max(1, math.ceil(length / SAMPLE_M))
        weight = length / count
        for sample in range(count):
            t = (sample + 0.5) / count
            row, status = index.match((a[0] + t * dx, a[1] + t * dy), (dx / length, dy / length), mode)
            totals["total_m"] += weight
            totals[status + "_m"] += weight
            if row is None:
                totals["masked_baseline_risk_m"] += weight
                continue
            identifier, label = row["id"], row.get("label")
            if label is not None:
                totals["labeled_m"] += weight
                totals["reference_pave_m"] += weight * label
            if label is not None and identifier in oof_probs:
                probability = oof_probs[identifier]
                totals["heldout_m"] += weight
                totals["heldout_pave_m"] += weight * label
                totals["masked_baseline_risk_m"] += weight
                totals["masked_added_risk_m"] += weight * probability
                if probability >= 0.9:
                    totals["heldout_high_probability_m"] += weight
                    totals["heldout_false_high_probability_m"] += weight * (1 - label)
                if probability <= 0.1:
                    totals["heldout_low_probability_m"] += weight
                    totals["heldout_false_low_probability_m"] += weight * label
            elif label is not None:
                totals["masked_baseline_risk_m"] += weight * label
            else:
                # Ambiguous tags and unclassified spans retain uncertainty.
                totals["masked_baseline_risk_m"] += weight
            if row.get("unknown") and identifier in unknown_probs:
                totals["unknown_predicted_m"] += weight
                totals["unknown_added_risk_m"] += weight * unknown_probs[identifier]
    keys = ["total_m", "matched_m", "unmatched_m", "ambiguous_m", "access_or_direction_rejected_m", "labeled_m", "reference_pave_m", "heldout_m", "heldout_pave_m", "masked_baseline_risk_m", "masked_added_risk_m", "unknown_predicted_m", "unknown_added_risk_m", "heldout_high_probability_m", "heldout_false_high_probability_m", "heldout_low_probability_m", "heldout_false_low_probability_m"]
    return {key: round(totals[key], 3) for key in keys}


def choose_candidate(candidates, score_key, budget_minutes=5):
    fastest = min(candidate["minutes"] for candidate in candidates)
    eligible = [candidate for candidate in candidates if candidate["minutes"] <= fastest + budget_minutes + 1e-9]
    return min(eligible, key=lambda candidate: (candidate[score_key], candidate["minutes"], candidate["id"]))


def analyze_routes(rows, oof_probs, unknown_probs, root):
    root = Path(root)
    indices = {area: RoadIndex(rows, area) for area in ("milan", "roccella")}
    results = []
    skipped = []
    paths = sorted((root / "outputs/phase32-benchmark").glob("after-*.json")) + sorted((root / "outputs/phase42-validation").glob("*.json"))
    for path in paths:
        archive_bytes = path.read_bytes()
        archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
        saved = json.loads(archive_bytes)
        payload = saved.get("payload", saved)
        if "fast" not in payload or "safe" not in payload:
            continue
        area = payload.get("area") or saved.get("request", {}).get("area") or ("roccella" if path.parent.name == "phase42-validation" else "milan")
        mode = payload.get("transportMode") or payload.get("mode") or saved.get("request", {}).get("mode")
        if area not in indices or mode not in ("car", "motorcycle", "bicycle"):
            skipped.append({"file": str(path.relative_to(root)), "archive_sha256": archive_sha256, "reason": "Unknown area or transport mode"})
            continue
        profile = payload.get("routingProfile") or {}
        profile_name = profile.get("profile")
        if not profile.get("provider") or profile_name not in {"car": {"auto", "driving"}, "motorcycle": {"motorcycle"}, "bicycle": {"bicycle", "cycling"}}[mode]:
            skipped.append({"file": str(path.relative_to(root)), "archive_sha256": archive_sha256, "reason": "Missing or incompatible recorded provider profile; no legal-mode assumption"})
            continue
        if any(not isinstance(payload[name].get("minutes"), (int, float)) or not math.isfinite(payload[name]["minutes"]) or payload[name]["minutes"] < 0 for name in ("fast", "safe")):
            skipped.append({"file": str(path.relative_to(root)), "archive_sha256": archive_sha256, "reason": "Missing/invalid recorded duration; budget cannot be verified"})
            continue
        candidates = []
        seen = set()
        recorded_id = "safe" if payload.get("hasDistinctAlternative") else "fast"
        for identifier in ("fast", "safe"):
            route = payload[identifier]
            digest = hashlib.sha256(json.dumps(route["coordinates"], separators=(",", ":")).encode()).hexdigest()
            if digest in seen:
                if identifier == recorded_id:
                    recorded_id = candidates[0]["id"]
                continue
            seen.add(digest)
            metrics = score_route(route, mode, indices[area], oof_probs, unknown_probs)
            existing_risk = route.get("paveMeters", 0) + route.get("unknownSurfaceMeters", 0)
            candidates.append({"id": identifier, "minutes": route["minutes"], "geometry_sha256": digest,
                               "recorded_pave_m": route.get("paveMeters"), "recorded_unknown_m": route.get("unknownSurfaceMeters"),
                               "metrics": metrics, "fixed_rule_score": existing_risk, "unknown_ml_score": existing_risk + metrics["unknown_added_risk_m"],
                               "masked_baseline_score": metrics["masked_baseline_risk_m"],
                               "masked_ml_score": metrics["masked_baseline_risk_m"] + metrics["masked_added_risk_m"]})
        recorded_budget = (payload.get("appliedPreferences") or {}).get("maximumExtraMinutes")
        budget = min(5, max(0, recorded_budget)) if isinstance(recorded_budget, (int, float)) and math.isfinite(recorded_budget) else 5
        baseline = next(candidate for candidate in candidates if candidate["id"] == recorded_id)
        fixed_control = choose_candidate(candidates, "fixed_rule_score", budget)
        experimental = choose_candidate(candidates, "unknown_ml_score", budget)
        masked_baseline = choose_candidate(candidates, "masked_baseline_score", budget)
        masked_ml = choose_candidate(candidates, "masked_ml_score", budget)
        improvement = masked_baseline["metrics"]["heldout_pave_m"] - masked_ml["metrics"]["heldout_pave_m"]
        extra_seconds = (masked_ml["minutes"] - masked_baseline["minutes"]) * 60
        results.append({"file": str(path.relative_to(root)), "archive_sha256": archive_sha256, "area": area, "mode": mode,
                        "recorded_provider_profile": profile, "candidate_count": len(candidates),
                        "budget_minutes": budget, "recorded_choice": baseline["id"], "experimental_unknown_choice": experimental["id"],
                        "fixed_rule_control_choice": fixed_control["id"], "changed_due_to_ml_penalty": fixed_control["id"] != experimental["id"],
                        "changed_from_recorded": baseline["id"] != experimental["id"],
                        "extra_seconds_vs_recorded": round((experimental["minutes"] - baseline["minutes"]) * 60, 3),
                        "matched_reference_pave_reduction_m": round(baseline["metrics"]["reference_pave_m"] - experimental["metrics"]["reference_pave_m"], 3),
                        "unknown_truth": None,
                        "masked": {"baseline_choice": masked_baseline["id"], "ml_choice": masked_ml["id"],
                                   "heldout_pave_reduction_m": round(improvement, 3), "extra_seconds": round(extra_seconds, 3),
                                   "detour_without_heldout_benefit": extra_seconds > 1 and improvement <= 1},
                        "candidates": candidates})
    return {"method": "Historical recorded-choice versus fixed fast/safe candidate sensitivity; not current-selector replay or field validation.",
            "matching": {"sample_m": SAMPLE_M, "proximity_m": PROXIMITY_M, "ambiguity_margin_m": AMBIGUITY_M, "max_heading_degrees": 35},
            "false_confidence_thresholds": {"high_pave_probability": 0.9, "low_pave_probability": 0.1},
            "ranking": "Recorded pave + recorded unknown metres + predicted pavé probability × matched genuinely unknown metres. Never decrease uncertainty penalties or relabel as smooth. Masked test uses the same additive rule on geographically held-out labeled spans.",
            "limitations": ["Only archived fast/safe geometries; no new candidate generation or legal graph validation.",
                            "Archived provider transport profiles and a maximum five-minute budget are preserved; matching also filters current modal access/direction.",
                            "Missing/incompatible provider profiles or durations are skipped; recorded profiles alone do not establish present-day legal validity. Missing/null historical budgets use the experiment's five-minute cap.",
                            "No surveyed truth for genuinely unknown roads: correct avoidance and unnecessary detours cannot be certified there.",
                            "Masked results concern mapped OSM labels, not unbiased unknown-road samples; mixed geographical OOF predictions are a sensitivity analysis, not one independent deployment model.",
                            "Unmatched/ambiguous intervals retain uncertainty; low pavé probability is never smooth-surface evidence.",
                            "Historical response surface totals can differ from current archive/matcher measurements."],
            "summary": {"scenarios": len(results), "with_distinct_candidates": sum(row["candidate_count"] > 1 for row in results),
                        "changed_from_recorded": sum(row["changed_from_recorded"] for row in results),
                        "changed_due_to_ml_penalty": sum(row["changed_due_to_ml_penalty"] for row in results),
                        "masked_improved": sum(row["masked"]["heldout_pave_reduction_m"] > 1 for row in results),
                        "masked_worsened": sum(row["masked"]["heldout_pave_reduction_m"] < -1 for row in results),
                        "masked_detours_without_heldout_benefit": sum(row["masked"]["detour_without_heldout_benefit"] for row in results),
                        "certified_unknown_road_improvements": None}, "scenarios": results, "skipped": skipped}
