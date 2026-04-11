import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHydratedWorkflowStep,
  resolveLiveHydratedWorkflowStep,
  shouldResetHydratedStage3TransientState
} from "../app/home-page-support";

test("resolveHydratedWorkflowStep preserves the current step while rehydrating the same chat", () => {
  assert.equal(
    resolveHydratedWorkflowStep({
      nextChatId: "chat-1",
      initializedChatId: "chat-1",
      currentStep: 3,
      preferredStep: 2,
      maxStep: 3
    }),
    3
  );
});

test("resolveHydratedWorkflowStep uses preferred step for a newly selected chat", () => {
  assert.equal(
    resolveHydratedWorkflowStep({
      nextChatId: "chat-2",
      initializedChatId: "chat-1",
      currentStep: 3,
      preferredStep: 2,
      maxStep: 3
    }),
    2
  );
});

test("shouldResetHydratedStage3TransientState preserves preview jobs while rehydrating the same chat", () => {
  assert.equal(
    shouldResetHydratedStage3TransientState({
      nextChatId: "chat-1",
      initializedChatId: "chat-1"
    }),
    false
  );
  assert.equal(
    shouldResetHydratedStage3TransientState({
      nextChatId: "chat-2",
      initializedChatId: "chat-1"
    }),
    true
  );
  assert.equal(
    shouldResetHydratedStage3TransientState({
      nextChatId: null,
      initializedChatId: "chat-1"
    }),
    true
  );
});

test("resolveLiveHydratedWorkflowStep honors an explicitly requested step", () => {
  assert.equal(
    resolveLiveHydratedWorkflowStep({
      currentStep: 2,
      livePreferredStep: 2,
      maxStep: 3,
      requestedStep: 3
    }),
    3
  );
});

test("resolveLiveHydratedWorkflowStep still follows live blockers when no step is requested", () => {
  assert.equal(
    resolveLiveHydratedWorkflowStep({
      currentStep: 3,
      livePreferredStep: 2,
      maxStep: 3
    }),
    2
  );
});

test("resolveLiveHydratedWorkflowStep preserves the current step for same-chat live refresh", () => {
  assert.equal(
    resolveLiveHydratedWorkflowStep({
      currentStep: 3,
      livePreferredStep: 2,
      maxStep: 3,
      preserveCurrentStep: true
    }),
    3
  );
  assert.equal(
    resolveLiveHydratedWorkflowStep({
      currentStep: 1,
      livePreferredStep: 2,
      maxStep: 3,
      preserveCurrentStep: true
    }),
    1
  );
});
