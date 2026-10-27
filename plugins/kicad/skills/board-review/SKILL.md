---
name: board-review
description: Review a board before it is ordered — ERC/DRC, power and connectors. Load before saying a KiCad board is ready to manufacture.
---

# Board review

Check in this order: whatever costs the most to redo after the board is ordered comes first.

1. **ERC (schematic)**: unconnected pins, output conflicts, missing `PWR_FLAG` on power nets.
2. **DRC (board)**: clearances, track widths, crossings, holes outside the board outline.
3. **Power**: every input is protected (fuse / diode / TVS), every rail is decoupled at the
   consumer, not only at the source.
4. **Connectors**: pin assignment matches the datasheet, no mirrored connector, power and
   ground are not swapped.
5. **Silkscreen and assembly**: references are readable, polarized parts have a marker,
   every SMD part has its `Reference` next to the body.

Report as a list of `part/net — problem — what it costs`. Do not retype DRC warnings:
name the rule and the coordinates so they can be found in KiCad.
