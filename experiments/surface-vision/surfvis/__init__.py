"""Lastrico Phase 4.20 — offline road-surface vision experiment (developer-only).

Nothing in this package is imported by the app, the Worker or production routing.
Predictions produced here are experimental and must never be presented as verified
surface evidence.
"""

CLASSES = ("asphalt", "concrete", "paving_stones", "sett", "unpaved")
PAVE_CLASS = "sett"  # Lastrico "pavé" ~ OSM surface=sett (regular cut stones)
FEATURE_VERSION = "fv1"
WORK_SIZE = (256, 192)  # (width, height) after crop + resize
