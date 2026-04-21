import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCssRuleBlock(css: string, selector: string): string {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Expected CSS rule for ${selector}.`);
  return match[1];
}

function getCssDeclaration(ruleBlock: string, property: string): string {
  const match = ruleBlock.match(new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;]+);`));
  assert.ok(match, `Expected declaration ${property}.`);
  return match[1].trim();
}

test("channel onboarding modal sits above the channel manager overlay", async () => {
  const [componentSource, css] = await Promise.all([
    readFile(path.join(REPO_ROOT, "app/components/ChannelOnboardingWizard.tsx"), "utf8"),
    readFile(path.join(REPO_ROOT, "app/globals.css"), "utf8")
  ]);

  assert.match(componentSource, /className="modal-shell"/);
  assert.match(componentSource, /className="modal-backdrop"/);
  assert.match(componentSource, /className="modal-content channel-onboarding-modal"/);

  const channelManagerOverlayRule = getCssRuleBlock(css, ".channel-manager-overlay");
  const onboardingModalShellRule = getCssRuleBlock(css, ".modal-shell");
  const onboardingModalContentRule = getCssRuleBlock(css, ".modal-content");

  assert.equal(getCssDeclaration(channelManagerOverlayRule, "position"), "fixed");
  assert.equal(getCssDeclaration(onboardingModalShellRule, "position"), "fixed");
  assert.equal(getCssDeclaration(onboardingModalContentRule, "position"), "relative");

  const managerZIndex = Number(getCssDeclaration(channelManagerOverlayRule, "z-index"));
  const onboardingZIndex = Number(getCssDeclaration(onboardingModalShellRule, "z-index"));

  assert.ok(Number.isFinite(managerZIndex));
  assert.ok(Number.isFinite(onboardingZIndex));
  assert.ok(
    onboardingZIndex > managerZIndex,
    `Expected onboarding modal z-index (${onboardingZIndex}) to exceed channel manager overlay (${managerZIndex}).`
  );
});
