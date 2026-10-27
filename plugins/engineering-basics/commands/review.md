---
description: Review the current branch diff for real problems only
---

# /review

Look at the diff of the current branch against its base and list only real problems: logic
errors, missed edge cases, incompatible API changes, unclosed resources.

Output is a list of `file:line — problem — what it costs`. Style nits and "could have been done
differently" do not belong in it.
