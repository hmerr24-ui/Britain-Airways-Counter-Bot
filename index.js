import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import fs from "node:fs";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, PILOT_ROLE_ID, VERIFIED_ROLE_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const DATA_FILE = "./counters.json";

const TYPES = {
  members: { label: "Members", emoji: "👥", description: "Total server members" },
  pilots: { label: "Pilots", emoji: "👨‍✈️", description: "Members with the Pilot role" },
  flights: { label: "Flights Completed", emoji: "✈️", description: "Completed flights (connect later)" },
  verified: { label: "Verified", emoji: "🔗", description: "Members with the Verified role" },
  staff: { label: "Staff", emoji: "🛠️", description: "Members with Manage Server" },
  bots: { label: "Bots", emoji: "🤖", description: "Bots in the server" },
  humans: { label: "Human Members", emoji: "👤", description: "Non-bot members" },
  channels: { label: "Channels", emoji: "📁", description: "Total channels" },
  roles: { label: "Roles", emoji: "🎭", description: "Total roles" },
  voice: { label: "Voice Members", emoji: "🎙️", description: "Members currently in voice" }
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { counters: [] };
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { counters: Array.isArray(data.counters) ? data.counters : [] };
  } catch {
    return { counters: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function isStaff(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function makeEmbed() {
  return new EmbedBuilder()
    .setTitle("📊 Britain Airways Counters")
    .setDescription(
      "Select the counters you want and press **Save**.\n\n" +
      "Create and Edit both use this same menu."
    )
    .setFooter({ text: "Britain Airways Counter Bot" });
}

function makeComponents(selected = []) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("counter_select")
    .setPlaceholder("Choose counters")
    .setMinValues(1)
    .setMaxValues(Object.keys(TYPES).length)
    .addOptions(
      Object.entries(TYPES).map(([value, type]) => ({
        label: type.label,
        description: type.description,
        value,
        emoji: type.emoji,
        default: selected.includes(value)
      }))
    );

  return [
    new ActionRowBuilder().addComponents(menu),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("counter_save")
        .setLabel("Create / Save")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("counter_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function selectedFromCustomId(customId) {
  const prefix = "counter_save:";
  if (!customId.startsWith(prefix)) return [];
  const raw = customId.slice(prefix.length);
  return raw ? raw.split(",").filter(value => Object.hasOwn(TYPES, value)) : [];
}

async function getValue(guild, type) {
  if (type === "members") return guild.memberCount;

  if (type === "bots") {
    return guild.members.cache.filter(member => member.user.bot).size;
  }

  if (type === "humans") {
    return guild.members.cache.filter(member => !member.user.bot).size;
  }

  if (type === "channels") return guild.channels.cache.size;
  if (type === "roles") return guild.roles.cache.size;

  if (type === "staff") {
    return guild.members.cache.filter(
      member =>
        !member.user.bot &&
        member.permissions.has(PermissionFlagsBits.ManageGuild)
    ).size;
  }

  if (type === "voice") {
    return guild.channels.cache
      .filter(
        channel =>
          channel.type === ChannelType.GuildVoice ||
          channel.type === ChannelType.GuildStageVoice
      )
      .reduce((total, channel) => total + channel.members.size, 0);
  }

  if (type === "pilots") {
    if (!PILOT_ROLE_ID) return 0;
    const role = guild.roles.cache.get(PILOT_ROLE_ID);
    return role ? role.members.size : 0;
  }

  if (type === "verified") {
    if (!VERIFIED_ROLE_ID) return 0;
    const role = guild.roles.cache.get(VERIFIED_ROLE_ID);
    return role ? role.members.size : 0;
  }

  // Pilot Tracker integration will be added separately.
  if (type === "flights") return 0;

  return 0;
}

async function refreshCounters(guild) {
  const data = loadData();

  for (const counter of data.counters) {
    try {
      const channel = await guild.channels.fetch(counter.channelId);
      if (!channel) continue;

      const type = TYPES[counter.type];
      if (!type) continue;

      const value = await getValue(guild, counter.type);
      const name = `${type.emoji} ${type.label}: ${value}`;

      if (channel.name !== name) {
        await channel.setName(name);
      }
    } catch (error) {
      console.error(`Refresh failed for ${counter.type}:`, error.message);
    }
  }
}

async function applyCounters(guild, selectedTypes) {
  const safeTypes = [...new Set(selectedTypes)].filter(type =>
    Object.hasOwn(TYPES, type)
  );

  const data = loadData();
  const wanted = new Set(safeTypes);

  // Remove counters which are no longer selected.
  for (const counter of data.counters) {
    if (!wanted.has(counter.type)) {
      try {
        const channel = await guild.channels.fetch(counter.channelId);
        if (channel) {
          await channel.delete("Counter removed by staff");
        }
      } catch {}
    }
  }

  data.counters = data.counters.filter(counter => wanted.has(counter.type));

  // Create newly selected counters.
  for (const typeKey of safeTypes) {
    if (data.counters.some(counter => counter.type === typeKey)) continue;

    const type = TYPES[typeKey];

    const channel = await guild.channels.create({
      name: `${type.emoji} ${type.label}: 0`,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        }
      ],
      reason: "Britain Airways Counter Bot"
    });

    data.counters.push({
      type: typeKey,
      channelId: channel.id
    });
  }

  saveData(data);
  await refreshCounters(guild);
  return safeTypes.length;
}

const commands = [
  new SlashCommandBuilder()
    .setName("counter")
    .setDescription("Manage Britain Airways counters.")
    .addSubcommand(sub =>
      sub.setName("create").setDescription("Choose counters to create.")
    )
    .addSubcommand(sub =>
      sub.setName("edit").setDescription("Choose which counters exist.")
    )
    .addSubcommand(sub =>
      sub.setName("refresh").setDescription("Refresh counter values.")
    )
    .addSubcommand(sub =>
      sub.setName("delete").setDescription("Delete all counter channels.")
    )
].map(command => command.toJSON());

client.once("ready", async () => {
  try {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();
    await refreshCounters(guild);

    console.log(`Logged in as ${client.user.tag}`);
    console.log("Britain Airways Counter Bot is ready.");
  } catch (error) {
    console.error("Startup error:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "counter"
    ) {
      if (!isStaff(interaction)) {
        return interaction.reply({
          content: "🔒 Staff only.",
          flags: MessageFlags.Ephemeral
        });
      }

      const subcommand = interaction.options.getSubcommand();
      const data = loadData();

      if (subcommand === "create" || subcommand === "edit") {
        const selected =
          subcommand === "edit"
            ? data.counters.map(counter => counter.type)
            : [];

        return interaction.reply({
          embeds: [makeEmbed()],
          components: makeComponents(selected),
          flags: MessageFlags.Ephemeral
        });
      }

      if (subcommand === "refresh") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await refreshCounters(interaction.guild);
        return interaction.editReply("✅ Counters refreshed.");
      }

      if (subcommand === "delete") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await applyCounters(interaction.guild, []);
        return interaction.editReply("🗑️ All counter channels deleted.");
      }
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "counter_select"
    ) {
      const selected = interaction.values.filter(value =>
        Object.hasOwn(TYPES, value)
      );

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`counter_select_saved:${selected.join(",")}`)
        .setPlaceholder(`${selected.length} selected`)
        .setMinValues(1)
        .setMaxValues(Object.keys(TYPES).length)
        .addOptions(
          Object.entries(TYPES).map(([value, type]) => ({
            label: type.label,
            description: type.description,
            value,
            emoji: type.emoji,
            default: selected.includes(value)
          }))
        );

      return interaction.update({
        embeds: [makeEmbed()],
        components: [
          new ActionRowBuilder().addComponents(menu),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`counter_save:${selected.join(",")}`)
              .setLabel("Create / Save")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("counter_cancel")
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("counter_save:")
    ) {
      if (!isStaff(interaction)) {
        return interaction.reply({
          content: "🔒 Staff only.",
          flags: MessageFlags.Ephemeral
        });
      }

      const selected = selectedFromCustomId(interaction.customId);

      await interaction.deferUpdate();
      const count = await applyCounters(interaction.guild, selected);

      return interaction.editReply({
        content: `✅ Counter setup saved — **${count}** selected.`,
        embeds: [],
        components: []
      });
    }

    if (
      interaction.isButton() &&
      interaction.customId === "counter_cancel"
    ) {
      return interaction.update({
        content: "❌ Cancelled.",
        embeds: [],
        components: []
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: "❌ Something went wrong. Check the Railway logs.",
          embeds: [],
          components: []
        });
      } else {
        await interaction.reply({
          content: "❌ Something went wrong. Check the Railway logs.",
          flags: MessageFlags.Ephemeral
        });
      }
    } catch {}
  }
});

client.on("error", error => console.error("Discord client error:", error));
process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));
process.on("uncaughtException", error => console.error("Uncaught exception:", error));

client.login(DISCORD_TOKEN);
