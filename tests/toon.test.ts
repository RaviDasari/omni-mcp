import { describe, expect, it } from "vitest";
import { encodeValue, toToon, toonifyResult } from "../src/toon.js";

const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `user${i}`, active: true }));

describe("toToon", () => {
  it("converts a uniform array of objects to a shorter tabular form", () => {
    const text = JSON.stringify(rows);
    const out = toToon(text)!;
    expect(out).toBeDefined();
    expect(out.length).toBeLessThan(text.length);
    expect(out).toContain("user0");
    expect(out).not.toContain('"name"');
  });

  it("converts nested objects", () => {
    const text = JSON.stringify({ user: { id: 1, tags: ["a", "b"] }, items: rows });
    expect(toToon(text)).toBeDefined();
  });

  it("ignores non-JSON text and JSON scalars", () => {
    expect(toToon("created")).toBeUndefined();
    expect(toToon("42")).toBeUndefined();
    expect(toToon('"hello"')).toBeUndefined();
    expect(toToon("null")).toBeUndefined();
  });

  it("returns undefined when TOON would not be shorter", () => {
    expect(toToon("{}")).toBeUndefined();
    expect(toToon("[]")).toBeUndefined();
  });
});

describe("toonifyResult", () => {
  it("rewrites JSON text items and keeps structuredContent and other items", () => {
    const result = {
      content: [
        { type: "text", text: JSON.stringify(rows) },
        { type: "text", text: "plain" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
      structuredContent: { rows },
      isError: false,
    };
    const out = toonifyResult(result);
    expect(out.content[0]!.text).not.toBe(result.content[0]!.text);
    expect(out.content[1]).toEqual(result.content[1]);
    expect(out.content[2]).toEqual(result.content[2]);
    expect(out.structuredContent).toEqual({ rows });
    expect(out.isError).toBe(false);
    expect(result.content[0]!.text).toBe(JSON.stringify(rows));
  });
});

describe("encodeValue", () => {
  it("encodes objects as TOON and falls back to JSON for scalars", () => {
    expect(encodeValue(rows)).not.toContain('"name"');
    expect(encodeValue("x")).toBe('"x"');
  });
});
