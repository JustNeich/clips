# Science Card V1

Approved baseline template. Reference and artifacts can be updated from the calibration workbench.

## 2026-03-15

- Science Card V1 preview viewport moved to full-frame 1080x1920; shell is no longer used as the preview crop source.
- Auto-fit now respects the Figma 18:2 baseline for default top/bottom typography:
  - top text 48px / 45px line-height
  - bottom text 30px / 1.08 line-height
- Live preview shell safe-area frame was disabled so the template is judged against the full video frame, not a legacy overlay box.
- Remaining workflow gap: repo-backed reference.png is still missing, so automated diff/report for science-card-v1 remains reference-first through Figma MCP instead of saved pixel-diff artifacts.
