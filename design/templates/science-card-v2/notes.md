# Science Card V2

This is a scaffold template for the second science variant.

Current calibration note:

- File-level preflight passes: reference, content, session, report, media, background, avatar all exist.
- `science-card-v2` now runs in reference-first mode: top copy, author meta and the main shell chrome are driven from the reference, while avatar is treated as non-blocking.
- The embedded reference image also contains its own outer margins, so reference bounds must be treated explicitly through `referenceCrop*` before trusting overlay placement.
- `chrome-only` remains the honest calibration scope while media/background are being derived or approximated from the reference.

Checklist:

- Match the green shell border, dark fills and accent-word treatment exactly.
- Keep avatar visually unobtrusive; it must not become the blocker for shell calibration.
- Confirm the bottom author row and italic quote feel compressed and premium, not like the lighter V1 science card.
- Perform overlay-based alignment against reference, then advance to `Review`.
