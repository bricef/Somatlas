"""Shared knowledge about the Z-Anatomy Blender file.

Defined once here and used by both the audit and the export, so the two can
never disagree about which objects are anatomy, which layer and system they
belong to, or how they behave in the X-ray scanner.
"""

from __future__ import annotations

import re
import unicodedata

# Upstream source, pinned for reproducibility.
ZANATOMY_REPO = "https://github.com/Z-Anatomy/Models-of-human-anatomy"
ZANATOMY_COMMIT = "a37dbd96a32bd69315a82190bef049cc549399ad"

# Suffixes Z-Anatomy uses for non-anatomy helper objects:
#   .j / .i  two-vertex leader lines for labels
#   .g       group title text meshes
#   .t       text labels (FONT objects)
HELPER_SUFFIXES = (".j", ".i", ".g", ".t")

# Top-level collections that are not anatomy at all.
NON_ANATOMY_COLLECTIONS = {
    "2: Muscular insertions",  # origin/insertion surface patches, not volumes
    "Reference lines, reference planes, movements",
    "Cross section planes",
}

# Top-level collection -> fallback system when no finer collection matches.
TOP_COLLECTION_SYSTEM = {
    "1: Skeletal system": "skeletal",
    "3: Joints": "skeletal",
    "4: Muscular system": "muscular",
    "5: Cardiovascular system": "cardiovascular",
    "6: Lymphoid organs": "lymphatic",
    "7: Nervous system & Sense organs": "nervous",
    "8: Visceral systems": "visceral",
    "9: Regions of human body": "integumentary",
}

# Finer "Bonus collection" groupings -> system.
SUBCOLLECTION_SYSTEM = {
    "Axial skeleton": "skeletal",
    "Appendicular skeleton": "skeletal",
    "Cranium": "skeletal",
    "Extracranial bones of head": "skeletal",
    "Auditory ossicles": "skeletal",
    "Teeth": "skeletal",
    "Vertebral column": "skeletal",
    "Thoracic skeleton": "skeletal",
    "Bones of upper limb": "skeletal",
    "Bony pelvis": "skeletal",
    "Bones of lower limb": "skeletal",
    "Cartilages": "skeletal",
    "Superficial muscles": "muscular",
    "Muscles": "muscular",
    "Fascia": "muscular",
    "Tendon sheaths": "muscular",
    "Abdominal part of muscular system": "muscular",
    "Bursae": "muscular",
    "Systemic arteries": "cardiovascular",
    "Systemic veins": "cardiovascular",
    "Heart": "cardiovascular",
    "Central nervous system": "nervous",
    "Peripheral nervous system": "nervous",
    "Sense organs": "nervous",
    "Digestive system": "digestive",
    "Respiratory system": "respiratory",
    "Urinary system": "urinary",
    "Genital systems'": "reproductive",
    "Lymphoid system": "lymphatic",
    "Endocrine glands": "endocrine",
}

# System -> peel layer (PRD section 11). Muscles are split by collection below.
SYSTEM_LAYER = {
    "integumentary": "skin",
    "muscular": "muscles-deep",
    "cardiovascular": "vessels",
    "lymphatic": "vessels",
    "nervous": "nerves",
    "respiratory": "organs",
    "digestive": "organs",
    "urinary": "organs",
    "reproductive": "organs",
    "endocrine": "organs",
    "visceral": "organs",
    "skeletal": "skeleton",
}

LAYER_ORDER = ["skin", "muscles-superficial", "muscles-deep", "vessels", "nerves", "organs", "skeleton"]

# Tessellation for vessels and nerves, which Z-Anatomy stores as bevelled
# curves. Upstream uses resolution_u=12, bevel_resolution=4, which turns the
# vascular tree alone into millions of triangles. These values keep tubes round
# enough to read on screen at a fraction of the cost.
CURVE_RESOLUTION_U = 3
CURVE_BEVEL_RESOLUTION = 1

# Objects from third-party models that Z-Anatomy bundles under non-commercial
# licences (inner ear: CC BY-NC-SA 4.0; kidney: CC BY-NC 4.0). The .blend does
# not record provenance, so we match conservatively by name and keep them out
# of the BY-SA packs until provenance is confirmed.
NC_SUSPECT_PATTERNS = [
    re.compile(r"\b(cochlea|cochlear|semicircular|vestibul|labyrinth|utricle|saccule|spiral organ|scala)\b", re.I),
    re.compile(r"\b(kidney|renal|nephr|calyx|calyces)\b", re.I),
]

LUNG_PATTERN = re.compile(r"\blobe of (left|right) lung\b", re.I)
AIRWAY_PATTERN = re.compile(r"\b(trachea|bronch\w*)\b", re.I)
VESSEL_PATTERN = re.compile(r"\b(arter\w*|vein\w*|venous|aorta|vena|venae|sinus of dura)\b", re.I)
HAIR_PATTERN = re.compile(r"\bhairs?\b", re.I)


def is_helper(name: str) -> bool:
    return name.endswith(HELPER_SUFFIXES)


def classify(name: str, collections: list[str]) -> dict | None:
    """Return {system, layer, tissue, nc_suspect} for an anatomy object, or None."""
    if is_helper(name):
        return None
    if any(c in NON_ANATOMY_COLLECTIONS for c in collections):
        return None

    system = next((SUBCOLLECTION_SYSTEM[c] for c in collections if c in SUBCOLLECTION_SYSTEM), None)
    if system is None:
        system = next((TOP_COLLECTION_SYSTEM[c] for c in collections if c in TOP_COLLECTION_SYSTEM), None)
    if system is None:
        return None

    layer = SYSTEM_LAYER[system]
    if system == "muscular" and "Superficial muscles" in collections:
        layer = "muscles-superficial"

    if HAIR_PATTERN.search(name):
        tissue = "none"
    elif system == "skeletal" and "3: Joints" not in collections:
        tissue = "bone"
    elif LUNG_PATTERN.search(name):
        tissue = "lung"
    elif AIRWAY_PATTERN.search(name):
        tissue = "air"
    elif system == "cardiovascular" or VESSEL_PATTERN.search(name):
        tissue = "blood"
    else:
        tissue = "soft"

    return {
        "system": system,
        "layer": layer,
        "tissue": tissue,
        "nc_suspect": any(p.search(name) for p in NC_SUSPECT_PATTERNS),
    }


def lung_side(name: str) -> str:
    return "left" if re.search(r"\bleft\b", name, re.I) else "right"


def side_of(name: str) -> str | None:
    if name.endswith(".l"):
        return "left"
    if name.endswith(".r"):
        return "right"
    return None


def base_name(name: str) -> str:
    """Strip side suffixes and the parentheses Z-Anatomy uses for variant structures."""
    n = re.sub(r"\.(l|r)$", "", name).strip()
    return n


def structure_id(name: str) -> str:
    """Stable, URL-safe id derived from the Z-Anatomy object name."""
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    n = n.strip().lower()
    side = ""
    m = re.search(r"\.(l|r)$", n)
    if m:
        side = "-left" if m.group(1) == "l" else "-right"
        n = n[: m.start()]
    n = n.replace("(", "").replace(")", "")
    n = re.sub(r"[^a-z0-9]+", "-", n).strip("-")
    return n + side
