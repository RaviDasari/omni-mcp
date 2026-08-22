import { describe, it, expect } from "vitest";
import {
  omitOptionalNulls,
  schemaTemplate,
} from "../../web/src/lib/schema-template.js";

function template(schema?: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(schemaTemplate(schema)) as Record<string, unknown>;
}

describe("schemaTemplate", () => {
  it("includes optional properties so tools with the same required fields differ", () => {
    const buildInfo = {
      type: "object",
      properties: {
        repository: { type: "string" },
        branch: { type: "string" },
      },
      required: ["repository", "branch"],
    };
    const failedTests = {
      type: "object",
      properties: {
        repository: { type: "string" },
        branch: { type: "string" },
        buildNumber: { type: "number" },
        limit: { type: "number" },
      },
      required: ["repository", "branch"],
    };

    expect(template(buildInfo)).toEqual({ repository: "", branch: "" });
    expect(template(failedTests)).toEqual({
      repository: "",
      branch: "",
      buildNumber: null,
      limit: null,
    });
    expect(schemaTemplate(buildInfo)).not.toBe(schemaTemplate(failedTests));
  });

  it("orders required fields before optional ones", () => {
    const keys = Object.keys(
      template({
        type: "object",
        properties: {
          limit: { type: "number" },
          repository: { type: "string" },
        },
        required: ["repository"],
      }),
    );
    expect(keys).toEqual(["repository", "limit"]);
  });

  it("uses typed placeholders for required fields and known values when provided", () => {
    expect(
      template({
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "integer" },
          flag: { type: "boolean" },
          items: { type: "array" },
          nested: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
          mode: { type: "string", enum: ["fast", "slow"] },
          size: { type: "number", default: 100 },
        },
        required: ["name", "count", "flag", "items", "nested", "mode"],
      }),
    ).toEqual({
      name: "",
      count: 0,
      flag: false,
      items: [],
      nested: { id: "" },
      mode: "fast",
      size: 100,
    });
  });

  it("resolves local $ref pointers instead of yielding an empty object", () => {
    expect(
      template({
        $ref: "#/definitions/Args",
        definitions: {
          Args: {
            type: "object",
            properties: { path: { type: "string" }, depth: { type: "integer" } },
            required: ["path"],
          },
        },
      }),
    ).toEqual({ path: "", depth: null });
  });

  it("returns an empty object for a missing or unusable schema", () => {
    expect(template(undefined)).toEqual({});
    expect(template({ type: "string" })).toEqual({});
  });
});

describe("omitOptionalNulls", () => {
  it("drops untouched optional fields but keeps required and explicit values", () => {
    const schema = {
      type: "object",
      properties: {
        repository: { type: "string" },
        buildNumber: { type: "number" },
        limit: { type: "number" },
      },
      required: ["repository"],
    };

    expect(
      omitOptionalNulls(
        { repository: "webui", buildNumber: null, limit: 25 },
        schema,
      ),
    ).toEqual({ repository: "webui", limit: 25 });
  });

  it("keeps a null that the schema marks as required", () => {
    expect(omitOptionalNulls({ value: null }, { required: ["value"] })).toEqual({ value: null });
  });
});
