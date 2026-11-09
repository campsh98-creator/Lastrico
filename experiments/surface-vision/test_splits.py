"""Geographic split correctness: partition, zero leakage, purges, determinism."""

import sys

sys.dont_write_bytecode = True
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from surfvis import splits as S  # noqa: E402


def _toy(seed=11, n_cells=12, per_cell=30, n_classes=5, test_cells=(10, 11)):
    rng = np.random.Generator(np.random.PCG64(seed))
    lat, lon, lab, test = [], [], [], []
    for c in range(n_cells):
        la0, lo0 = 44.0 + (c // 4) * 1.0, 8.0 + (c % 4) * 1.0  # one 0.5° cell per region
        for k in range(per_cell):
            lat.append(la0 + 0.05 + rng.uniform(0, 0.4))
            lon.append(lo0 + 0.05 + rng.uniform(0, 0.4))
            lab.append(int(k % n_classes))
            test.append(c in test_cells)
    return np.array(lat), np.array(lon), np.array(lab), np.array(test)


class CellAndDistanceTests(unittest.TestCase):
    def test_cell_ids(self):
        self.assertEqual(S.cell_ids([45.2], [9.1], 0.5), ["0.5:90:18"])
        self.assertEqual(S.cell_ids([-0.1], [-0.1], 0.5), ["0.5:-1:-1"])

    def test_haversine_one_degree_latitude(self):
        d = S.haversine_min_km([45.0], [9.0], [46.0], [9.0])
        self.assertAlmostEqual(float(d[0]), np.pi / 180 * S.EARTH_RADIUS_KM, places=6)

    def test_haversine_nearest(self):
        d = S.haversine_min_km([0.0, 0.0], [0.0, 1.0], [0.0, 0.0], [0.5, 3.0])
        self.assertAlmostEqual(float(d[0]), float(d[1]), places=9)


class SplitTests(unittest.TestCase):
    def setUp(self):
        self.lat, self.lon, self.lab, self.test = _toy()
        self.split = S.geographic_split(self.lat, self.lon, self.lab, self.test, min_per_class=10)

    def test_partition_and_zero_leakage(self):
        sp = self.split
        parts = [sp["train"], sp["calibration"], sp["test"], sp["purged"]]
        allidx = np.concatenate(parts)
        self.assertEqual(allidx.size, self.lat.size)
        self.assertEqual(np.unique(allidx).size, self.lat.size)
        ids = [f"img{i}" for i in range(self.lat.size)]
        rep = S.leakage_report(sp, self.lat, self.lon, ids)
        self.assertEqual(rep["image_level_leakage_total"], 0)
        self.assertEqual(rep["cell_level_leakage_total"], 0)
        self.assertGreaterEqual(rep["train__calibration"]["min_distance_km"], sp["summary"]["buffer_km"])
        self.assertGreaterEqual(rep["train__test"]["min_distance_km"], sp["summary"]["buffer_km"])

    def test_test_set_is_exactly_flagged_images(self):
        np.testing.assert_array_equal(self.split["test"], np.flatnonzero(self.test))

    def test_calibration_has_every_class(self):
        counts = self.split["summary"]["class_counts"]["calibration"]
        for c in range(5):
            self.assertGreaterEqual(counts.get(str(c), 0), 10)

    def test_deterministic_and_salt_dependent(self):
        again = S.geographic_split(self.lat, self.lon, self.lab, self.test, min_per_class=10)
        for k in ("train", "calibration", "test", "purged"):
            np.testing.assert_array_equal(self.split[k], again[k])
        variants = {tuple(S.geographic_split(self.lat, self.lon, self.lab, self.test, salt=f"s{i}")["calibration"])
                    for i in range(6)}
        self.assertGreater(len(variants), 1)

    def test_test_cell_purge(self):
        lat, lon, lab, test = _toy()
        # add a training-pool image inside a test cell
        t0 = int(np.flatnonzero(test)[0])
        lat2, lon2 = np.r_[lat, lat[t0] + 0.01], np.r_[lon, lon[t0] + 0.01]
        lab2, test2 = np.r_[lab, 0], np.r_[test, False]
        sp = S.geographic_split(lat2, lon2, lab2, test2)
        self.assertIn(lat2.size - 1, sp["purged"].tolist())
        self.assertGreaterEqual(sp["summary"]["n_purged_test_cells"], 1)

    def test_boundary_buffer_purge(self):
        # two pool cells touching at lon 9.0; one train point 1 km from a calibration point
        lat = np.array([45.2] * 20 + [45.2] * 20 + [47.2] * 10)
        lon = np.r_[np.linspace(8.6, 8.99, 20), np.linspace(9.0, 9.4, 20), np.linspace(9.0, 9.4, 10)]
        lab = np.r_[np.arange(20) % 2, np.arange(20) % 2, np.arange(10) % 2]
        test = np.r_[np.zeros(40, bool), np.ones(10, bool)]
        sp = S.geographic_split(lat, lon, lab, test, cal_fraction=0.4, min_per_class=1, buffer_km=2.0)
        rep = S.leakage_report(sp, lat, lon, [str(i) for i in range(lat.size)])
        self.assertGreaterEqual(rep["train__calibration"]["min_distance_km"], 2.0)
        self.assertGreater(sp["summary"]["n_purged_buffer_train"], 0)

    def test_leakage_detector_is_not_vacuous(self):
        sp = dict(self.split)
        sp["calibration"] = np.r_[self.split["calibration"], self.split["train"][:3]]
        rep = S.leakage_report(sp, self.lat, self.lon, [f"img{i}" for i in range(self.lat.size)])
        self.assertGreater(rep["image_level_leakage_total"], 0)
        self.assertGreater(rep["cell_level_leakage_total"], 0)

    def test_contributor_diagnostics(self):
        users = [f"u{i % 7}" for i in range(self.lat.size)]
        rep = S.leakage_report(self.split, self.lat, self.lon, [str(i) for i in range(self.lat.size)], users)
        self.assertIn("shared_contributors", rep["train__test"])
        self.assertGreater(rep["train__test"]["fraction_test_images_by_contributor_seen_in_train"], 0.0)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            S.geographic_split([np.nan], [9.0], [0], [False])
        with self.assertRaises(ValueError):
            S.geographic_split([45.0, 46.0], [9.0], [0, 1], [False, True])


if __name__ == "__main__":
    unittest.main()
