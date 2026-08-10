import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { WEB_CSP } from "../csp";

test("CSP directives in api/csp.ts and web/public/_headers match exactly", () => {
  const headersPath = path.resolve(__dirname, "../../../web/public/_headers");
  
  // Verify that the _headers file exists
  expect(fs.existsSync(headersPath)).toBe(true);
  
  const headersContent = fs.readFileSync(headersPath, "utf8");
  
  // Extract Content-Security-Policy directive line from _headers
  const match = headersContent.match(/Content-Security-Policy:\s*([^\r\n]+)/);
  expect(match).not.toBeNull();
  
  const headersCsp = match![1].trim();
  
  // Assert both CSP directives are equivalent
  expect(headersCsp).toBe(WEB_CSP);
});
