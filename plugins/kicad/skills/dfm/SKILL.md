---
name: dfm
description: Manufacturing limits and the fab package — tolerances, panelization, gerbers. Load before generating fab files.
---

# DFM (design for manufacturing)

A cheap board differs from an expensive one in tolerances, not in the schematic. Check before
generating anything:

- **Fab minimums**: track/clearance 0.15 mm, hole 0.3 mm, annular ring 0.15 mm, mask sliver
  0.1 mm — if the board needs less, ask the fab, do not just squeeze it.
- **Pours**: thermal reliefs on grounded pads, otherwise hand soldering turns into heating the
  whole board.
- **Panelization**: 2 mm between boards, tooling strip with fiducials for the machine, mouse
  bites / V-cuts never under a component.
- **Sides**: if parts sit on both sides, confirm the second side is not wave soldered.

Output: `gerbers/`, `*.drl`, `*.pos`, a BOM with `MPN` and `Description`, and a README with
copper weight, mask, board thickness and quantity. A BOM without `MPN` is not taken seriously.
