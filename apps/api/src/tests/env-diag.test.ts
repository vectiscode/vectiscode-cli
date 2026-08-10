import { describe, it } from "vitest";
import { aiConfigured, config } from "../services/config.js";

describe("Environment Diagnostics", () => {
  it("prints current active environment options", () => {
    console.log("=== AI ENVIRONMENT DIAGNOSTICS ===");
    console.log("aiConfigured:", aiConfigured());
    console.log("defaultAiModel:", config.defaultAiModel);
    console.log("YUNWU_API_KEY:", process.env.YUNWU_API_KEY ? "CONFIGURED" : "MISSING");
    console.log("DEEPSEEK_API_KEY:", process.env.DEEPSEEK_API_KEY ? "CONFIGURED" : "MISSING");
    console.log("XIAOMI_API_KEY:", process.env.XIAOMI_API_KEY ? "CONFIGURED" : "MISSING");
    console.log("==================================");
  });
});
