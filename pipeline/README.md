# Asset pipeline

Turns the Z-Anatomy model into the files the app loads from `public/`:

- `public/packs/*.glb`: one pack per layer, plus separate `*-nc` packs for possibly non-commercial models and a generated body hull
- `public/registry.json`: the structure registry (single source of truth for the app)
- `public/content.json`: short descriptions

The published files are committed, so CI and the app never need Blender. Re-run the pipeline only when changing what gets exported.

## Steps

```sh
# 1. Fetch the pinned Z-Anatomy source into ./data (git-ignored)
pipeline/fetch-zanatomy.sh

# 2. Python side, in Blender's Python module (Python 3.13)
pip install -r pipeline/requirements.txt
python3 -I pipeline/audit.py  data/z-anatomy/Z-Anatomy/Startup.blend build/audit
python3 -I pipeline/export.py data/z-anatomy/Z-Anatomy/Startup.blend data/z-anatomy-src/TA2.csv build/export

# 3. Node side: simplify, compress, publish, verify
npm ci
node pipeline/optimize.mjs build/export public
npm run assets:check
```

The `.blend` file is opened with embedded scripts disabled (`use_scripts=False`); it ships a `z-anatomy.py` that is never run.

## Files

| File | Role |
|---|---|
| `zanatomy.py` | What we know about the source file: which objects are anatomy, their system, layer and X-ray tissue, ids, suspected non-commercial models, and which upstream materials name a tissue surface. Shared by audit and export. |
| `blendprep.py` | Opens the file and prepares objects identically for audit and export (all collections evaluated, no subdivision, capped and lighter curve tubes). |
| `audit.py` | Per-structure mesh report: triangles, closedness, winding, mirroring. |
| `export.py` | World-space GLB packs, registry, descriptions; small-hole repair and outward orientation; per-vertex tissue surfaces (`_SURFACE`); generated body hull and lung volumes for the X-ray. |
| `holefill.py` | Close upstream's cutaway windows with caps that follow the surrounding wall's curvature (flat caps for tube ends). |
| `hull.py` | Voxelise, close, fill and resurface a set of meshes into one closed volume. |
| `gltfwrite.py` | Minimal GLB writer (one node per structure). |
| `optimize.mjs` | meshoptimizer simplification and compression; records which structures are still (nearly) closed and therefore usable by the X-ray. |
| `check-packs.mjs` | Verifies packs and registry agree, including the X-ray flags. Runs in CI. |
| `meshcheck.mjs` | Edge-based closedness checks shared by the two Node scripts. |
