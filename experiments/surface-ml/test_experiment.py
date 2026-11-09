import copy
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from run import BUFFER_M, ROOT, calibration_threshold, features, geographic_sector, metrics, xy


def row(points, area="milan"):
    return {"area": area, "coordinates": points, "length_m": 100, "features": {"highway": "residential"}, "label": 1, "id": "milan:1"}


class ExperimentTests(unittest.TestCase):
    def test_feature_allowlist_ignores_label_and_direct_proxies(self):
        original = row([[9.16, 45.44], [9.161, 45.441]])
        mutated = copy.deepcopy(original)
        mutated.update(label=0, id="other", material="asphalt", confidence=1, roughness=0)
        mutated["features"].update(surface="asphalt", tracktype="grade1", smoothness="excellent", name="Pave Street")
        self.assertEqual(features(original), features(mutated))

    def test_entire_way_is_purged_not_centroid(self):
        self.assertIsNone(geographic_sector(row([[9.15, 45.44], [9.20, 45.44]])))
        self.assertIsNone(geographic_sector(row([[9.18, 45.4649], [9.18, 45.45]])))
        self.assertEqual(geographic_sector(row([[9.15, 45.44], [9.16, 45.45]])), "SW")
        self.assertIsNone(geographic_sector(row([[16.4, 38.32], [16.41, 38.33]], "roccella")))

    def test_boundary_distance_in_metres(self):
        self.assertGreater(abs(xy([[9.18, 45.46]])[0, 0]), BUFFER_M)
        self.assertIsNone(geographic_sector(row([[9.184, 45.44], [9.184, 45.441]])))

    def test_calibration_and_absent_positive_semantics(self):
        result = metrics([0, 1, 0, 1], [.1, .9, .1, .9])
        self.assertAlmostEqual(result["brier"], .01)
        self.assertAlmostEqual(result["ece_10_bins"], .1)
        self.assertEqual(result["confusion_matrix_tn_fp_fn_tp"], [[2, 0], [0, 2]])
        self.assertIsNone(metrics([0, 0], [.1, .8])["recall"])
        self.assertEqual(metrics([0, 0], [.1, .8])["confusion_matrix_tn_fp_fn_tp"], [[1, 1], [0, 0]])

    def test_threshold_selected_on_calibration_not_test(self):
        threshold = calibration_threshold([0, 0, 1, 1], [.01, .02, .1, .2])
        self.assertEqual(threshold, .1)
        # Unseen geography may fail at this threshold: do not re-optimize it.
        result = metrics([1, 0], [.01, .3], threshold=threshold)
        self.assertEqual(result["confusion_matrix_tn_fp_fn_tp"], [[0, 1], [1, 0]])

    def test_corrupt_archive_fails_before_modeling(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Path(directory) / 'data/sources'
            sources.mkdir(parents=True)
            archive = gzip.compress(b'{"elements": []}')
            (sources / 'test.gz').write_bytes(archive)
            (sources / 'milan-pilot-osm.source.json').write_text(json.dumps({"sources": [{"file": "test.gz", "sha256": hashlib.sha256(b'wrong').hexdigest()}]}))
            script = "import {exportDataset} from './experiments/surface-ml/export.mjs'; exportDataset(process.argv[1]);"
            result = subprocess.run(["node", "--input-type=module", "-e", script, directory], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Archive checksum mismatch', result.stderr)

    def test_actual_exporter_unknown_and_label_gates(self):
        script = """
        import { target, genuinelyUnknown, allowedFeatures } from './experiments/surface-ml/export.mjs';
        const tags=[{}, {surface:'paved'}, {surface:'paving_stones'}, {surface:'sett'}, {surface:'asphalt'}, {tracktype:'grade1'}, {'cycleway:surface':'asphalt'}, {smoothness:'good'}];
        console.log(JSON.stringify(tags.map(t=>[target(t),genuinelyUnknown(t),allowedFeatures(t)])));
        """
        result = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT))
        self.assertEqual([r[:2] for r in result], [[None, True], [None, False], [None, False], [1, False], [0, False], [None, False], [None, False], [None, False]])
        for _, _, feature in result:
            self.assertFalse(any("surface" in key or key in ("smoothness", "tracktype") for key in feature))


if __name__ == "__main__":
    unittest.main()
