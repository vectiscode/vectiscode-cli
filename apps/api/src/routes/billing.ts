import type express from "express";
import { checkoutSchema, topUpSchema } from "../schemas.js";
import {
  cancelSubscriptionAtPeriodEnd,
  createBillingPortalSession,
  createPlanCheckoutSession,
  createTopUpCheckoutSession,
  getBillingStatus,
  priceIdForPlan,
  stripeConfigured
} from "../services/billing.js";
import { config } from "../services/config.js";
import { planAllowsTopUps } from "../services/plans.js";
import { requireUser } from "../services/auth.js";
import type { RouteContext } from "../routeContext.js";

export function registerBillingRoutes(app: express.Express, ctx: RouteContext) {
  app.post("/billing/checkout", ctx.billingLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const input = checkoutSchema.parse(req.body);

      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      if (!organization) {
        res.status(500).json({ error: "No organization found for user" });
        return;
      }
      if (!stripeConfigured()) {
        res.status(503).json({ error: "Stripe billing is not configured yet." });
        return;
      }

      const session = await createPlanCheckoutSession(user, organization, input.plan, input.billingCycle);
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization.id,
        type: "billing",
        action: "checkout_created",
        status: "ok",
        stripeCustomerId: organization.stripeCustomerId,
        stripeSessionId: session.id,
        metadata: {
          plan: input.plan,
          billingCycle: input.billingCycle,
          stripePriceId: priceIdForPlan(input.plan, input.billingCycle) || null,
          checkoutMode: priceIdForPlan(input.plan, input.billingCycle) ? "price_id" : "inline_price_data",
          currency: config.stripe.proCurrency
        }
      });
      res.json({ url: session.url });
    } catch (error) {
      next(error);
    }
  });

  app.get("/billing/status", ctx.billingLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      if (!organization) {
        res.status(500).json({ error: "No organization found for user" });
        return;
      }

      res.json(await getBillingStatus(organization));
    } catch (error) {
      next(error);
    }
  });

  app.post("/billing/cancel", ctx.billingLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      if (!organization) {
        res.status(500).json({ error: "No organization found for user" });
        return;
      }

      res.json(await cancelSubscriptionAtPeriodEnd(organization));
    } catch (error) {
      next(error);
    }
  });

  app.post("/billing/top-up", ctx.billingLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const input = topUpSchema.parse(req.body);

      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      if (!organization) {
        res.status(500).json({ error: "No organization found for user" });
        return;
      }
      if (!planAllowsTopUps(organization.plan)) {
        res.status(403).json({ error: "Extra usage is only available on Studio." });
        return;
      }
      if (!stripeConfigured()) {
        res.status(503).json({ error: "Stripe billing is not configured yet." });
        return;
      }

      const session = await createTopUpCheckoutSession(user, organization, input);
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization.id,
        type: "billing",
        action: "top_up_checkout_created",
        status: "ok",
        stripeCustomerId: organization.stripeCustomerId,
        stripeSessionId: session.id,
        metadata: {
          input,
          currency: config.stripe.proCurrency
        }
      });
      res.json({ url: session.url });
    } catch (error) {
      next(error);
    }
  });

  app.post("/billing/portal", ctx.billingLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const organization = await ctx.store.fetchOrganizationForUser(user.id);
      if (!organization) {
        res.status(500).json({ error: "No organization found for user" });
        return;
      }

      const session = await createBillingPortalSession(organization);
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: organization.id,
        type: "billing",
        action: "billing_portal_created",
        status: "ok",
        stripeCustomerId: organization.stripeCustomerId,
        stripeSubscriptionId: organization.stripeSubscriptionId,
        metadata: {
          returnUrl: config.stripe.portalReturnUrl
        }
      });
      res.json({ url: session.url });
    } catch (error) {
      next(error);
    }
  });
}
