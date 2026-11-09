"""Metric formulas checked against hand-computed examples."""

import sys

sys.dont_write_bytecode = True
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from surfvis import metrics as M  # noqa: E402


class ClassificationMetricTests(unittest.TestCase):
    def setUp(self):
        self.y = [0, 0, 1, 1, 2]
        self.p = [0, 1, 1, 1, 0]
        self.cm = M.confusion_matrix(self.y, self.p, 3)

    def test_confusion_matrix(self):
        np.testing.assert_array_equal(self.cm, [[1, 1, 0], [0, 2, 0], [1, 0, 0]])

    def test_per_class_and_macro(self):
        rows = M.per_class_prf(self.cm, ["a", "b", "c"])
        self.assertAlmostEqual(rows[0]["precision"], 0.5)
        self.assertAlmostEqual(rows[0]["recall"], 0.5)
        self.assertAlmostEqual(rows[0]["f1"], 0.5)
        self.assertAlmostEqual(rows[1]["precision"], 2 / 3)
        self.assertAlmostEqual(rows[1]["recall"], 1.0)
        self.assertAlmostEqual(rows[1]["f1"], 0.8)
        self.assertEqual(rows[2]["predicted"], 0)
        self.assertFalse(rows[2]["precision_defined"])
        self.assertAlmostEqual(rows[2]["f1"], 0.0)
        self.assertAlmostEqual(M.macro_f1(self.cm), (0.5 + 0.8 + 0.0) / 3)
        self.assertAlmostEqual(M.accuracy(self.cm), 3 / 5)

    def test_macro_ignores_absent_classes(self):
        cm = M.confusion_matrix([0, 1], [0, 1], 3)
        self.assertAlmostEqual(M.macro_f1(cm), 1.0)

    def test_out_of_range_label(self):
        with self.assertRaises(ValueError):
            M.confusion_matrix([0, 3], [0, 1], 3)


class ProbabilisticMetricTests(unittest.TestCase):
    def test_brier_multiclass(self):
        proba = [[0.7, 0.2, 0.1], [0.1, 0.3, 0.6]]
        self.assertAlmostEqual(M.brier_multiclass(proba, [0, 1]), (0.14 + 0.86) / 2)

    def test_brier_binary(self):
        self.assertAlmostEqual(M.brier_binary([0.9, 0.2], [1, 0]), 0.025)

    def test_ece_hand_example(self):
        rel = M.reliability([0.9, 0.9, 0.6, 0.6], [1, 0, 1, 1], n_bins=10)
        self.assertAlmostEqual(rel["ece"], 0.4)
        self.assertAlmostEqual(rel["mce"], 0.4)
        self.assertEqual(rel["bins"][9]["count"], 2)
        self.assertEqual(rel["bins"][6]["count"], 2)
        self.assertAlmostEqual(rel["bins"][9]["accuracy"], 0.5)

    def test_ece_confidence_one_in_last_bin(self):
        rel = M.reliability([1.0, 1.0], [1, 1], n_bins=10)
        self.assertEqual(rel["bins"][9]["count"], 2)
        self.assertAlmostEqual(rel["ece"], 0.0)

    def test_perfectly_calibrated_bins_zero_ece(self):
        conf = [0.25] * 4 + [0.75] * 4
        ok = [1, 0, 0, 0] + [1, 1, 1, 0]
        self.assertAlmostEqual(M.reliability(conf, ok, 10)["ece"], 0.0)


class AbstentionTests(unittest.TestCase):
    def test_threshold_selection(self):
        sel = M.select_abstention_threshold([0.95, 0.9, 0.8, 0.7, 0.6], [1, 1, 1, 0, 0],
                                            target_accuracy=0.9, min_accepted=1)
        self.assertTrue(sel["reached"])
        self.assertAlmostEqual(sel["threshold"], 0.71)
        self.assertAlmostEqual(sel["calibration_coverage"], 0.6)
        self.assertAlmostEqual(sel["calibration_accuracy"], 1.0)

    def test_threshold_unreachable_abstains_everything(self):
        sel = M.select_abstention_threshold([0.9, 0.8], [0, 0], target_accuracy=0.9, min_accepted=1)
        self.assertFalse(sel["reached"])
        self.assertGreater(sel["threshold"], 1.0)

    def test_min_accepted_respected(self):
        sel = M.select_abstention_threshold([0.99, 0.5, 0.5], [1, 0, 0], target_accuracy=0.9, min_accepted=2)
        self.assertFalse(sel["reached"])

    def test_coverage_curve_monotone(self):
        rng = np.random.Generator(np.random.PCG64(3))
        conf = rng.random(200)
        ok = (rng.random(200) < conf).astype(float)
        cov = [r["coverage"] for r in M.coverage_accuracy_curve(conf, ok)]
        self.assertTrue(all(a >= b for a, b in zip(cov, cov[1:])))
        self.assertAlmostEqual(cov[0], 1.0)

    def test_precision_threshold(self):
        sel = M.select_precision_threshold([0.9, 0.8, 0.7, 0.4], [1, 1, 0, 0], target_precision=0.8, min_predicted=1)
        self.assertTrue(sel["reached"])
        self.assertAlmostEqual(sel["threshold"], 0.71)


class IntervalAndRankingTests(unittest.TestCase):
    def test_wilson_known_value(self):
        lo, hi = M.wilson_interval(5, 10)
        self.assertAlmostEqual(lo, 0.2366, places=4)
        self.assertAlmostEqual(hi, 0.7634, places=4)
        self.assertEqual(M.wilson_interval(0, 0), (None, None))
        lo0, hi0 = M.wilson_interval(0, 32)
        self.assertEqual(lo0, 0.0)
        self.assertLess(hi0, 0.12)

    def test_average_precision_hand_and_sklearn(self):
        # ranking: 0.9(+), 0.8(-), 0.7(+), 0.1(-) -> AP = 0.5*1 + 0.5*(2/3)
        self.assertAlmostEqual(M.average_precision([1, 0, 1, 0], [0.9, 0.8, 0.7, 0.1]), 0.5 + 1 / 3)
        from sklearn.metrics import average_precision_score
        rng = np.random.Generator(np.random.PCG64(4))
        y = (rng.random(300) < 0.2).astype(int)
        s = np.round(rng.random(300), 1)  # many ties
        self.assertAlmostEqual(M.average_precision(y, s), average_precision_score(y, s), places=12)
        self.assertIsNone(M.average_precision([0, 0], [0.1, 0.2]))

    def test_binary_report_counts(self):
        rep = M.binary_report([0.9, 0.6, 0.4, 0.2], [1, 0, 1, 0], threshold=0.5)
        self.assertEqual((rep["tp"], rep["fp"], rep["fn"], rep["tn"]), (1, 1, 1, 1))
        self.assertAlmostEqual(rep["precision"], 0.5)
        self.assertAlmostEqual(rep["recall"], 0.5)
        self.assertAlmostEqual(rep["brier"], (0.01 + 0.36 + 0.36 + 0.04) / 4)


if __name__ == "__main__":
    unittest.main()
