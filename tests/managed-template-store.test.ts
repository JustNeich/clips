import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createChannel,
  listChannels
} from "../lib/chat-history";
import {
  createManagedTemplate,
  deleteManagedTemplateDetailed,
  getWorkspaceDefaultTemplateId,
  importManagedTemplateBackup,
  listManagedTemplates,
  readManagedTemplateSync,
  resolveManagedTemplate,
  resolveManagedTemplateSync,
  updateManagedTemplate
} from "../lib/managed-template-store";
import { CHANNEL_STORY_TEMPLATE_ID, STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { bootstrapOwner } from "../lib/team-store";
import { getDb } from "../lib/db/client";

async function withIsolatedTemplateWorkspace<T>(
  run: (input: { appDataDir: string; legacyRoot: string; owner: Awaited<ReturnType<typeof bootstrapOwner>> }) => Promise<T>
): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-workspace-templates-test-"));
  const legacyRoot = path.join(appDataDir, "legacy-managed-templates");
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRoot = process.env.MANAGED_TEMPLATES_ROOT;
  const previousLegacyRoot = process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  process.env.MANAGED_TEMPLATES_LEGACY_ROOT = legacyRoot;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    await mkdir(legacyRoot, { recursive: true });
    const owner = await bootstrapOwner({
      workspaceName: "Workspace Templates",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    return await run({ appDataDir, legacyRoot, owner });
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousRoot;
    }
    if (previousLegacyRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_LEGACY_ROOT = previousLegacyRoot;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("workspace template library seeds a DB-backed default template", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const templates = await listManagedTemplates(owner.workspace.id);
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const resolvedAsync = await resolveManagedTemplate(null, { workspaceId: owner.workspace.id });
    const resolvedSync = resolveManagedTemplateSync(undefined, { workspaceId: owner.workspace.id });
    const resolvedLegacyBuiltInId = await resolveManagedTemplate(STAGE3_TEMPLATE_ID, {
      workspaceId: owner.workspace.id
    });

    assert.ok(templates.length >= 1);
    assert.equal(defaultTemplateId, templates.find((template) => template.id === defaultTemplateId)?.id);
    assert.notEqual(defaultTemplateId, STAGE3_TEMPLATE_ID);
    assert.equal(resolvedAsync?.id, defaultTemplateId);
    assert.equal(resolvedSync?.id, defaultTemplateId);
    assert.equal(resolvedLegacyBuiltInId?.id, defaultTemplateId);
    assert.equal(resolvedAsync?.layoutFamily, STAGE3_TEMPLATE_ID);
  });
});

test("workspace template library re-enables dormant seed highlight profiles for existing templates", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const db = getDb();
    const row = db
      .prepare("SELECT template_config_json FROM workspace_templates WHERE id = ? AND workspace_id = ? LIMIT 1")
      .get(defaultTemplateId, owner.workspace.id) as { template_config_json?: string } | undefined;
    assert.ok(row?.template_config_json);

    const templateConfig = JSON.parse(String(row?.template_config_json)) as {
      highlights?: { enabled?: boolean };
    };
    templateConfig.highlights = {
      ...(templateConfig.highlights ?? {}),
      enabled: false
    };

    db.prepare("UPDATE workspace_templates SET template_config_json = ? WHERE id = ? AND workspace_id = ?").run(
      JSON.stringify(templateConfig),
      defaultTemplateId,
      owner.workspace.id
    );

    const reloaded = await listManagedTemplates(owner.workspace.id);
    const repaired = reloaded.find((template) => template.id === defaultTemplateId);

    assert.equal(repaired?.templateConfig.highlights.enabled, true);
  });
});

test("exact template reads re-enable dormant seed highlights without a full library scan", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const db = getDb();
    const row = db
      .prepare("SELECT template_config_json FROM workspace_templates WHERE id = ? AND workspace_id = ? LIMIT 1")
      .get(defaultTemplateId, owner.workspace.id) as { template_config_json?: string } | undefined;
    assert.ok(row?.template_config_json);

    const templateConfig = JSON.parse(String(row?.template_config_json)) as {
      highlights?: { enabled?: boolean };
    };
    templateConfig.highlights = {
      ...(templateConfig.highlights ?? {}),
      enabled: false
    };
    db.prepare("UPDATE workspace_templates SET template_config_json = ? WHERE id = ? AND workspace_id = ?").run(
      JSON.stringify(templateConfig),
      defaultTemplateId,
      owner.workspace.id
    );

    const legacyTemplateId = "late-highlight-scan-template";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify({
        id: legacyTemplateId,
        workspaceId: owner.workspace.id,
        name: "Late Highlight Scan Template",
        baseTemplateId: "science-card-v1",
        templateConfig: {},
        shadowLayers: []
      }),
      "utf-8"
    );

    const reloaded = readManagedTemplateSync(defaultTemplateId, { workspaceId: owner.workspace.id });
    const imported = db
      .prepare("SELECT id FROM workspace_templates WHERE id = ? AND workspace_id = ? LIMIT 1")
      .get(legacyTemplateId, owner.workspace.id) as { id?: string } | undefined;

    assert.equal(reloaded?.templateConfig.highlights.enabled, true);
    assert.equal(imported?.id, undefined);
  });
});

test("legacy repo-backed custom templates import into workspace_templates", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const legacyTemplateId = "legacy-custom-template";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify(
        {
          id: legacyTemplateId,
          workspaceId: owner.workspace.id,
          creatorUserId: owner.user.id,
          creatorDisplayName: "Legacy Editor",
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
          versions: [],
          name: "Legacy Custom Template",
          description: "Stored in the repo-backed folder",
          baseTemplateId: "science-card-v1",
          content: {
            topText: "Legacy top",
            bottomText: "Legacy bottom",
            channelName: "Legacy",
            channelHandle: "@legacy",
            highlights: { top: [], bottom: [] },
            topHighlightPhrases: [],
            topFontScale: 1,
            bottomFontScale: 1,
            previewScale: 0.34,
            mediaAsset: null,
            backgroundAsset: null,
            avatarAsset: null
          },
          templateConfig: {},
          shadowLayers: []
        },
        null,
        2
      ),
      "utf-8"
    );

    const templates = await listManagedTemplates(owner.workspace.id);

    assert.ok(templates.some((template) => template.id === legacyTemplateId));
  });
});

test("exact template reads do not scan unrelated legacy template files", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const legacyTemplateId = "late-legacy-template";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify(
        {
          id: legacyTemplateId,
          workspaceId: owner.workspace.id,
          name: "Late Legacy Template",
          baseTemplateId: "science-card-v1",
          content: {
            topText: "Late top",
            bottomText: "Late bottom",
            channelName: "Late",
            channelHandle: "@late",
            highlights: { top: [], bottom: [] },
            topHighlightPhrases: [],
            topFontScale: 1,
            bottomFontScale: 1,
            previewScale: 0.34,
            mediaAsset: null,
            backgroundAsset: null,
            avatarAsset: null
          },
          templateConfig: {},
          shadowLayers: []
        },
        null,
        2
      ),
      "utf-8"
    );

    const resolved = readManagedTemplateSync(defaultTemplateId, { workspaceId: owner.workspace.id });
    const imported = getDb()
      .prepare("SELECT id FROM workspace_templates WHERE id = ? AND workspace_id = ? LIMIT 1")
      .get(legacyTemplateId, owner.workspace.id) as { id?: string } | undefined;

    assert.equal(resolved?.id, defaultTemplateId);
    assert.equal(imported?.id, undefined);
  });
});

test("channel listing keeps valid assigned templates on the exact-read path", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Exact Template Channel",
      username: "exact-template",
      templateId: defaultTemplateId
    });
    const legacyTemplateId = "late-channel-list-template";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify(
        {
          id: legacyTemplateId,
          workspaceId: owner.workspace.id,
          name: "Late Channel List Template",
          baseTemplateId: "science-card-v1",
          content: {
            topText: "Late top",
            bottomText: "Late bottom",
            channelName: "Late",
            channelHandle: "@late",
            highlights: { top: [], bottom: [] },
            topHighlightPhrases: [],
            topFontScale: 1,
            bottomFontScale: 1,
            previewScale: 0.34,
            mediaAsset: null,
            backgroundAsset: null,
            avatarAsset: null
          },
          templateConfig: {},
          shadowLayers: []
        },
        null,
        2
      ),
      "utf-8"
    );

    const channels = await listChannels(owner.workspace.id);
    const imported = getDb()
      .prepare("SELECT id FROM workspace_templates WHERE id = ? AND workspace_id = ? LIMIT 1")
      .get(legacyTemplateId, owner.workspace.id) as { id?: string } | undefined;

    assert.equal(channels.find((item) => item.id === channel.id)?.templateId, defaultTemplateId);
    assert.equal(imported?.id, undefined);
  });
});

test("managed templates preserve custom card geometry and author font stacks", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Geometry Control",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          card: {
            x: 120,
            y: 220,
            width: 760,
            height: 1360
          },
          typography: {
            authorName: {
              fontFamily: '"Aptos","Segoe UI","Helvetica Neue",Arial,sans-serif'
            },
            authorHandle: {
              fontFamily: '"American Typewriter","Courier New","Georgia",serif'
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.templateConfig.card.x, 120);
    assert.equal(reloaded?.templateConfig.card.y, 220);
    assert.equal(reloaded?.templateConfig.card.width, 760);
    assert.equal(reloaded?.templateConfig.card.height, 1360);
    assert.equal(
      reloaded?.templateConfig.typography.authorName.fontFamily,
      '"Aptos","Segoe UI","Helvetica Neue",Arial,sans-serif'
    );
    assert.equal(
      reloaded?.templateConfig.typography.authorHandle.fontFamily,
      '"American Typewriter","Courier New","Georgia",serif'
    );
  });
});

test("managed templates preserve uploaded top and bottom font assets", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const topFontAsset = {
      id: "fonttop123456",
      family: "Stage3TemplateFont_fonttop123456",
      url: "/api/design/template-assets/fonttop123456",
      originalName: "LeadDisplay.woff2",
      mimeType: "font/woff2",
      sizeBytes: 32100,
      weight: 400,
      style: "normal" as const,
      createdAt: "2026-05-01T09:00:00.000Z"
    };
    const bottomFontAsset = {
      id: "fontbody123456",
      family: "Stage3TemplateFont_fontbody123456",
      url: "/api/design/template-assets/fontbody123456",
      originalName: "MainText.otf",
      mimeType: "font/otf",
      sizeBytes: 45600,
      weight: 400,
      style: "normal" as const,
      createdAt: "2026-05-01T09:05:00.000Z"
    };
    const template = await createManagedTemplate(
      {
        name: "Uploaded Font Control",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          typography: {
            top: {
              fontFamily: '"Stage3TemplateFont_fonttop123456",sans-serif',
              fontAsset: topFontAsset
            },
            bottom: {
              fontFamily: '"Stage3TemplateFont_fontbody123456",sans-serif',
              fontAsset: bottomFontAsset
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.deepEqual(reloaded?.templateConfig.typography.top.fontAsset, topFontAsset);
    assert.equal(
      reloaded?.templateConfig.typography.top.fontFamily,
      '"Stage3TemplateFont_fonttop123456",sans-serif'
    );
    assert.deepEqual(reloaded?.templateConfig.typography.bottom.fontAsset, bottomFontAsset);
    assert.equal(
      reloaded?.templateConfig.typography.bottom.fontFamily,
      '"Stage3TemplateFont_fontbody123456",sans-serif'
    );
  });
});

test("managed template backup import restores a downloaded template into the workspace library", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const original = await createManagedTemplate(
      {
        name: "Imported Backup Source",
        baseTemplateId: "science-card-v1",
        content: {
          topText: "Backup top",
          bottomText: "Backup bottom",
          channelName: "Backup Channel",
          channelHandle: "@backup"
        },
        templateConfig: {
          card: {
            x: 111,
            y: 222,
            width: 777,
            height: 999
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    const imported = await importManagedTemplateBackup(
      {
        exportVersion: "managed-template-backup-v1",
        exportedAt: "2026-04-30T00:00:00.000Z",
        template: original
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );
    const templates = await listManagedTemplates(owner.workspace.id);

    assert.notEqual(imported.id, original.id);
    assert.equal(imported.name, "Imported Backup Source");
    assert.equal(imported.content.topText, "Backup top");
    assert.equal(imported.templateConfig.card.x, 111);
    assert.ok(templates.some((template) => template.id === imported.id));
  });
});

test("managed templates persist an explicit empty badge asset path", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Badge Color Mode",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const updated = await updateManagedTemplate(
      template.id,
      {
        baseTemplateId: "science-card-v1",
        templateConfig: {
          author: {
            checkAssetPath: ""
          },
          palette: {
            checkBadgeColor: "#11aa77"
          }
        }
      },
      { workspaceId: owner.workspace.id }
    );
    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(updated?.templateConfig.author.checkAssetPath, "");
    assert.equal(updated?.templateConfig.palette.checkBadgeColor, "#11aa77");
    assert.equal(reloaded?.templateConfig.author.checkAssetPath, "");
    assert.equal(reloaded?.templateConfig.palette.checkBadgeColor, "#11aa77");
  });
});

test("managed template partial author updates preserve the existing avatar shape", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Author Shape Control",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          author: {
            avatarShape: "rounded-square"
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const updated = await updateManagedTemplate(
      template.id,
      {
        baseTemplateId: "science-card-v1",
        templateConfig: {
          author: {
            showHandle: false
          }
        }
      },
      { workspaceId: owner.workspace.id }
    );
    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(updated?.templateConfig.author.showHandle, false);
    assert.equal(updated?.templateConfig.author.avatarShape, "rounded-square");
    assert.equal(reloaded?.templateConfig.author.showHandle, false);
    assert.equal(reloaded?.templateConfig.author.avatarShape, "rounded-square");
  });
});


test("managed templates persist custom top and bottom line heights", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Line Height Control",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          typography: {
            top: {
              lineHeight: 1.12
            },
            bottom: {
              lineHeight: 1.24
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.templateConfig.typography.top.lineHeight, 1.12);
    assert.equal(reloaded?.templateConfig.typography.bottom.lineHeight, 1.24);
  });
});

test("managed templates persist text-fit typography constraints", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Text Fit Control",
        baseTemplateId: "channel-story-v1",
        templateConfig: {
          typography: {
            top: {
              min: 28,
              max: 64,
              softLimit: 120,
              penalty: 0.22,
              lineHeight: 1.11,
              maxLines: 3,
              maxChars: 180,
              horizontalSafety: 0.94,
              glyphFactor: 0.52,
              fillTargetMin: 0.73,
              fillTargetMax: 0.88
            },
            bottom: {
              min: 34,
              max: 76,
              softLimit: 220,
              penalty: 0.18,
              lineHeight: 1.03,
              maxLines: 4,
              maxChars: 260,
              horizontalSafety: 0.985,
              glyphFactor: 0.5,
              fillTargetMin: 0.84,
              fillTargetMax: 0.92
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.templateConfig.typography.top.min, 28);
    assert.equal(reloaded?.templateConfig.typography.top.max, 64);
    assert.equal(reloaded?.templateConfig.typography.top.softLimit, 120);
    assert.equal(reloaded?.templateConfig.typography.top.penalty, 0.22);
    assert.equal(reloaded?.templateConfig.typography.top.lineHeight, 1.11);
    assert.equal(reloaded?.templateConfig.typography.top.maxLines, 3);
    assert.equal(reloaded?.templateConfig.typography.top.maxChars, 180);
    assert.equal(reloaded?.templateConfig.typography.top.horizontalSafety, 0.94);
    assert.equal(reloaded?.templateConfig.typography.top.glyphFactor, 0.52);
    assert.equal(reloaded?.templateConfig.typography.top.fillTargetMin, 0.73);
    assert.equal(reloaded?.templateConfig.typography.top.fillTargetMax, 0.88);
    assert.equal(reloaded?.templateConfig.typography.bottom.min, 34);
    assert.equal(reloaded?.templateConfig.typography.bottom.max, 76);
    assert.equal(reloaded?.templateConfig.typography.bottom.softLimit, 220);
    assert.equal(reloaded?.templateConfig.typography.bottom.penalty, 0.18);
    assert.equal(reloaded?.templateConfig.typography.bottom.lineHeight, 1.03);
    assert.equal(reloaded?.templateConfig.typography.bottom.maxLines, 4);
    assert.equal(reloaded?.templateConfig.typography.bottom.maxChars, 260);
    assert.equal(reloaded?.templateConfig.typography.bottom.horizontalSafety, 0.985);
    assert.equal(reloaded?.templateConfig.typography.bottom.glyphFactor, 0.5);
    assert.equal(reloaded?.templateConfig.typography.bottom.fillTargetMin, 0.84);
    assert.equal(reloaded?.templateConfig.typography.bottom.fillTargetMax, 0.92);
  });
});

test("managed templates persist custom top and bottom text glow", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Text Glow Control",
        baseTemplateId: "channel-story-v1",
        templateConfig: {
          typography: {
            top: {
              textShadow:
                "0 0 6px rgba(255,255,255,0.94), 0 0 18px rgba(58,149,255,0.96)"
            },
            bottom: {
              textShadow: "0 0 10px rgba(255,255,255,0.44)"
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(
      reloaded?.templateConfig.typography.top.textShadow,
      "0 0 6px rgba(255,255,255,0.94), 0 0 18px rgba(58,149,255,0.96)"
    );
    assert.equal(
      reloaded?.templateConfig.typography.bottom.textShadow,
      "0 0 10px rgba(255,255,255,0.44)"
    );
  });
});

test("managed templates persist template-level video adjustment defaults", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Video Adjustments",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          videoAdjustments: {
            brightness: 1.16,
            exposure: -0.2,
            contrast: 1.12,
            saturation: 0.92
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.deepEqual(reloaded?.templateConfig.videoAdjustments, {
      brightness: 1.16,
      exposure: -0.2,
      contrast: 1.12,
      saturation: 0.92
    });
  });
});

test("managed templates persist source overlay and watermark defaults", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Source Overlay Watermark",
        baseTemplateId: "science-card-v1",
        content: {
          sourceOverlayText: "Let people love out loud."
        },
        templateConfig: {
          sourceOverlay: {
            enabled: true,
            xPct: 7,
            yPct: 9,
            maxWidthPct: 64,
            fontSize: 24,
            fontFamily: '"Arial Rounded MT Bold","Arial",sans-serif',
            color: "#ffffff",
            opacity: 0.92,
            strokeColor: "#000000",
            strokeWidth: 2,
            shadowEnabled: true,
            shadowColor: "rgba(0,0,0,0.8)",
            shadowBlur: 4,
            shadowOffsetX: 1,
            shadowOffsetY: 2,
            fontWeight: 800,
            lineHeight: 1.08,
            maxLines: 2,
            textAlign: "left"
          },
          sourceWatermark: {
            enabled: true,
            xPct: 50,
            yPct: 52,
            maxWidthPct: 70,
            fontSize: 30,
            fontFamily: '"SFMono-Regular","Courier New",monospace',
            color: "#ffffff",
            opacity: 0.35,
            strokeColor: "#000000",
            strokeWidth: 0,
            shadowEnabled: true,
            shadowColor: "rgba(0,0,0,0.5)",
            shadowBlur: 2,
            shadowOffsetX: 0,
            shadowOffsetY: 1,
            fontWeight: 600,
            lineHeight: 1.08,
            maxLines: 1,
            textAlign: "center",
            textMode: "custom",
            customText: "@clipsmind"
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.content.sourceOverlayText, "Let people love out loud.");
    assert.equal(reloaded?.templateConfig.sourceOverlay.xPct, 7);
    assert.equal(
      reloaded?.templateConfig.sourceOverlay.fontFamily,
      '"Arial Rounded MT Bold","Arial",sans-serif'
    );
    assert.equal(reloaded?.templateConfig.sourceOverlay.opacity, 0.92);
    assert.equal(reloaded?.templateConfig.sourceWatermark.enabled, true);
    assert.equal(reloaded?.templateConfig.sourceWatermark.textMode, "custom");
    assert.equal(reloaded?.templateConfig.sourceWatermark.customText, "@clipsmind");
    assert.equal(
      reloaded?.templateConfig.sourceWatermark.fontFamily,
      '"SFMono-Regular","Courier New",monospace'
    );
    assert.equal(reloaded?.templateConfig.sourceWatermark.opacity, 0.35);
  });
});

test("soft-deleted legacy templates are not resurrected by later imports", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const legacyTemplateId = "legacy-delete-check";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify({
        id: legacyTemplateId,
        workspaceId: owner.workspace.id,
        name: "Legacy Delete Check",
        baseTemplateId: "science-card-v1"
      }),
      "utf-8"
    );

    assert.ok((await listManagedTemplates(owner.workspace.id)).some((template) => template.id === legacyTemplateId));
    const deleted = await deleteManagedTemplateDetailed(legacyTemplateId, { workspaceId: owner.workspace.id });
    const afterDelete = await listManagedTemplates(owner.workspace.id);

    assert.equal(deleted.deleted, true);
    assert.ok(!afterDelete.some((template) => template.id === legacyTemplateId));
  });
});

test("legacy import does not steal same-id templates from another workspace", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const legacyTemplateId = "shared-legacy-id";
    const otherWorkspaceId = "other-workspace-id";
    const stamp = "2026-04-08T10:00:00.000Z";
    const db = getDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(otherWorkspaceId, "Other Workspace", "other-workspace", stamp, stamp);
    db.prepare(
      `INSERT INTO workspace_templates
       (id, workspace_id, name, description, layout_family, content_json, template_config_json, shadow_layers_json, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      legacyTemplateId,
      otherWorkspaceId,
      "Other Workspace Template",
      "",
      STAGE3_TEMPLATE_ID,
      "{}",
      "{}",
      "[]",
      stamp,
      stamp
    );
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify({
        id: legacyTemplateId,
        workspaceId: owner.workspace.id,
        name: "Owner Legacy Collision",
        baseTemplateId: STAGE3_TEMPLATE_ID
      }),
      "utf-8"
    );

    const chatHistory = await import("../lib/chat-history");
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Collision Channel",
      username: "collision_channel"
    });
    db.prepare("UPDATE channels SET template_id = ? WHERE id = ?").run(legacyTemplateId, channel.id);

    const templates = await listManagedTemplates(owner.workspace.id);
    const importedTemplate = templates.find((template) => template.name === "Owner Legacy Collision");
    const otherWorkspaceTemplate = db
      .prepare("SELECT workspace_id FROM workspace_templates WHERE id = ? LIMIT 1")
      .get(legacyTemplateId) as Record<string, unknown> | undefined;
    const repairedChannel = await chatHistory.getChannelById(channel.id);

    assert.ok(importedTemplate);
    assert.notEqual(importedTemplate.id, legacyTemplateId);
    assert.equal(otherWorkspaceTemplate?.workspace_id, otherWorkspaceId);
    assert.equal(repairedChannel?.templateId, importedTemplate.id);
  });
});

test("deleting the default template promotes an oldest replacement and blocks deleting the last template", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const replacement = await createManagedTemplate(
      {
        name: "Replacement Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const deletedDefault = await deleteManagedTemplateDetailed(defaultTemplateId, {
      workspaceId: owner.workspace.id
    });
    const blockedLastDelete = await deleteManagedTemplateDetailed(replacement.id, {
      workspaceId: owner.workspace.id
    });

    assert.equal(deletedDefault.deleted, true);
    assert.equal(deletedDefault.fallbackTemplateId, replacement.id);
    assert.equal(await getWorkspaceDefaultTemplateId(owner.workspace.id), replacement.id);
    assert.equal(blockedLastDelete.deleted, false);
    assert.equal(blockedLastDelete.reason, "last_template");
  });
});

test("broken channel template references self-heal to the workspace default", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const chatHistory = await import("../lib/chat-history");
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Repair Channel",
      username: "repair_channel"
    });

    getDb().prepare("UPDATE channels SET template_id = ? WHERE id = ?").run("missing-template-id", channel.id);
    const repaired = await chatHistory.getChannelById(channel.id);

    assert.equal(repaired?.templateId, defaultTemplateId);
  });
});

test("channel story templates persist lead mode and sync default lead text from content", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Channel Story Template",
        baseTemplateId: CHANNEL_STORY_TEMPLATE_ID,
        content: {
          topText: "Did you know?",
          bottomText: "A short dense body block above the source clip.",
          channelName: "History Explained",
          channelHandle: "@HistoryExplained13"
        },
        templateConfig: {
          channelStory: {
            leadMode: "template_default",
            defaultLeadText: "stale lead",
            mediaRadius: 28,
            accentTopLineWidth: 4,
            leadGlowEnabled: true,
            leadGlowColor: "rgba(42,132,255,0.9)",
            leadGlowHeight: 72,
            leadGlowBlur: 26,
            leadGlowOpacity: 1.4,
            leadGlowSpreadX: 230
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.layoutFamily, CHANNEL_STORY_TEMPLATE_ID);
    assert.equal(reloaded?.templateConfig.layoutKind, "channel_story");
    assert.equal(reloaded?.templateConfig.channelStory?.leadMode, "template_default");
    assert.equal(reloaded?.templateConfig.channelStory?.defaultLeadText, "Did you know?");
    assert.equal(reloaded?.templateConfig.channelStory?.mediaRadius, 28);
    assert.equal(reloaded?.templateConfig.channelStory?.accentTopLineWidth, 4);
    assert.equal(reloaded?.templateConfig.channelStory?.leadGlowEnabled, true);
    assert.equal(reloaded?.templateConfig.channelStory?.leadGlowColor, "rgba(42,132,255,0.9)");
    assert.equal(reloaded?.templateConfig.channelStory?.leadGlowHeight, 72);
    assert.equal(reloaded?.templateConfig.channelStory?.leadGlowBlur, 26);
    assert.equal(reloaded?.templateConfig.channelStory?.leadGlowOpacity, 1);
    assert.equal(reloaded?.templateConfig.channelStory?.leadGlowSpreadX, 230);
  });
});
