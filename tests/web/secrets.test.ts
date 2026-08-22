import { describe, expect, it } from "vitest";
import { isValidSecretName } from "../../web/src/lib/secrets.js";

describe("managed secrets web helpers", () => {
  it("accepts environment-style variable names", () => {
    expect(isValidSecretName("JIRA_TOKEN")).toBe(true);
    expect(isValidSecretName("_PRIVATE_2")).toBe(true);
  });

  it("rejects names that cannot be referenced as $NAME", () => {
    expect(isValidSecretName("2TOKEN")).toBe(false);
    expect(isValidSecretName("jira-token")).toBe(false);
    expect(isValidSecretName("")).toBe(false);
  });
});

