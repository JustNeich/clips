export type JsonSchemaTransport = {
  schema: unknown;
  prompt: string;
  unwrap: (value: unknown) => unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allowNullInSchema(schema: unknown): unknown {
  if (!isPlainObject(schema)) {
    return schema;
  }

  const typeValue = schema.type;
  if (typeof typeValue === "string") {
    if (typeValue === "null") {
      return schema;
    }
    return {
      ...schema,
      type: [typeValue, "null"]
    };
  }

  if (Array.isArray(typeValue)) {
    if (typeValue.includes("null")) {
      return schema;
    }
    return {
      ...schema,
      type: [...typeValue, "null"]
    };
  }

  return schema;
}

function strictifyJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => strictifyJsonSchema(item));
  }

  if (!isPlainObject(schema)) {
    return schema;
  }

  const next: Record<string, unknown> = { ...schema };

  if ("items" in schema) {
    next.items = strictifyJsonSchema(schema.items);
  }

  if (isPlainObject(schema.additionalProperties)) {
    next.additionalProperties = strictifyJsonSchema(schema.additionalProperties);
  }

  if (!isPlainObject(schema.properties)) {
    return next;
  }

  const originalRequired = Array.isArray(schema.required)
    ? schema.required.map((value) => String(value))
    : [];
  const propertyEntries = Object.entries(schema.properties);
  const strictProperties = Object.fromEntries(
    propertyEntries.map(([key, value]) => {
      const normalizedProperty = strictifyJsonSchema(value);
      return [
        key,
        originalRequired.includes(key)
          ? normalizedProperty
          : allowNullInSchema(normalizedProperty)
      ];
    })
  );

  next.properties = strictProperties;
  next.required = propertyEntries.map(([key]) => key);
  return next;
}

export function prepareJsonSchemaTransport(input: {
  schema: unknown;
  prompt: string;
}): JsonSchemaTransport {
  const strictSchema = strictifyJsonSchema(input.schema);
  const schemaObject = isPlainObject(strictSchema) ? strictSchema : null;
  if (schemaObject?.type === "object") {
    return {
      schema: strictSchema,
      prompt: input.prompt,
      unwrap: (value) => value
    };
  }

  const wrappedSchema = {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: {
      result: strictSchema
    }
  };

  const wrappedPrompt = [
    input.prompt.trim(),
    "",
    "TRANSPORT FORMAT RULE:",
    '- The response must be a single JSON object with exactly one key: "result".',
    '- Put the actual requested payload inside "result".',
    '- The value of "result" must satisfy the requested schema.'
  ].join("\n");

  return {
    schema: wrappedSchema,
    prompt: wrappedPrompt,
    unwrap: (value) => {
      if (isPlainObject(value) && "result" in value) {
        return value.result;
      }
      return value;
    }
  };
}
