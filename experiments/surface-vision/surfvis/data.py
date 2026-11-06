"""Dataset adapters, approved-download manifest and integrity checks.

Downloaded files are untrusted data: images are only decoded by Pillow, archives
are read in place (never extracted), and nothing inside them is executed.
"""

from __future__ import annotations

import csv
import hashlib
import io
import shutil
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import CLASSES

ZENODO_RECORD = "11449977"
ZENODO_DOI = "10.5281/zenodo.11449977"

# Exact files, sizes and MD5 as published by the Zenodo API for record 11449977
# (verified 2026-11-05). Nothing is downloaded unless run.py is called with --fetch
# after the owner has approved the exact files.
STREETSURFACEVIS_FILES = {
    "csv": {"name": "streetSurfaceVis_v1_0.csv", "size": 967208, "md5": "a6ac6ab1edf7d813ebe7ffb22b922423"},
    "256": {"name": "s_256.zip", "size": 99052992, "md5": "d2beab4af8f3995bc8789ba27645ddc0"},
    "1024": {"name": "s_1024.zip", "size": 1283338088, "md5": "3a32ab4f5f2992a267c4274179717c77"},
    "2048": {"name": "s_2048.zip", "size": 4476691714, "md5": "909b5cb41de03b74f8e09a0c714b9af3"},
}
ALLOWED_FETCH_VARIANTS = ("256", "1024")  # 2048/original are never fetched by this code


def zenodo_url(name: str) -> str:
    return f"https://zenodo.org/api/records/{ZENODO_RECORD}/files/{name}/content"


IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
MAX_MEMBER_BYTES = 60 * 1024 * 1024


@dataclass
class Record:
    image_id: str
    label: str
    lat: float
    lon: float
    is_test: bool
    contributor: str = ""
    quality: str = ""
    source: object = None  # path, (zip_path, member) or ndarray
    extra: dict = field(default_factory=dict)


# --------------------------------------------------------------------------- hashing

def file_digest(path, algo: str = "sha256", chunk: int = 1 << 20) -> str:
    h = hashlib.new(algo)
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def verify_file(path, expected_size: int, expected_md5: str) -> dict:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(p)
    size = p.stat().st_size
    if size != expected_size:
        raise ValueError(f"size mismatch for {p.name}: {size} != {expected_size}")
    md5 = file_digest(p, "md5")
    if md5 != expected_md5:
        raise ValueError(f"md5 mismatch for {p.name}: {md5} != {expected_md5}")
    return {"name": p.name, "size": size, "md5": md5, "sha256": file_digest(p, "sha256")}


# --------------------------------------------------------------------------- fetch (phase 2 only)

def fetch_approved(data_dir, variant: str, margin_bytes: int = 2 * 1024 ** 3) -> list[dict]:
    """Download the CSV and one image archive variant from Zenodo, verifying size+MD5.

    Only call this after explicit owner approval of the exact files.
    """
    if variant not in ALLOWED_FETCH_VARIANTS:
        raise ValueError(f"variant {variant!r} not approved for fetching")
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for key in ("csv", variant):
        spec = STREETSURFACEVIS_FILES[key]
        dest = data_dir / spec["name"]
        if dest.exists():
            out.append(verify_file(dest, spec["size"], spec["md5"]))
            continue
        free = shutil.disk_usage(data_dir).free
        if free < spec["size"] + margin_bytes:
            raise OSError(f"not enough free disk for {spec['name']}: {free} bytes free")
        part = dest.with_suffix(dest.suffix + ".part")
        req = urllib.request.Request(zenodo_url(spec["name"]), headers={"User-Agent": "lastrico-phase420-research"})
        with urllib.request.urlopen(req, timeout=60) as resp, open(part, "wb") as fh:  # noqa: S310 (fixed https URL)
            shutil.copyfileobj(resp, fh, length=1 << 20)
        info = verify_file(part, spec["size"], spec["md5"])
        part.rename(dest)
        info["name"] = dest.name
        out.append(info)
    return out


# --------------------------------------------------------------------------- StreetSurfaceVis

def normalise_label(s: str) -> str:
    return s.strip().lower().replace(" ", "_")


def _parse_bool(s: str) -> bool:
    v = s.strip().lower()
    if v in ("true", "1", "yes"):
        return True
    if v in ("false", "0", "no"):
        return False
    raise ValueError(f"bad boolean {s!r}")


def index_zip_images(zip_path) -> dict:
    """Map image stem -> member name. Ambiguous stems raise; directories and
    macOS metadata entries are ignored."""
    idx = {}
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename
            if info.is_dir() or "__MACOSX" in name or Path(name).name.startswith("._"):
                continue
            p = Path(name)
            if p.suffix.lower() not in IMAGE_EXTS:
                continue
            if info.file_size > MAX_MEMBER_BYTES:
                raise ValueError(f"member too large: {name}")
            stem = p.stem
            if stem in idx:
                raise ValueError(f"duplicate image stem in archive: {stem}")
            idx[stem] = name
    return idx


def load_streetsurfacevis(csv_path, zip_path=None) -> tuple[list[Record], dict]:
    required = {"mapillary_image_id", "user_id", "captured_at", "longitude", "latitude",
                "train", "surface_type", "surface_quality"}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV missing columns: {sorted(missing)}")
        rows = list(reader)
    zindex = index_zip_images(zip_path) if zip_path is not None else {}
    records, unknown_labels, missing_images = [], {}, 0
    for r in rows:
        label = normalise_label(r["surface_type"])
        if label not in CLASSES:
            unknown_labels[label] = unknown_labels.get(label, 0) + 1
            continue
        iid = r["mapillary_image_id"].strip()
        source = None
        if zip_path is not None:
            member = zindex.get(iid)
            if member is None:
                missing_images += 1
                continue
            source = (str(zip_path), member)
        records.append(Record(
            image_id=iid, label=label, lat=float(r["latitude"]), lon=float(r["longitude"]),
            is_test=not _parse_bool(r["train"]), contributor=r["user_id"].strip(),
            quality=normalise_label(r.get("surface_quality", "") or ""), source=source,
            extra={"captured_at": r["captured_at"]},
        ))
    info = {"rows": len(rows), "records": len(records), "unknown_labels": unknown_labels,
            "missing_images": missing_images, "zip_members_indexed": len(zindex)}
    return records, info


def load_manifest(csv_path) -> tuple[list[Record], dict]:
    """Generic manifest for future (e.g. Italian, human-labelled) evaluation sets.

    Columns: image_id,path,label,lat,lon,is_test[,contributor]. Paths are relative
    to the manifest directory.
    """
    base = Path(csv_path).resolve().parent
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    records = []
    for r in rows:
        label = normalise_label(r["label"])
        if label not in CLASSES:
            raise ValueError(f"unknown label {label!r}")
        records.append(Record(image_id=r["image_id"], label=label, lat=float(r["lat"]), lon=float(r["lon"]),
                              is_test=_parse_bool(r["is_test"]), contributor=r.get("contributor", ""),
                              source=str((base / r["path"]).resolve())))
    return records, {"rows": len(rows), "records": len(records)}


class ImageReader:
    """Reads image bytes for a Record; keeps zip handles open for speed."""

    def __init__(self):
        self._zips: dict[str, zipfile.ZipFile] = {}

    def read(self, rec: Record):
        src = rec.source
        if isinstance(src, tuple):
            zpath, member = src
            zf = self._zips.get(zpath)
            if zf is None:
                zf = self._zips[zpath] = zipfile.ZipFile(zpath)
            return zf.read(member)
        if isinstance(src, (str, Path)):
            return Path(src).read_bytes()
        return src  # ndarray (synthetic)

    def close(self):
        for zf in self._zips.values():
            zf.close()
        self._zips.clear()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def write_streetsurfacevis_like_csv(path, rows: list[dict]):
    """Test helper: write a CSV with the documented StreetSurfaceVis columns."""
    cols = ["mapillary_image_id", "user_id", "user_name", "captured_at", "longitude", "latitude",
            "train", "surface_type", "surface_quality"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols)
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in cols})
    Path(path).write_text(buf.getvalue(), encoding="utf-8")
