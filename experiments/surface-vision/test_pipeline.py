"""End-to-end plumbing tests on SYNTHETIC textures plus dataset-adapter tests.

Nothing here measures real accuracy. The synthetic classes are trivially
separable by construction; the score checks below only detect label
misalignment or leakage bugs (a shuffled-label negative control must collapse).
"""

import hashlib
import io
import json
import sys

sys.dont_write_bytecode = True
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from surfvis import CLASSES  # noqa: E402
from surfvis import data as D  # noqa: E402
from surfvis import pipeline as P  # noqa: E402
from surfvis.imageio import load_focal_rgb  # noqa: E402
from surfvis.synthetic import synth_texture, synthetic_records  # noqa: E402


def _jpeg(arr):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class AdapterTests(unittest.TestCase):
    def test_streetsurfacevis_csv_and_zip(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            rows = [
                dict(mapillary_image_id="101", user_id="7", user_name="a", captured_at="1600000000000",
                     longitude="13.4", latitude="52.5", train="True", surface_type="asphalt", surface_quality="good"),
                dict(mapillary_image_id="102", user_id="8", user_name="b", captured_at="1600000000001",
                     longitude="9.9", latitude="53.5", train="False", surface_type="paving stones",
                     surface_quality="intermediate"),
                dict(mapillary_image_id="103", user_id="9", user_name="c", captured_at="1600000000002",
                     longitude="11.5", latitude="48.1", train="True", surface_type="sett", surface_quality="bad"),
            ]
            D.write_streetsurfacevis_like_csv(td / "labels.csv", rows)
            with zipfile.ZipFile(td / "s_1024.zip", "w") as zf:
                zf.writestr("s_1024/101.jpg", _jpeg(synth_texture("asphalt", 1)))
                zf.writestr("s_1024/102.jpg", _jpeg(synth_texture("paving_stones", 2)))
                zf.writestr("__MACOSX/s_1024/._101.jpg", b"junk")
                zf.writestr("s_1024/readme.txt", b"not an image")
            recs, info = D.load_streetsurfacevis(td / "labels.csv", td / "s_1024.zip")
            self.assertEqual(info["missing_images"], 1)  # 103 absent from archive
            self.assertEqual(info["zip_members_indexed"], 2)
            self.assertEqual([r.image_id for r in recs], ["101", "102"])
            self.assertEqual(recs[1].label, "paving_stones")
            self.assertTrue(recs[1].is_test)
            self.assertFalse(recs[0].is_test)
            self.assertEqual(recs[0].contributor, "7")
            with D.ImageReader() as rd:
                rgb = load_focal_rgb(rd.read(recs[0]))
            self.assertEqual(rgb.shape, (192, 256, 3))

    def test_duplicate_stems_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            z = Path(td) / "a.zip"
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("a/1.jpg", b"x")
                zf.writestr("b/1.jpg", b"y")
            with self.assertRaises(ValueError):
                D.index_zip_images(z)

    def test_missing_columns_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "bad.csv"
            p.write_text("mapillary_image_id,surface_type\n1,asphalt\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                D.load_streetsurfacevis(p)

    def test_verify_file(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "f.bin"
            p.write_bytes(b"lastrico" * 100)
            md5 = hashlib.md5(p.read_bytes()).hexdigest()
            info = D.verify_file(p, 800, md5)
            self.assertEqual(info["sha256"], hashlib.sha256(p.read_bytes()).hexdigest())
            with self.assertRaises(ValueError):
                D.verify_file(p, 801, md5)
            with self.assertRaises(ValueError):
                D.verify_file(p, 800, "0" * 32)

    def test_fetch_refuses_unapproved_variants_offline(self):
        with tempfile.TemporaryDirectory() as td:
            for v in ("2048", "original", "s_original.zip"):
                with self.assertRaises(ValueError):
                    D.fetch_approved(td, v)
            self.assertEqual(list(Path(td).iterdir()), [])

    def test_manifest_matches_published_zenodo_listing(self):
        self.assertEqual(D.STREETSURFACEVIS_FILES["1024"]["size"], 1283338088)
        self.assertEqual(D.STREETSURFACEVIS_FILES["256"]["size"], 99052992)
        self.assertEqual(D.STREETSURFACEVIS_FILES["csv"]["size"], 967208)
        self.assertTrue(D.zenodo_url("s_1024.zip").startswith("https://zenodo.org/api/records/11449977/"))


class SyntheticPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = synthetic_records(n_regions=6, per_class=5, test_regions=(4, 5))
        cls.X, cls.names, cls.cmask, ok, failures, _ = P.extract_features(cls.records)
        assert not failures and ok.size == len(cls.records)
        cls.cfg = {"min_per_class": 5}
        cls.result, _ = P.run_experiment(cls.records, cls.X, cls.names, cls.cmask, cls.cfg, "SYNTHETIC_CODE_TEST")

    def test_structure_and_zero_leakage(self):
        r = self.result
        self.assertEqual(r["kind"], "SYNTHETIC_CODE_TEST")
        self.assertEqual(r["leakage"]["image_level_leakage_total"], 0)
        self.assertEqual(r["leakage"]["cell_level_leakage_total"], 0)
        self.assertEqual(set(r["models"]), {"majority", "colour_logistic", "texture_logistic", "texture_hgb"})
        n_test = sum(rec.is_test for rec in self.records)
        for m in r["models"].values():
            self.assertEqual(m["test"]["n"], n_test)
            self.assertEqual(len(m["test"]["per_class"]), len(CLASSES))
            self.assertEqual(np.asarray(m["test"]["confusion_matrix"]["rows_true_cols_pred"]).sum(), n_test)
            self.assertTrue(0.0 <= m["test"]["ece_top_label"] <= 1.0)
            self.assertTrue(0.0 <= m["test"]["brier_multiclass"] <= 2.0)
        json.dumps(r)  # serialisable

    def test_deterministic_rerun(self):
        again, _ = P.run_experiment(self.records, self.X, self.names, self.cmask, self.cfg, "SYNTHETIC_CODE_TEST")
        self.assertEqual(json.dumps(self.result, sort_keys=True), json.dumps(again, sort_keys=True))

    def test_majority_baseline_is_prior(self):
        m = self.result["models"]["majority"]["test"]
        self.assertAlmostEqual(m["accuracy"], 1 / len(CLASSES))  # balanced synthetic test set

    def test_label_alignment_plumbing(self):
        # Trivially separable synthetic classes: a low score here would indicate a bug.
        self.assertGreaterEqual(self.result["models"]["texture_hgb"]["test"]["macro_f1"], 0.8)

    def test_shuffled_label_negative_control(self):
        rng = np.random.Generator(np.random.PCG64(99))
        shuffled = [r for r in self.records]
        train_like = [i for i, r in enumerate(shuffled) if not r.is_test]
        perm_labels = rng.permutation([shuffled[i].label for i in train_like])
        recs = list(self.records)
        for i, lab in zip(train_like, perm_labels):
            r = recs[i]
            recs[i] = D.Record(r.image_id, str(lab), r.lat, r.lon, r.is_test, r.contributor, r.quality, r.source)
        res, _ = P.run_experiment(recs, self.X, self.names, self.cmask, self.cfg, "SYNTHETIC_SHUFFLED")
        self.assertLess(res["models"]["texture_hgb"]["test"]["macro_f1"], 0.5)

    def test_criteria_check_present(self):
        cc = self.result["criteria_check"]
        self.assertIn("all_met", cc)
        self.assertTrue(cc["zero_leakage"])

    def test_feature_cache_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            cache = Path(td) / "f.npz"
            recs = self.records[:5]
            a = P.load_or_extract(recs, cache)
            b = P.load_or_extract(recs, cache)
            self.assertFalse(a[6])
            self.assertTrue(b[6])
            np.testing.assert_array_equal(a[0], b[0])
            self.assertEqual(a[1], b[1])


if __name__ == "__main__":
    unittest.main()
