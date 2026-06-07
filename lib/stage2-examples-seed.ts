import bundledExamplesJson from "../data/examples.json";
import {
  dedupeStage2CorpusExamples,
  parseStage2ExamplesJson,
  type Stage2CorpusExample
} from "./stage2-channel-config";

const WORKSPACE_STAGE2_CORPUS_OWNER = {
  channelId: "workspace-default",
  channelName: "Workspace default"
} as const;

const BUNDLED_STAGE2_EXAMPLES_SEED = dedupeStage2CorpusExamples(
  parseStage2ExamplesJson(JSON.stringify(bundledExamplesJson), WORKSPACE_STAGE2_CORPUS_OWNER).map(
    (example) => ({
      ...example,
      ownerChannelId: WORKSPACE_STAGE2_CORPUS_OWNER.channelId,
      ownerChannelName: WORKSPACE_STAGE2_CORPUS_OWNER.channelName,
      sourceChannelId: example.sourceChannelId || WORKSPACE_STAGE2_CORPUS_OWNER.channelId,
      sourceChannelName: example.sourceChannelName || WORKSPACE_STAGE2_CORPUS_OWNER.channelName
    })
  )
);

export function getBundledStage2ExamplesSeed(): Stage2CorpusExample[] {
  return BUNDLED_STAGE2_EXAMPLES_SEED.map((example) => ({
    ...example,
    whyItWorks: [...example.whyItWorks]
  }));
}

export function getBundledStage2ExamplesSeedJson(): string {
  return JSON.stringify(getBundledStage2ExamplesSeed(), null, 2);
}
