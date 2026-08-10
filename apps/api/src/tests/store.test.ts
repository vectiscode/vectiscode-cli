import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../services/store.js";

describe("persistent store contracts", () => {
  beforeEach(async () => {
    await store.reset();
  });

  it("keeps one ledger entry for an idempotent credit grant", async () => {
    const user = await store.ensurePrivateOwner();
    const organization = await store.fetchOrganizationForUser(user.id);
    expect(organization).toBeTruthy();

    const entryId = "ledger_idempotent_store_test";
    const first = await store.addCreditsOnce(entryId, organization!.id, 250, "Store contract grant");
    const second = await store.addCreditsOnce(entryId, organization!.id, 250, "Store contract grant");

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    const matchingEntries = (await store.fetchLedgerForOrganization(organization!.id))
      .filter((entry) => entry.id === entryId);
    expect(matchingEntries).toHaveLength(1);
  });

  it("serializes concurrent local credit deductions", async () => {
    const user = await store.ensurePrivateOwner();
    const organization = await store.fetchOrganizationForUser(user.id);
    expect(organization).toBeTruthy();

    const balance = await store.getCreditBalance(organization!.id);
    const amount = Math.max(1, balance);
    const results = await Promise.all([
      store.tryDeductCredits(organization!.id, amount, "Concurrent debit A"),
      store.tryDeductCredits(organization!.id, amount, "Concurrent debit B")
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await store.getCreditBalance(organization!.id)).toBe(0);
  });

  it("counts reserved AI usage after returning the unused portion", async () => {
    const user = await store.ensurePrivateOwner();
    const organization = await store.fetchOrganizationForUser(user.id);
    expect(organization).toBeTruthy();
    const createdAt = new Date().toISOString();

    await store.saveLedger({
      id: "ledger_reserved_chat_usage",
      organizationId: organization!.id,
      delta: -50,
      reason: "Reserved AI response (gemini-3.5-flash)",
      createdAt
    });
    await store.saveLedger({
      id: "ledger_reserved_chat_refund",
      organizationId: organization!.id,
      delta: 20,
      reason: "Refund unused AI reservation (final response)",
      createdAt
    });
    await store.saveLedger({
      id: "ledger_reserved_edit_usage",
      organizationId: organization!.id,
      delta: -40,
      reason: "Reserved edited Roblox change set (gemini-3.5-flash)",
      createdAt
    });
    await store.saveLedger({
      id: "ledger_icon_refund",
      organizationId: organization!.id,
      delta: 12,
      reason: "Refund for failed generated transparent icon",
      createdAt
    });

    const usage = await store.getUsageStats(organization!.id);
    // 50 reserved chat + 40 reserved edit - 20 unused reservation refund - 12 icon refund
    expect(usage.monthly.used).toBe(58);
  });

  it("refills weekly capacity only once under concurrent callers", async () => {
    const user = await store.ensurePrivateOwner();
    const organization = await store.fetchOrganizationForUser(user.id);
    expect(organization).toBeTruthy();

    organization!.plan = "starter";
    organization!.lastRefillAt = "2020-01-01T00:00:00.000Z";
    await store.saveOrganization(organization!);
    // Drain balance so a refill is required.
    const balance = await store.getCreditBalance(organization!.id);
    if (balance > 0) {
      await store.addCredits(organization!.id, -balance, "Test drain before concurrent refill");
    }

    await Promise.all([
      store.checkWeeklyRefill(organization!.id),
      store.checkWeeklyRefill(organization!.id),
      store.checkWeeklyRefill(organization!.id)
    ]);

    expect(await store.getCreditBalance(organization!.id)).toBe(1000);
    const refillEntries = (await store.fetchLedgerForOrganization(organization!.id))
      .filter((entry) => /Weekly capacity refill/i.test(entry.reason));
    expect(refillEntries).toHaveLength(1);
  });

  it("updates and retrieves user preferences without dropping existing fields", async () => {
    const user = await store.ensurePrivateOwner();
    await store.updateUserPreferences(user.id, { theme: "dark", usageOptimizer: true });
    await store.updateUserPreferences(user.id, { verificationMode: "deep" });

    const updated = await store.fetchUser(user.id);
    expect(updated?.preferences).toMatchObject({
      theme: "dark",
      usageOptimizer: true,
      verificationMode: "deep"
    });
  });

  it("includes persisted organization usage in admin user statistics", async () => {
    const user = await store.ensurePrivateOwner();
    const organization = await store.fetchOrganizationForUser(user.id);
    expect(organization).toBeTruthy();
    await store.addCredits(organization!.id, 75, "Admin balance grant");

    const users = await store.fetchAllUsersWithStats();
    const adminUser = users.find((candidate) => candidate.id === user.id);
    expect(adminUser?.organizationId).toBe(organization!.id);
    expect(adminUser?.credits).toBe(await store.getCreditBalance(organization!.id));
    expect(adminUser?.usage?.monthly.adminGrantedCredits).toBeGreaterThanOrEqual(75);
  });

});
