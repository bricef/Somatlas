#!/usr/bin/env bash
# Fetch the Z-Anatomy source files at the pinned commit into a data directory
# (default: ./data, which is git-ignored). Nothing here is executed: the .blend
# is opened by the pipeline with embedded scripts disabled.
set -euo pipefail

COMMIT=a37dbd96a32bd69315a82190bef049cc549399ad
DATA=${1:-data}
SRC="$DATA/z-anatomy-src"

mkdir -p "$DATA"
if [ ! -d "$SRC/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/Z-Anatomy/Models-of-human-anatomy "$SRC"
fi
git -C "$SRC" fetch --depth 1 origin "$COMMIT"
git -C "$SRC" checkout -q "$COMMIT" -- Z-Anatomy.zip TA2.csv License.txt Readme.md
mkdir -p "$DATA/z-anatomy"
unzip -o -q "$SRC/Z-Anatomy.zip" -d "$DATA/z-anatomy"
echo "Blend file: $DATA/z-anatomy/Z-Anatomy/Startup.blend"
echo "TA2 table:  $SRC/TA2.csv"
