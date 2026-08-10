import express from "express";
import { z } from "zod";
import type { RouteContext } from "../routeContext.js";
import { discordBot } from "../services/discordBot.js";
import { discordConfigured, config } from "../services/config.js";

export function registerDiscordRoutes(app: express.Express, ctx: RouteContext) {
  app.get("/discord/status", async (_req, res) => {
    res.json({
      configured: discordConfigured(),
      ready: discordBot.isReady(),
      guildId: config.discord.guildId || undefined,
      channels: {
        announcements: config.discord.announcementsChannelId || undefined,
        suggestions: config.discord.suggestionsChannelId || undefined,
        changelog: config.discord.changelogChannelId || undefined,
        status: config.discord.statusChannelId || undefined
      }
    });
  });

  app.get("/discord/suggestions", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;

      res.json({ suggestions: discordBot.getSuggestions() });
    } catch (e) {
      next(e);
    }
  });

  const postAnnouncementSchema = z.object({
    title: z.string().min(1).max(256),
    text: z.string().min(1).max(4000)
  });

  app.post("/discord/announce", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;

      const input = postAnnouncementSchema.parse(req.body);
      const posted = await discordBot.postAnnouncement(input.title, input.text);
      res.json({ ok: posted });
    } catch (e) {
      next(e);
    }
  });

  const postChangelogSchema = z.object({
    version: z.string().min(1).max(50),
    changes: z.array(z.string().min(1).max(200)).min(1).max(20)
  });

  app.post("/discord/changelog", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;

      const input = postChangelogSchema.parse(req.body);
      const posted = await discordBot.postChangelog(input.version, input.changes);
      res.json({ ok: posted });
    } catch (e) {
      next(e);
    }
  });

  const markSuggestionSchema = z.object({
    suggestionId: z.string().min(1),
    status: z.enum(["shipped", "declined"])
  });

  app.post("/discord/suggestions/status", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;

      const input = markSuggestionSchema.parse(req.body);
      let ok = false;
      if (input.status === "shipped") {
        ok = await discordBot.markSuggestionShipped(input.suggestionId);
      } else {
        ok = await discordBot.markSuggestionDeclined(input.suggestionId);
      }
      res.json({ ok });
    } catch (e) {
      next(e);
    }
  });
}
