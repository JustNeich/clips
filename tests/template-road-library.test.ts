import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateRoadTemplateOptions,
  describeUnavailableTemplate,
  formatUnavailableTemplateOptionLabel
} from "../lib/template-road-library";

test("template-road keeps an unavailable template placeholder at the top of the selector", () => {
  const options = buildTemplateRoadTemplateOptions({
    templates: [
      {
        id: "template-a",
        name: "Template A",
        description: "",
        layoutFamily: "science-card-v1",
        baseTemplateId: "science-card-v1",
        workspaceId: "workspace-1",
        creatorUserId: null,
        creatorDisplayName: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        versionsCount: 0
      }
    ],
    unavailableTemplate: {
      templateId: "archived-template",
      status: "archived"
    }
  });

  assert.deepEqual(options, [
    {
      value: "archived-template",
      label: "Недоступен (архивирован): archived-template",
      unavailable: true
    },
    {
      value: "template-a",
      label: "Template A",
      unavailable: false
    }
  ]);
});

test("template-road does not duplicate the unavailable placeholder when the template is already visible", () => {
  const options = buildTemplateRoadTemplateOptions({
    templates: [
      {
        id: "template-a",
        name: "Template A",
        description: "",
        layoutFamily: "science-card-v1",
        baseTemplateId: "science-card-v1",
        workspaceId: "workspace-1",
        creatorUserId: null,
        creatorDisplayName: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        versionsCount: 0
      }
    ],
    unavailableTemplate: {
      templateId: "template-a",
      status: "missing"
    }
  });

  assert.equal(options.length, 1);
  assert.equal(options[0]?.value, "template-a");
  assert.equal(options[0]?.unavailable, false);
});

test("template-road unavailable copy distinguishes archived and missing template refs", () => {
  assert.equal(
    formatUnavailableTemplateOptionLabel({
      templateId: "archived-template",
      status: "archived"
    }),
    "Недоступен (архивирован): archived-template"
  );
  assert.equal(
    describeUnavailableTemplate({
      templateId: "missing-template",
      status: "missing"
    }),
    "Шаблон missing-template не найден. Возможно, ссылка устарела или шаблон был удалён вне текущей библиотеки."
  );
});
