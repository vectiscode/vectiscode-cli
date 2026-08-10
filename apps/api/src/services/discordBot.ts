import {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageReaction,
  User,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  InteractionReplyOptions,
  PartialMessageReaction,
  PartialUser
} from "discord.js";
import { config, discordConfigured } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger({ service: "discord-bot" });

const UPVOTE_EMOJI = "👍";
const DOWNVOTE_EMOJI = "👎";

interface SuggestionData {
  id: string;
  authorTag: string;
  authorId: string;
  text: string;
  messageId: string;
  channelId: string;
  upvotes: number;
  downvotes: number;
  status: "open" | "shipped" | "declined";
  createdAt: string;
  shippedAt?: string;
}

const suggestions = new Map<string, SuggestionData>();
let suggestionCounter = 0;

class DiscordBotService {
  private client: Client | null = null;
  private ready = false;
  private starting = false;

  isReady() {
    return this.ready;
  }

  getClient() {
    return this.client;
  }

  async start() {
    if (!discordConfigured()) {
      log.info("Discord bot not configured. Skipping startup.");
      return;
    }
    if (this.starting) return;
    this.starting = true;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
      ]
    });

    this.client.once(Events.ClientReady, async (c) => {
      log.info("Discord bot connected", { user: c.user.tag, guilds: c.guilds.cache.size });
      this.ready = true;
      await this.registerSlashCommands(c.user.id);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (user.bot) return;
      await this.handleReactionAdd(reaction, user);
    });

    this.client.on(Events.MessageReactionRemove, async (reaction, user) => {
      if (user.bot) return;
      await this.handleReactionRemove(reaction, user);
    });

    this.client.on(Events.Error, (error) => {
      log.error("Discord client error", { error: String(error) });
    });

    try {
      await this.client.login(config.discord.botToken);
    } catch (error) {
      log.error("Failed to connect Discord bot", { error: String(error) });
      this.starting = false;
    }
  }

  async stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.ready = false;
      this.starting = false;
    }
  }

  private async registerSlashCommands(appId: string) {
    const commands = [
      new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show Vectis Code bot status and API health"),
      new SlashCommandBuilder()
        .setName("suggest")
        .setDescription("Submit a feature suggestion")
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("Your suggestion")
            .setRequired(true)
            .setMaxLength(2000)
        ),
      new SlashCommandBuilder()
        .setName("shipped")
        .setDescription("List recently shipped features")
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("Number of items to show (default 10)")
            .setMinValue(1)
            .setMaxValue(25)
        ),
      new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Post an announcement to the announcements channel (admin only)")
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Announcement title")
            .setRequired(true)
            .setMaxLength(256)
        )
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("Announcement body")
            .setRequired(true)
            .setMaxLength(4000)
        )
    ];

    if (!config.discord.guildId) {
      log.warn("DISCORD_GUILD_ID not set. Skipping command registration.");
      return;
    }

    const rest = new REST({ version: "10" }).setToken(config.discord.botToken);
    try {
      await rest.put(Routes.applicationGuildCommands(appId, config.discord.guildId), {
        body: commands.map((cmd) => cmd.toJSON())
      });
      log.info("Slash commands registered", { guildId: config.discord.guildId, count: commands.length });
    } catch (error) {
      log.error("Failed to register slash commands", { error: String(error) });
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction) {
    const { commandName } = interaction;

    if (commandName === "status") {
      await this.handleStatusCommand(interaction);
    } else if (commandName === "suggest") {
      await this.handleSuggestCommand(interaction);
    } else if (commandName === "shipped") {
      await this.handleShippedCommand(interaction);
    } else if (commandName === "announce") {
      await this.handleAnnounceCommand(interaction);
    }
  }

  private async handleStatusCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const embed = new EmbedBuilder()
      .setTitle("Vectis Code - Bot Status")
      .setColor(0x00d4aa)
      .addFields(
        { name: "API Uptime", value: `${hours}h ${minutes}m`, inline: true },
        { name: "Guilds", value: String(this.client?.guilds.cache.size ?? 0), inline: true },
        { name: "Suggestions", value: String(suggestions.size), inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleSuggestCommand(interaction: ChatInputCommandInteraction) {
    const text = interaction.options.getString("text", true);
    const suggestionId = `sug_${++suggestionCounter}_${Date.now()}`;

    const embed = new EmbedBuilder()
      .setTitle(`Suggestion #${suggestionCounter}`)
      .setDescription(text)
      .setColor(0x5865f2)
      .setAuthor({
        name: interaction.user.tag,
        iconURL: interaction.user.displayAvatarURL()
      })
      .addFields(
        { name: "Status", value: "Open", inline: true },
        { name: "Votes", value: `👍 0 | 👎 0`, inline: true }
      )
      .setFooter({ text: `ID: ${suggestionId}` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sug_upvote_${suggestionId}`)
        .setLabel("Upvote")
        .setStyle(ButtonStyle.Success)
        .setEmoji(UPVOTE_EMOJI),
      new ButtonBuilder()
        .setCustomId(`sug_downvote_${suggestionId}`)
        .setLabel("Downvote")
        .setStyle(ButtonStyle.Danger)
        .setEmoji(DOWNVOTE_EMOJI)
    );

    const channel = this.client?.channels.cache.get(config.discord.suggestionsChannelId);
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: "Suggestions channel not configured.", ephemeral: true });
      return;
    }

    const msg = await (channel as TextChannel).send({ embeds: [embed], components: [row] });

    suggestions.set(suggestionId, {
      id: suggestionId,
      authorTag: interaction.user.tag,
      authorId: interaction.user.id,
      text,
      messageId: msg.id,
      channelId: config.discord.suggestionsChannelId,
      upvotes: 0,
      downvotes: 0,
      status: "open",
      createdAt: new Date().toISOString()
    });

    await interaction.reply({
      content: `Suggestion submitted! [View it](https://discord.com/channels/${config.discord.guildId}/${config.discord.suggestionsChannelId}/${msg.id})`,
      ephemeral: true
    });
  }

  private async handleShippedCommand(interaction: ChatInputCommandInteraction) {
    const count = interaction.options.getInteger("count") ?? 10;
    const shipped = [...suggestions.values()]
      .filter((s) => s.status === "shipped")
      .sort((a, b) => (b.shippedAt ?? "").localeCompare(a.shippedAt ?? ""))
      .slice(0, count);

    if (shipped.length === 0) {
      await interaction.reply({ content: "No shipped suggestions yet.", ephemeral: true });
      return;
    }

    const list = shipped
      .map((s, i) => `${i + 1}. **${s.text.slice(0, 80)}** (by ${s.authorTag}) - 👍 ${s.upvotes}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Recently Shipped Features")
      .setDescription(list)
      .setColor(0x00d4aa)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleAnnounceCommand(interaction: ChatInputCommandInteraction) {
    const title = interaction.options.getString("title", true);
    const text = interaction.options.getString("text", true);

    const channel = this.client?.channels.cache.get(config.discord.announcementsChannelId);
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: "Announcements channel not configured.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(text)
      .setColor(0x00d4aa)
      .setAuthor({
        name: "Vectis Code",
        iconURL: this.client?.user?.displayAvatarURL()
      })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
    await interaction.reply({ content: "Announcement posted!", ephemeral: true });
  }

  private async handleReactionAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const suggestion = this.findSuggestionByMessageId(reaction.message.id);
    if (!suggestion) return;

    if (reaction.emoji.name === UPVOTE_EMOJI) {
      suggestion.upvotes++;
    } else if (reaction.emoji.name === DOWNVOTE_EMOJI) {
      suggestion.downvotes++;
    }

    await this.updateSuggestionEmbed(suggestion);
  }

  private async handleReactionRemove(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const suggestion = this.findSuggestionByMessageId(reaction.message.id);
    if (!suggestion) return;

    if (reaction.emoji.name === UPVOTE_EMOJI && suggestion.upvotes > 0) {
      suggestion.upvotes--;
    } else if (reaction.emoji.name === DOWNVOTE_EMOJI && suggestion.downvotes > 0) {
      suggestion.downvotes--;
    }

    await this.updateSuggestionEmbed(suggestion);
  }

  private findSuggestionByMessageId(messageId: string): SuggestionData | undefined {
    for (const sug of suggestions.values()) {
      if (sug.messageId === messageId) return sug;
    }
    return undefined;
  }

  private async updateSuggestionEmbed(suggestion: SuggestionData) {
    const channel = this.client?.channels.cache.get(suggestion.channelId);
    if (!channel || !channel.isTextBased()) return;

    try {
      const msg = await (channel as TextChannel).messages.fetch(suggestion.messageId);
      const oldEmbed = msg.embeds[0];
      if (!oldEmbed) return;

      const embed = EmbedBuilder.from(oldEmbed)
        .setFields(
          { name: "Status", value: suggestion.status === "shipped" ? "Shipped" : suggestion.status === "declined" ? "Declined" : "Open", inline: true },
          { name: "Votes", value: `👍 ${suggestion.upvotes} | 👎 ${suggestion.downvotes}`, inline: true }
        );

      await msg.edit({ embeds: [embed] });
    } catch (error) {
      log.warn("Failed to update suggestion embed", { suggestionId: suggestion.id, error: String(error) });
    }
  }

  async markSuggestionShipped(suggestionId: string) {
    const suggestion = suggestions.get(suggestionId);
    if (!suggestion) return false;

    suggestion.status = "shipped";
    suggestion.shippedAt = new Date().toISOString();
    await this.updateSuggestionEmbed(suggestion);
    return true;
  }

  async markSuggestionDeclined(suggestionId: string) {
    const suggestion = suggestions.get(suggestionId);
    if (!suggestion) return false;

    suggestion.status = "declined";
    await this.updateSuggestionEmbed(suggestion);
    return true;
  }

  async postEmbed(channelId: string, embed: EmbedBuilder) {
    if (!this.ready || !this.client) return false;
    const channel = this.client.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return false;

    try {
      await (channel as TextChannel).send({ embeds: [embed] });
      return true;
    } catch (error) {
      log.error("Failed to post Discord embed", { channelId, error: String(error) });
      return false;
    }
  }

  async postAnnouncement(title: string, text: string) {
    if (!config.discord.announcementsChannelId) return false;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(text)
      .setColor(0x00d4aa)
      .setAuthor({ name: "Vectis Code", iconURL: this.client?.user?.displayAvatarURL() })
      .setTimestamp();
    return this.postEmbed(config.discord.announcementsChannelId, embed);
  }

  async postChangelog(version: string, changes: string[]) {
    if (!config.discord.changelogChannelId) return false;
    const embed = new EmbedBuilder()
      .setTitle(`Vectis Code ${version}`)
      .setDescription(changes.map((c) => `- ${c}`).join("\n"))
      .setColor(0x5865f2)
      .setTimestamp();
    return this.postEmbed(config.discord.changelogChannelId, embed);
  }

  async postStatusUpdate(title: string, description: string, color: number) {
    if (!config.discord.statusChannelId) return false;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();
    return this.postEmbed(config.discord.statusChannelId, embed);
  }

  async postMilestone(title: string, description: string) {
    if (!config.discord.announcementsChannelId) return false;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(0xffd700)
      .setAuthor({ name: "Vectis Code", iconURL: this.client?.user?.displayAvatarURL() })
      .setTimestamp();
    return this.postEmbed(config.discord.announcementsChannelId, embed);
  }

  getSuggestions(): SuggestionData[] {
    return [...suggestions.values()];
  }
}

export const discordBot = new DiscordBotService();
