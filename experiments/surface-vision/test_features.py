"""Code-correctness tests for image loading and features (synthetic inputs only)."""

import colorsys
import io
import sys

sys.dont_write_bytecode = True
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from surfvis import CLASSES, WORK_SIZE  # noqa: E402
from surfvis import features as F  # noqa: E402
from surfvis.imageio import load_focal_rgb  # noqa: E402
from surfvis.synthetic import synth_texture  # noqa: E402


class GLCMTests(unittest.TestCase):
    def test_counts_match_textbook_example(self):
        # Classic Haralick example (also used in scikit-image docs), distance 1, angle 0.
        img = np.array([[0, 0, 1, 1], [0, 0, 1, 1], [0, 2, 2, 2], [2, 2, 3, 3]])
        expected = np.array([[2, 2, 1, 0], [0, 2, 0, 0], [0, 0, 3, 1], [0, 0, 0, 1]], dtype=float)
        np.testing.assert_array_equal(F.glcm_counts(img, 0, 1, 4), expected)
        # 90 degrees "up" (dy=-1): pairs (r, c) -> (r-1, c)
        up = F.glcm_counts(img, -1, 0, 4)
        self.assertEqual(up.sum(), 12)

    def test_props_hand_computed(self):
        p = F.glcm_props(np.array([[2.0, 0.0], [0.0, 2.0]]))
        self.assertAlmostEqual(p["contrast"], 0.0)
        self.assertAlmostEqual(p["homogeneity"], 1.0)
        self.assertAlmostEqual(p["energy"], np.sqrt(0.5))
        self.assertAlmostEqual(p["correlation"], 1.0)
        self.assertAlmostEqual(p["entropy"], 1.0)
        q = F.glcm_props(np.array([[0.0, 2.0], [0.0, 0.0]]))
        self.assertAlmostEqual(q["contrast"], 1.0)
        self.assertAlmostEqual(q["homogeneity"], 0.5)
        self.assertAlmostEqual(q["correlation"], -1.0)
        self.assertAlmostEqual(q["entropy"], 1.0)

    def test_constant_image_is_finite(self):
        v, n = F.glcm_features(np.full((40, 40), 0.5))
        self.assertTrue(np.all(np.isfinite(v)))
        self.assertEqual(len(v), len(n))


class LBPTests(unittest.TestCase):
    def test_uniform_lut(self):
        lut = F.UNIFORM_LUT
        self.assertEqual(lut[0], 0)
        self.assertEqual(lut[255], 8)
        self.assertEqual(lut[0b00001111], 4)
        self.assertEqual(lut[0b10000001], 2)  # circularly uniform
        self.assertEqual(lut[0b01010101], 9)  # non-uniform
        self.assertEqual(int(np.sum(lut < 9)), 58)  # 58 uniform patterns for P=8

    def test_constant_image_all_ones_code(self):
        h = F.lbp_histogram(np.full((20, 20), 0.3), 1)
        self.assertAlmostEqual(h[8], 1.0)
        self.assertAlmostEqual(h.sum(), 1.0)


class GradientAndFFTTests(unittest.TestCase):
    def test_vertical_stripes_orientation_bin0(self):
        x = np.arange(64)
        g = np.tile((np.sin(2 * np.pi * x / 8) + 1) / 2, (48, 1))
        gx, gy = F.sobel(F.standardise(g))
        hist = F.orientation_histogram(gx, gy)
        self.assertAlmostEqual(hist[0], 1.0, places=9)

    def test_fft_band_of_periodic_pattern(self):
        x = np.arange(256)
        g = np.tile((np.sin(2 * np.pi * x / 16) + 1) / 2, (192, 1))  # 1/16 = 0.0625 cycles/px
        v, n = F.fft_features(g)
        bands = [(name, val) for name, val in zip(n, v) if name.startswith("fft_band_")]
        self.assertEqual(max(bands, key=lambda t: t[1])[0], "fft_band_0.04_0.08")
        self.assertGreater(dict(zip(n, v))["fft_orthogonal_pair"], 0.9)

    def test_box_blur_matches_naive(self):
        rng = np.random.Generator(np.random.PCG64(1))
        a = rng.random((9, 11))
        out = F.box_blur(a, 3)
        p = np.pad(a, 1, mode="edge")
        naive = np.array([[p[i:i + 3, j:j + 3].mean() for j in range(11)] for i in range(9)])
        np.testing.assert_allclose(out, naive, atol=1e-12)

    def test_hsv_matches_colorsys(self):
        rng = np.random.Generator(np.random.PCG64(2))
        x = rng.random((50, 3))
        h, s, v = F.rgb_to_hsv(x)
        for i in range(50):
            eh, es, ev = colorsys.rgb_to_hsv(*x[i])
            self.assertAlmostEqual(h[i], eh, places=9)
            self.assertAlmostEqual(s[i], es, places=9)
            self.assertAlmostEqual(v[i], ev, places=9)


class ExtractTests(unittest.TestCase):
    def test_shape_names_determinism(self):
        names, mask = F.feature_names()
        rgb = load_focal_rgb(synth_texture("sett", 7))
        v1, n1, m1 = F.extract(rgb)
        v2, _, _ = F.extract(rgb.copy())
        self.assertEqual(n1, names)
        self.assertEqual(v1.shape, (len(names),))
        np.testing.assert_array_equal(m1, mask)
        np.testing.assert_array_equal(v1, v2)
        self.assertTrue(np.all(np.isfinite(v1)))
        self.assertEqual(len(set(names)), len(names))
        self.assertGreater(int(mask.sum()), 0)
        self.assertLess(int(mask.sum()), len(names))

    def test_all_synthetic_classes_finite_and_distinct(self):
        vecs = []
        for i, c in enumerate(CLASSES):
            v, _, _ = F.extract(load_focal_rgb(synth_texture(c, 100 + i)))
            self.assertTrue(np.all(np.isfinite(v)), c)
            vecs.append(v)
        self.assertEqual(len({v.tobytes() for v in vecs}), len(CLASSES))

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            F.extract(np.zeros((64, 64), dtype=np.uint8))
        with self.assertRaises(ValueError):
            F.extract(np.zeros((10, 10, 3), dtype=np.uint8))


class ImageIOTests(unittest.TestCase):
    def _two_colour(self, w, h):
        a = np.zeros((h, w, 3), dtype=np.uint8)
        a[..., 2] = 255  # blue everywhere
        a[h // 2:, w // 4: 3 * w // 4] = (255, 0, 0)  # red focal area
        return a

    def test_png_focal_crop_exact(self):
        buf = io.BytesIO()
        Image.fromarray(self._two_colour(512, 384)).save(buf, format="PNG")
        out = load_focal_rgb(buf.getvalue())
        self.assertEqual(out.shape, (WORK_SIZE[1], WORK_SIZE[0], 3))
        self.assertTrue(np.all(out == np.array([255, 0, 0], dtype=np.uint8)))

    def test_jpeg_draft_path_shape_and_content(self):
        buf = io.BytesIO()
        Image.fromarray(self._two_colour(1024, 768)).save(buf, format="JPEG", quality=95)
        a = load_focal_rgb(buf.getvalue())
        b = load_focal_rgb(buf.getvalue())
        self.assertEqual(a.shape, (192, 256, 3))
        np.testing.assert_array_equal(a, b)  # deterministic decode
        inner = a[8:-8, 8:-8].astype(int)
        self.assertGreater(inner[..., 0].mean(), 230)
        self.assertLess(inner[..., 2].mean(), 25)


class SyntheticTests(unittest.TestCase):
    def test_seeded_determinism(self):
        for c in CLASSES:
            np.testing.assert_array_equal(synth_texture(c, 5), synth_texture(c, 5))
            self.assertFalse(np.array_equal(synth_texture(c, 5), synth_texture(c, 6)))


if __name__ == "__main__":
    unittest.main()
