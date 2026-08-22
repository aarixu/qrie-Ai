"""Headless Blender: report what the Z-Anatomy heart actually contains.

Phase 0 go/no-go. The whole cutaway demo depends on the heart having real
interior geometry rather than a hollow outer shell, so this reports rather than
assumes: it lists every mesh matching heart-related Terminologia Anatomica
fragments and infers interior structure from bounding-box nesting.

Usage:
    blender <file.blend> --background --python tools/blender/inspect_heart.py -- <out.json>
"""
import json
import sys

import bpy
from mathutils import Vector

HEART_TERMS = [
    "cor ", "heart", "ventricul", "ventricle", "atri", "auricul",
    "myocard", "endocard", "epicard", "pericard",
    "valva", "valve", "cuspid", "septum", "chorda", "papillar",
    "aorta", "aortic", "pulmonal", "pulmonary", "vena cava", "truncus",
    "coronar", "sinus venarum", "trabecul",
]


def world_bbox(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return lo, hi


def contains(outer, inner, tol=1e-4):
    (olo, ohi), (ilo, ihi) = outer, inner
    return all(olo[i] - tol <= ilo[i] and ihi[i] <= ohi[i] + tol for i in range(3))


def tri_count(obj):
    return sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)


def main(out_path):
    matches = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not obj.data.polygons:
            continue
        name_lc = obj.name.lower()
        if not any(term in name_lc for term in HEART_TERMS):
            continue
        lo, hi = world_bbox(obj)
        matches.append({
            "name": obj.name,
            "triangles": tri_count(obj),
            "vertices": len(obj.data.vertices),
            "bbox_lo": list(lo),
            "bbox_hi": list(hi),
            "volume": (hi.x - lo.x) * (hi.y - lo.y) * (hi.z - lo.z),
        })

    boxes = {m["name"]: (Vector(m["bbox_lo"]), Vector(m["bbox_hi"])) for m in matches}
    nesting = []
    for outer_name, outer_box in boxes.items():
        for inner_name, inner_box in boxes.items():
            if outer_name != inner_name and contains(outer_box, inner_box):
                nesting.append({"outer": outer_name, "inner": inner_name})

    report = {
        "total_mesh_objects_in_file": sum(1 for o in bpy.data.objects if o.type == "MESH"),
        "heart_matches": len(matches),
        "total_triangles": sum(m["triangles"] for m in matches),
        "nested_pairs": len(nesting),
        "objects": sorted(matches, key=lambda m: -m["triangles"]),
        "nesting": nesting[:400],
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print("\n" + "=" * 64)
    print(f"total meshes in file : {report['total_mesh_objects_in_file']:,}")
    print(f"heart meshes found   : {report['heart_matches']}")
    print(f"total triangles      : {report['total_triangles']:,}")
    print(f"nested pairs         : {report['nested_pairs']}   <-- >0 means INTERIOR GEOMETRY")
    print("=" * 64)
    for m in report["objects"][:40]:
        print(f"  {m['triangles']:>9,}  {m['name']}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv[0] if argv else "heart-inspection.json")
