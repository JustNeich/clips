export const PORTFOLIO_RESOURCE_LIMITS = Object.freeze({
  sourceIngestPerProfileChannel: 1,
  semanticModelGlobal: 3,
  renderGlobal: 1,
  publicationPerChannel: 1,
  publicationGlobal: 2
});

export type PortfolioDurableResourceLane =
  | "source_ingest"
  | "semantic_model"
  | "render"
  | "publication"
  | "public_verification"
  | "unclassified";

const SEMANTIC_EVENT_KINDS = new Set([
  "source_fit.requested",
  "brief.requested",
  "caption.requested",
  "montage_planner.requested",
  "vision_qa.requested",
  "revision.requested"
]);

const RENDER_EVENT_KINDS = new Set([
  "preview.requested",
  "preview_revision.requested",
  "final_render.requested"
]);

const PUBLICATION_EVENT_KINDS = new Set([
  "publication.requested",
  "upload.requested",
  "upload.reconcile"
]);

const PUBLIC_VERIFICATION_EVENT_KINDS = new Set([
  "public_verify.requested",
  "public_verification.requested"
]);

export function classifyPortfolioDurableResourceLane(eventKind: string): PortfolioDurableResourceLane {
  if (eventKind === "source_ingest.requested") return "source_ingest";
  if (SEMANTIC_EVENT_KINDS.has(eventKind)) return "semantic_model";
  if (RENDER_EVENT_KINDS.has(eventKind)) return "render";
  if (PUBLICATION_EVENT_KINDS.has(eventKind)) return "publication";
  if (PUBLIC_VERIFICATION_EVENT_KINDS.has(eventKind)) return "public_verification";
  return "unclassified";
}

export const PORTFOLIO_DURABLE_LANE_EVENT_KINDS = Object.freeze({
  semanticModel: [...SEMANTIC_EVENT_KINDS],
  render: [...RENDER_EVENT_KINDS],
  publication: [...PUBLICATION_EVENT_KINDS]
});
