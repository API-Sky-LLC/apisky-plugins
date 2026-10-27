---
description: Build and check the fab package before ordering
---

# /fab-package

Produce the manufacturing package for the current board and report what is missing.

1. Run DRC and ERC; stop on any error, list warnings with the rule name.
2. Generate gerbers, drill files and the position file into `fab/`.
3. Verify the package: every layer present, outline closed, drill count matches the pad count.
4. BOM: `Reference`, `Value`, `Footprint`, `MPN`, `Description`, quantity.
5. README: copper weight, mask colour, board thickness, surface finish, quantity, panelization.

Output a checklist with `ok` / `missing` per line, never a paragraph.
