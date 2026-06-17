# Montage Learning Export

`npm run montage-learning:export` builds an offline dataset for a future LLM
video editor. The exporter is read-only: it reads owner flow evidence,
publications, final render jobs, and render exports. It must not publish,
schedule, delete, or mutate videos.

## v2 Contract

The dataset teaches causal editing decisions, not parameter imitation.

Each accepted case needs three visual states:

- `source_raw`: the original source material.
- `template_naive`: the source placed into the selected template before editor
  cleanup such as crop, focus, zoom, segment window, blur, or fit changes.
- `final_edited`: the accepted final render.

Each important montage action must be explained as a `causal_edit`:

- what was visible before;
- what problem it created;
- which action or parameter changed;
- what changed visually after;
- why the action was chosen;
- what tradeoff it created;
- what reusable rule future editors should learn.

Examples of causal edit classes are `donor_provenance`, `action_off_center`,
`overzoom_risk`, `dead_canvas`, `landscape_strip`, `source_context_loss`,
`source_context_preservation`, `clip_window_choice`, and `template_fit`.

## Clean vs Candidate

A case enters the clean training split only when all of these are true:

- the final job/export is successful and canonical;
- source, naive-template, and final frames are available;
- at least one causal edit exists;
- every changed key action has causal reasoning;
- the judge verdict is `PASS`.

If frames are missing, if a changed crop/focus/zoom/fit/segment decision has no
visual reason, or if the judge does not pass the case, the case remains
`candidate` or `negative`. Candidate cases may be inspected, but they must not be
promoted into the generated playbook as editing rules.

## Output

The exporter writes:

- `dataset.jsonl` and `dataset.v2.jsonl`;
- `cases/<case_id>/source_frames/*.png`;
- `cases/<case_id>/template_naive_frames/*.png`;
- `cases/<case_id>/final_frames/*.png`;
- `cases/<case_id>/analysis.json`;
- `cases/<case_id>/case.json`;
- `playbook.md` and `playbook.v2.md`;
- `quality_report.json` and `quality_report.v2.json`.

Run example:

```bash
CLIPS_APP_URL=http://localhost:3000 \
CLIPS_MCP_TOKEN=... \
npm run montage-learning:export -- \
  --limit=50 \
  --frame-mode=attempt \
  --analysis-mode=llm \
  --output-dir=.data/montage-learning/v2-run
```

Use `--frame-mode=metadata` only for schema and metadata smoke checks. It cannot
produce clean training cases because clean cases require visual evidence.
