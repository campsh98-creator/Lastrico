import unittest
import hashlib
import json
import tempfile
from pathlib import Path

from routing import RoadIndex, analyze_routes, choose_candidate, projection, score_route


def road(identifier="milan:1", offset=0, direction="both", allowed=True):
    coordinates = [[9.18, 45.46 + offset], [9.181, 45.46 + offset]]
    return {"id": identifier, "area": "milan", "coordinates": coordinates, "label": 1, "unknown": False,
            "edges": [{"coordinates": coordinates, "modeAccess": {"bicycle": allowed}, "modeDirections": {"bicycle": direction}}]}


class RoutingTests(unittest.TestCase):
    def test_distant_same_geometry_direction_does_not_match(self):
        index = RoadIndex([road(offset=0.001)], "milan")
        row, status = index.match(projection([9.1805, 45.46], index.latitude), (1, 0), "bicycle")
        self.assertIsNone(row)
        self.assertEqual(status, "unmatched")

    def test_direction_and_access_rejected(self):
        for row in (road(direction="backward"), road(allowed=False)):
            index = RoadIndex([row], "milan")
            self.assertEqual(index.match(projection([9.1805, 45.46], index.latitude), (1, 0), "bicycle")[1], "access_or_direction_rejected")

    def test_parallel_ways_are_ambiguous_even_with_same_label(self):
        index = RoadIndex([road(), road(identifier="milan:2", offset=0.00001)], "milan")
        self.assertEqual(index.match(projection([9.1805, 45.46], index.latitude), (1, 0), "bicycle")[1], "ambiguous")

    def test_time_budget_is_hard(self):
        candidates = [{"id": "fast", "minutes": 10, "risk": 100}, {"id": "slow", "minutes": 15.01, "risk": 0}]
        self.assertEqual(choose_candidate(candidates, "risk")["id"], "fast")
        candidates[1]["minutes"] = 15
        self.assertEqual(choose_candidate(candidates, "risk")["id"], "slow")

    def test_masked_truth_and_unknown_predictions_are_separate(self):
        row = road()
        metrics = score_route({"coordinates": row["coordinates"]}, "bicycle", RoadIndex([row], "milan"), {row["id"]: 0.1}, {row["id"]: 0.9})
        self.assertGreater(metrics["heldout_pave_m"], 70)
        self.assertEqual(metrics["unknown_predicted_m"], 0)
        self.assertEqual(metrics["heldout_false_low_probability_m"], metrics["heldout_pave_m"])
        self.assertAlmostEqual(metrics["masked_added_risk_m"], metrics["heldout_m"] * 0.1, places=2)

    def test_roccella_archive_fallback_null_budget_and_checksum(self):
        route = {"coordinates": [[16.4, 38.32], [16.401, 38.32]], "minutes": 3, "paveMeters": 0, "unknownSurfaceMeters": 90}
        payload = {"fast": route, "safe": route, "mode": "bicycle", "appliedPreferences": {"maximumExtraMinutes": None},
                   "routingProfile": {"provider": "valhalla-fossgis", "profile": "bicycle"}}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "outputs/phase42-validation/test.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"payload": payload}))
            report = analyze_routes([], {}, {}, folder)
            self.assertEqual(report["summary"]["scenarios"], 1)
            scenario = report["scenarios"][0]
            self.assertEqual(scenario["area"], "roccella")
            self.assertEqual(scenario["budget_minutes"], 5)
            self.assertEqual(scenario["archive_sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertGreater(scenario["candidates"][0]["metrics"]["unmatched_m"], 80)

    def test_missing_profile_or_duration_is_not_invented(self):
        route = {"coordinates": [[16.4, 38.32], [16.401, 38.32]], "minutes": 3}
        payload = {"fast": route, "safe": route, "mode": "car"}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "outputs/phase42-validation/test.json"
            path.parent.mkdir(parents=True)
            for profile, minutes in (({}, 3), ({"provider": "valhalla-fossgis", "profile": "auto"}, None)):
                payload["routingProfile"] = profile
                route["minutes"] = minutes
                path.write_text(json.dumps({"payload": payload}))
                report = analyze_routes([], {}, {}, folder)
                self.assertEqual(report["summary"]["scenarios"], 0)
                self.assertEqual(len(report["skipped"]), 1)


if __name__ == "__main__":
    unittest.main()
