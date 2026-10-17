"""Inventory the Z-Anatomy Blender file.

Opens the .blend headlessly with embedded scripts disabled and writes a JSON
report of the collection hierarchy and every mesh object.

Usage:
    python3 -I pipeline/inventory.py <Startup.blend> <out.json>
"""

import json
import sys

import bpy


def collection_tree(coll):
    return {
        "name": coll.name,
        "objects": len(coll.objects),
        "children": [collection_tree(c) for c in coll.children],
    }


def main(blend_path: str, out_path: str) -> None:
    # use_scripts=False: never auto-run Python embedded in the downloaded file.
    bpy.ops.wm.open_mainfile(filepath=blend_path, load_ui=False, use_scripts=False)

    objects = []
    for obj in bpy.data.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "collections": [c.name for c in obj.users_collection],
            "parent": obj.parent.name if obj.parent else None,
            "hidden": obj.hide_get() if obj.name in bpy.context.view_layer.objects else None,
        }
        if obj.type == "MESH":
            me = obj.data
            entry.update(
                vertices=len(me.vertices),
                faces=len(me.polygons),
                materials=[m.name for m in me.materials if m],
                modifiers=[m.type for m in obj.modifiers],
            )
        objects.append(entry)

    report = {
        "file": blend_path,
        "blender": bpy.app.version_string,
        "scene_tree": collection_tree(bpy.context.scene.collection),
        "counts": {
            t: sum(1 for o in bpy.data.objects if o.type == t)
            for t in sorted({o.type for o in bpy.data.objects})
        },
        "text_blocks": [t.name for t in bpy.data.texts],
        "objects": objects,
    }
    with open(out_path, "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report["counts"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
