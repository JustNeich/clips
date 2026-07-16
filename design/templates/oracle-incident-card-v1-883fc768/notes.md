# Oracle Incident card

Reference: owner-accepted CopScopes frame already stored in Oracle.

Approved infrastructure canary:

- live Stage 3 job: `b6c18fef9d5e4cd493b30080573e859d`;
- artifact SHA-256: `3705f8f4dd1ae91823c321251bdea1130318831f029e08ee2607da85e6afef0e`;
- source: `https://www.instagram.com/reel/DaGZPn5IlRw/`;
- authoritative source crop: `x=0.037, y=0.396, width=0.921, height=0.271`;
- render base: exact live managed state for `oracle-incident-card-v1-883fc768`, resolved by the worker as `channel-story-v1`;
- required controls: `topFontScale=1.25`, `bottomFontScale=1.03`, `mediaRegionHeightPx=1063`, and non-empty yellow `slot1` body highlights;
- publication: disabled.

Visual acceptance: current-channel identity, glowing white headline, dense body with several yellow phrases, and media ordering match the accepted CopScopes structure without using CopScopes identity. The full-frame pixel report is informational because the test identity, text, and media differ from the reference.
