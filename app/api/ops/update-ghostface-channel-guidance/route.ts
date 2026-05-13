import { NextResponse } from "next/server";
import { listChannelAccess, setChannelAccess } from "../../../../lib/channel-access";
import { listChannels, updateChannelById, type Channel } from "../../../../lib/chat-history";
import { getDb } from "../../../../lib/db/client";
import { getWorkspace, listWorkspaceMembers } from "../../../../lib/team-store";

const MARY_EMAIL = "lomiknj123@gmail.com";

const CHANNEL_GUIDANCE = [
  {
    name: "GHOSTFACE COUNTRY",
    username: "ghostfacecountry",
    systemPrompt:
      "Write English top/bottom Shorts captions for a new Ghostface-branded Country channel. The current wedge is very narrow: study Ghost Face Facts and Ghost Face Science as the main demand references, then write as if the selected source video would naturally fit on Ghost Face Facts. Stay close to what those channels publish in idea, source logic, pacing, and packaging; this is a new channel, so recognizable sameness is useful while trust forms. Use Martin The Worker as the quality bar for sticky process: zoom, visible action, mechanism, and a moment the viewer still wants to rewatch after understanding it. Do not use generic checklists, empty hooks, or invented horror stories. The top text should make the visual situation instantly stronger than the reference; the bottom text should add the clean reason, consequence, or payoff.",
    descriptionPrompt:
      "New Ghostface/Country channel. First priority: become legible to YouTube as a supplier of the same demand that Ghost Face Facts and Ghost Face Science satisfy. Copy the reference logic closely in sources, rhythm, and visual mood, while improving weak top text. Martin The Worker is the secondary bar for retention: sticky zoom/process/mechanism clips that feel worth rewatching. Avoid broad country/workshop drift until the channel proves trust."
  },
  {
    name: "GHOSTFACE WORKSHOP",
    username: "ghostfaceworkshop",
    systemPrompt:
      "Write English top/bottom Shorts captions for a new Ghostface-branded Workshop channel. The current wedge is very narrow: study Ghost Face Facts and Ghost Face Science as the main demand references, then write as if the selected source video would naturally fit on Ghost Face Facts. Stay close to what those channels publish in idea, source logic, pacing, and packaging; this is a new channel, so recognizable sameness is useful while trust forms. Use Martin The Worker as the quality bar for sticky process: zoom, visible action, mechanism, and a moment the viewer still wants to rewatch after understanding it. Do not use generic checklists, empty hooks, or invented horror stories. The top text should make the visual situation instantly stronger than the reference; the bottom text should add the clean reason, consequence, or payoff.",
    descriptionPrompt:
      "New Ghostface/Workshop channel. First priority: become legible to YouTube as a supplier of the same demand that Ghost Face Facts and Ghost Face Science satisfy. Copy the reference logic closely in sources, rhythm, and visual mood, while improving weak top text. Martin The Worker is the secondary bar for retention: sticky zoom/process/mechanism clips that feel worth rewatching. Avoid broad mechanic/tool drift until the channel proves trust."
  }
] as const;

type ExampleSourceMix = Record<string, number>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getUserIdByEmail(email: string): string | null {
  const row = getDb()
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .get(normalizeEmail(email)) as { id?: string } | undefined;
  return row?.id ?? null;
}

function countExamplesFromJson(examplesJson: string): { count: number; mix: ExampleSourceMix } {
  const parsed = JSON.parse(examplesJson) as Array<{ sourceChannelId?: unknown }>;
  const mix: ExampleSourceMix = {};
  for (const example of parsed) {
    const source = String(example.sourceChannelId ?? "unknown");
    mix[source] = (mix[source] ?? 0) + 1;
  }
  return { count: parsed.length, mix };
}

function countStage2Examples(channel: Channel): { count: number; mix: ExampleSourceMix } {
  const config = channel.stage2ExamplesConfig;
  const examples =
    Array.isArray(config.customExamples) && config.customExamples.length > 0
      ? config.customExamples
      : JSON.parse(config.customExamplesJson || "[]");
  const mix: ExampleSourceMix = {};
  for (const example of examples as Array<{ sourceChannelId?: unknown }>) {
    const source = String(example.sourceChannelId ?? "unknown");
    mix[source] = (mix[source] ?? 0) + 1;
  }
  return { count: examples.length, mix };
}

function hasExpectedExamples(summary: { count: number; mix: ExampleSourceMix }): boolean {
  return (
    summary.count === 30 &&
    summary.mix["@MartinTheWorker"] === 20 &&
    summary.mix["@GhostFaceFacts"] === 10
  );
}

async function buildReport(options: { apply: boolean }): Promise<NextResponse> {
  const workspace = getWorkspace();
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Workspace is not initialized." }, { status: 500 });
  }

  const members = listWorkspaceMembers(workspace.id);
  const actor = members.find((member) => member.role === "owner") ?? members[0] ?? null;
  const maryUserId = getUserIdByEmail(MARY_EMAIL);
  const channels = await listChannels(workspace.id);
  const results = [];

  for (const guidance of CHANNEL_GUIDANCE) {
    const found = channels.find(
      (channel) =>
        channel.username.toLowerCase() === guidance.username ||
        channel.name.toLowerCase() === guidance.name.toLowerCase()
    );

    if (!found) {
      results.push({
        name: guidance.name,
        username: guidance.username,
        found: false,
        updated: false
      });
      continue;
    }

    const before = {
      systemPromptMatches: found.systemPrompt === guidance.systemPrompt,
      descriptionPromptMatches: found.descriptionPrompt === guidance.descriptionPrompt
    };

    const updated =
      options.apply && (!before.systemPromptMatches || !before.descriptionPromptMatches)
        ? await updateChannelById(found.id, {
            systemPrompt: guidance.systemPrompt,
            descriptionPrompt: guidance.descriptionPrompt
          })
        : found;

    const grantedAccess =
      options.apply && maryUserId && actor
        ? setChannelAccess({
            channelId: updated.id,
            userId: maryUserId,
            grantedByUserId: actor.user.id
          })
        : null;

    const access = maryUserId
      ? listChannelAccess(updated.id).find((grant) => grant.userId === maryUserId) ?? null
      : null;
    const examples = countExamplesFromJson(updated.examplesJson);
    const stage2Examples = countStage2Examples(updated);

    results.push({
      id: updated.id,
      name: updated.name,
      username: updated.username,
      found: true,
      updated: options.apply,
      checks: {
        systemPromptMatches: updated.systemPrompt === guidance.systemPrompt,
        descriptionPromptMatches: updated.descriptionPrompt === guidance.descriptionPrompt,
        examplesJson: {
          ...examples,
          ok: hasExpectedExamples(examples)
        },
        stage2Examples: {
          ...stage2Examples,
          useWorkspaceDefault: updated.stage2ExamplesConfig.useWorkspaceDefault,
          sourceMode: updated.stage2ExamplesConfig.sourceMode,
          ok: hasExpectedExamples(stage2Examples)
        },
        maryAccess: {
          email: MARY_EMAIL,
          userId: maryUserId,
          ok: Boolean(access),
          grantId: access?.id ?? grantedAccess?.id ?? null
        }
      }
    });
  }

  const ok =
    Boolean(maryUserId) &&
    results.length === CHANNEL_GUIDANCE.length &&
    results.every((item) => {
      const checks = "checks" in item ? item.checks : null;
      if (!checks) return false;
      return (
        item.found &&
        checks.systemPromptMatches &&
        checks.descriptionPromptMatches &&
        checks.examplesJson.ok &&
        checks.stage2Examples.ok &&
        checks.maryAccess.ok
      );
    });

  return NextResponse.json({
    ok,
    applied: options.apply,
    mary: {
      email: MARY_EMAIL,
      userId: maryUserId
    },
    channels: results
  });
}

export async function GET(): Promise<NextResponse> {
  return buildReport({ apply: false });
}

export async function POST(): Promise<NextResponse> {
  return buildReport({ apply: true });
}
