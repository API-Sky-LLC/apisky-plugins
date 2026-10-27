---
name: footprint-audit
description: Check a footprint against the datasheet before ordering — pins, pads, polarity. Load whenever a new footprint enters the project.
---

# Footprint audit

A third-party footprint is the most common reason a board comes back dead. Compare against the
datasheet, not against the name:

1. **Pin numbering**: matches the datasheet, not the convenience of the symbol.
2. **Geometry**: pad size, pitch, lead width — from the recommended land pattern, not from a
   generic package in a reference library.
3. **Polarity**: key / dot / chamfer on the body and on the silkscreen agree.
4. **Hidden pads**: thermal pad, exposed pad, shield — connected and given thermal vias.
5. **3D**: the model does not collide with its neighbours in height.

If the footprint changes, the pack's `contentHash` changes too: rebuild the index, otherwise the
store keeps serving the old geometry.
