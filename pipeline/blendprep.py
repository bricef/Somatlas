"""Blender-side preparation shared by the audit and the export.

Both scripts must evaluate exactly the same geometry, so the steps that make
the Z-Anatomy file exportable live here and nowhere else.
"""

import bpy

import zanatomy


def open_blend(path: str) -> None:
    # use_scripts=False: never auto-run Python embedded in the downloaded file.
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
    _include_all_collections(bpy.context.view_layer.layer_collection)


def _include_all_collections(layer_collection) -> None:
    """Z-Anatomy excludes most collections at startup; excluded objects are
    never evaluated, so modifiers and curve settings would silently not apply."""
    layer_collection.exclude = False
    layer_collection.hide_viewport = False
    for child in layer_collection.children:
        _include_all_collections(child)


def anatomy_objects():
    """Yield (object, classification) for every anatomy mesh or curve, prepared
    for evaluation. Call bpy.context.view_layer.update() afterwards."""
    out = []
    for obj in bpy.data.objects:
        if obj.type not in ("MESH", "CURVE"):
            continue
        info = zanatomy.classify(obj.name, [c.name for c in obj.users_collection])
        if info is None:
            continue
        _prepare(obj)
        out.append((obj, info))
    return out


def _prepare(obj) -> None:
    """No subdivision surfaces, capped and lighter tubes for curves."""
    obj.hide_viewport = False
    obj.hide_set(False)
    if obj.type == "MESH":
        for m in obj.modifiers:
            if m.type == "SUBSURF":
                m.show_viewport = False
    elif obj.type == "CURVE":
        obj.data.use_fill_caps = True
        obj.data.resolution_u = zanatomy.CURVE_RESOLUTION_U
        obj.data.bevel_resolution = zanatomy.CURVE_BEVEL_RESOLUTION
