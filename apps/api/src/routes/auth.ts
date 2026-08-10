import type express from "express";
import { firebaseLoginSchema, userPreferencesSchema } from "../schemas.js";
import {
  clearSessionCookie,
  currentUser,
  exchangeRobloxCode,
  requireUser,
  robloxAuthorizeUrl,
  setOAuthStateCookie,
  setSessionCookie,
  validateOAuthState,
  verifyFirebaseIdToken,
  verifySupabaseIdToken
} from "../services/auth.js";
import {
  config,
  firebaseConfigured,
  robloxOAuthConfigured,
  runtimeAiModels,
  robloxApiKeyConfigured,
  aiConfigured,
  defaultAiModel,
  defaultVisualInspectionModel,
  activePricingEvents
} from "../services/config.js";
import { topUpPacks, planCatalog } from "../services/plans.js";
import { stripeConfigured } from "../services/billing.js";
import { fixedTopUpPricePerThousand, planAmountCents, studioCustomTopUpPricePerThousand } from "../services/pricing.js";
import type { RouteContext } from "../routeContext.js";

async function firstAuthAction(ctx: RouteContext, userId: string, providerAction: string) {
  const events = await ctx.store.fetchCustomerEvidenceForUser(userId);
  return events.some((event) => event.type === "auth") ? providerAction : "signup";
}

export function registerAuthRoutes(app: express.Express, ctx: RouteContext) {
  app.get("/auth/config", async (_req, res) => {
    res.json({
      robloxOAuthConfigured: robloxOAuthConfigured(),
      googleOAuthConfigured: false,
      firebaseConfigured: firebaseConfigured(),
      firebase: {
        apiKey: config.firebase.apiKey,
        authDomain: config.firebase.authDomain,
        projectId: config.firebase.projectId,
        appId: config.firebase.appId,
        storageBucket: config.firebase.storageBucket,
        messagingSenderId: config.firebase.messagingSenderId
      },
      supabaseConfigured: Boolean(config.supabase.url && config.supabase.anonKey),
      supabase: {
        url: config.supabase.url,
        anonKey: config.supabase.anonKey
      },
      robloxApiKeyConfigured: robloxApiKeyConfigured(),
      billing: {
        stripeConfigured: stripeConfigured(),
        proPriceConfigured: Boolean(config.stripe.proPriceId),
        currency: config.stripe.proCurrency,
        customCreditPricePerThousand: studioCustomTopUpPricePerThousand(),
        customCreditDiscountedForStudio: true,
        fixedTopUpPricePerThousand: fixedTopUpPricePerThousand(),
        annualEconomicsCopy: "Annual plans keep the same monthly credit allowance and may consume credits slightly faster to keep usage economics fair.",
        plans: Object.values(planCatalog).map((plan) => ({
          ...plan,
          monthlyPriceCents: planAmountCents(plan.name, "monthly"),
          annualPriceCents: planAmountCents(plan.name, "annual")
        })),
        topUpPacks: Object.values(topUpPacks).map((pack) => ({
          ...pack,
          priceCents: pack.id === "small"
            ? config.stripe.topUpSmallAmountCents
            : config.stripe.topUpLargeAmountCents
        }))
      },
      imageGeneration: {
        model: "disabled",
        outputSize: "1K",
        costCredits: 90,
        estimatedProviderCostUsd: 0
      },
      visualInspection: {
        available: Boolean(defaultVisualInspectionModel()),
        model: defaultVisualInspectionModel()
      },
      privateOwnerLoginEnabled: config.allowPrivateOwnerLogin,
      publicSignupsEnabled: config.publicSignupsEnabled,
      aiConfigured: aiConfigured(),
      aiProvider: config.googleVertex.projectId
        ? "google-vertex"
        : config.yunwu.apiKey
        ? "yunwu"
        : config.xiaomi.apiKey
        ? "xiaomi"
        : config.deepseek.apiKey
        ? "deepseek"
        : "local-fallback",
      defaultModel: defaultAiModel(),
      models: runtimeAiModels(),
      pricingEvents: activePricingEvents()
    });
  });

  app.get("/auth/me", async (req, res) => {
    const user = await currentUser(req);
    res.json({ user: user ?? null });
  });

  app.patch("/user/preferences", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const input = userPreferencesSchema.parse(req.body);
      const preferences = await ctx.store.updateUserPreferences(user.id, input);
      if (!preferences) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ preferences });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/user/account", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const organization = await ctx.store.fetchOrganizationForUser(user.id);

      // Clear session cookie before deletion so the session cannot be reused
      await clearSessionCookie(req, res);

      // Perform deletion first; only write the audit record once we know it succeeded
      await ctx.store.deleteUserAccount(user.id);

      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization?.id,
        type: "deletion",
        action: "delete_account",
        status: "ok"
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/user/export", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const [organization, events, sessions] = await Promise.all([
        ctx.store.fetchOrganizationForUser(user.id),
        ctx.store.fetchCustomerEvidenceForUser(user.id),
        ctx.store.fetchSessionsForUser(user.id).catch(() => [] as import("../types.js").StudioSession[])
      ]);

      const projects = organization
        ? await ctx.store.fetchProjectsForOrganization(organization.id)
        : [];

      const projectDetails = await Promise.all(
        projects.map(async (project) => {
          const [threads, attachments] = await Promise.all([
            ctx.store.fetchThreadsForProject(project.id),
            ctx.store.fetchAttachmentsForProject(project.id)
          ]);
          return { projectId: project.id, projectName: project.name, threadCount: threads.length, attachmentCount: attachments.length };
        })
      );

      const creditBalance = organization ? await ctx.store.getCreditBalance(organization.id) : 0;
      const usage = organization ? await ctx.store.getUsageStats(organization.id) : undefined;

      // Return only the user's own data; omit internal admin metadata and raw IPs
      res.json({
        generatedAt: new Date().toISOString(),
        profile: {
          id: user.id,
          name: user.name,
          email: user.email,
          authProvider: user.authProvider,
          createdAt: user.createdAt
        },
        plan: organization?.plan ?? "free",
        creditBalance,
        usage: usage ? {
          weeklyAllowance: usage.weekly.allowance,
          weeklyRemaining: usage.weekly.remaining,
          monthlyAllowance: usage.monthly.allowance,
          monthlyUsed: usage.monthly.used,
          monthlyRemaining: usage.monthly.remaining
        } : undefined,
        projects: projectDetails,
        studioSessionCount: sessions.length,
        events: events
          .filter((event) => event.type !== "admin")
          .map((event) => ({
            type: event.type,
            action: event.action,
            status: event.status,
            amountCredits: event.amountCredits,
            createdAt: event.createdAt
          }))
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/private-owner", ctx.authLimiter, async (req, res) => {
    if (!config.allowPrivateOwnerLogin) {
      res.status(403).json({ error: "Private owner login is disabled" });
      return;
    }
    if (config.isProduction) {
      res.status(403).json({ error: "Private owner login is disabled" });
      return;
    }
    if (config.privateOwnerLoginSecret) {
      const provided = typeof req.headers["x-private-owner-secret"] === "string"
        ? req.headers["x-private-owner-secret"]
        : typeof req.body?.secret === "string"
          ? req.body.secret
          : "";
      if (provided !== config.privateOwnerLoginSecret) {
        res.status(403).json({ error: "Private owner login is disabled" });
        return;
      }
    }

    const user = await ctx.store.ensurePrivateOwner();
    await ctx.store.ensureProjectForUser(user.id);
    await setSessionCookie(res, user.id);
    const organization = await ctx.store.fetchOrganizationForUser(user.id);
    await ctx.recordEvidence(req, {
      userId: user.id,
      organizationId: organization?.id,
      type: "auth",
      action: "private_owner_login",
      status: "ok"
    });
    res.json({ user });
  });

  app.post("/auth/firebase", ctx.authLimiter, async (req, res, next) => {
    try {
      if (!firebaseConfigured()) {
        res.status(503).json({ error: "Firebase Auth is not configured yet" });
        return;
      }

      const input = firebaseLoginSchema.parse(req.body);
      const user = await verifyFirebaseIdToken(input.idToken);
      await setSessionCookie(res, user.id);
      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      const action = await firstAuthAction(ctx, user.id, "firebase_login");
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization?.id,
        type: "auth",
        action,
        status: "ok",
        metadata: { provider: "firebase" }
      });
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/supabase", ctx.authLimiter, async (req, res, next) => {
    try {
      const idToken = String(req.body.idToken ?? "");
      if (!idToken) {
        res.status(400).json({ error: "Missing idToken" });
        return;
      }

      const user = await verifySupabaseIdToken(idToken);
      await setSessionCookie(res, user.id);
      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      const action = await firstAuthAction(ctx, user.id, "supabase_login");
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization?.id,
        type: "auth",
        action,
        status: "ok",
        metadata: { provider: "supabase" }
      });
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/roblox", ctx.authLimiter, async (_req, res) => {
    if (!robloxOAuthConfigured()) {
      res.status(503).json({ error: "Roblox OAuth is not configured yet" });
      return;
    }
    const state = setOAuthStateCookie(res);
    res.redirect(robloxAuthorizeUrl(state));
  });

  app.get("/auth/roblox/callback", ctx.authLimiter, async (req, res, next) => {
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");

      if (!code || !validateOAuthState(req, res, state)) {
        res.redirect(`${config.webAppUrl}/?auth=failed`);
        return;
      }

      const user = await exchangeRobloxCode(code);
      await setSessionCookie(res, user.id);
      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      const action = await firstAuthAction(ctx, user.id, "roblox_login");
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization?.id,
        type: "auth",
        action,
        status: "ok",
        metadata: { provider: "roblox" }
      });
      res.redirect(config.webAppUrl);
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/logout", ctx.authLimiter, async (req, res) => {
    const user = await currentUser(req);
    const organization = user ? await ctx.store.fetchOrganizationForUser(user.id) : undefined;
    await clearSessionCookie(req, res);
    await ctx.recordEvidence(req, {
      userId: user?.id,
      organizationId: organization?.id,
      type: "auth",
      action: "logout",
      status: "ok"
    });
    res.json({ ok: true });
  });
}
