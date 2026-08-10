import { describe, expect, it } from "vitest";

import { classifyStudioTool } from "@vectiscode/roblox";
import { ProviderRegistry } from "@vectiscode/providers";
import { FakeProvider } from "@vectiscode/testkit";

describe("CLI wiring", () => {
  it("rejects duplicate provider ids", () => {
    expect(() => new ProviderRegistry([new FakeProvider([]), new FakeProvider([])])).toThrow("Duplicate provider id");
  });

  it("treats unknown Studio tools as approval-required", () => {
    expect(classifyStudioTool("future_tool")).toBe("unknown");
    expect(classifyStudioTool("multi_edit")).toBe("write");
    expect(classifyStudioTool("script_read")).toBe("read");
  });
});
