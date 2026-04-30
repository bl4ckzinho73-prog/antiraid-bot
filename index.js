require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const client = new Client({
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages
],
  partials: [Partials.Channel]
});

const dbFile = path.join(__dirname, 'data.json');

const db = fs.existsSync(dbFile)
  ? JSON.parse(fs.readFileSync(dbFile))
  : {};

function save() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function guildData(id) {
  if (!db[id]) {
    db[id] = {
      logChannel: null,
      whitelist: [],
      lockdown: false,
      users: {}
    };
  }

  return db[id];
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Define canal de logs')
    .addChannelOption(option =>
      option
        .setName('canal')
        .setDescription('Canal')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Trava canais de texto'),

  new SlashCommandBuilder()
    .setName('unlockdown')
    .setDescription('Destrava canais de texto'),

  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Autoriza usuário')
    .addUserOption(option =>
      option
        .setName('usuario')
        .setDescription('Usuário')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('unwhitelist')
    .setDescription('Remove autorização')
    .addUserOption(option =>
      option
        .setName('usuario')
        .setDescription('Usuário')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Mostra status')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`Online: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
});

async function log(guild, message) {
  const g = guildData(guild.id);

  if (!g.logChannel) return;

  const channel = guild.channels.cache.get(g.logChannel);

  if (channel) {
    channel.send(message).catch(() => {});
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return interaction.reply({
      content: 'Apenas administradores.',
      ephemeral: true
    });
  }

  const g = guildData(interaction.guild.id);

  if (interaction.commandName === 'setup') {
    g.logChannel = interaction.options.getChannel('canal').id;
    save();

    return interaction.reply('Canal de logs configurado.');
  }

  if (interaction.commandName === 'whitelist') {
    const user = interaction.options.getUser('usuario');

    if (!g.whitelist.includes(user.id)) {
      g.whitelist.push(user.id);
    }

    save();

    return interaction.reply('Usuário adicionado.');
  }

  if (interaction.commandName === 'unwhitelist') {
    const user = interaction.options.getUser('usuario');

    g.whitelist = g.whitelist.filter(id => id !== user.id);

    save();

    return interaction.reply('Usuário removido.');
  }

  if (interaction.commandName === 'status') {
    return interaction.reply(
      `Lockdown: ${g.lockdown} | Whitelist: ${g.whitelist.length}`
    );
  }

  if (interaction.commandName === 'lockdown') {
    for (const [, channel] of interaction.guild.channels.cache) {
      if (channel.type === ChannelType.GuildText) {
        await channel.permissionOverwrites
          .edit(interaction.guild.roles.everyone, {
            SendMessages: false
          })
          .catch(() => {});
      }
    }

    g.lockdown = true;
    save();

    await log(interaction.guild, '🔒 Lockdown ativado.');

    return interaction.reply('Servidor travado.');
  }

  if (interaction.commandName === 'unlockdown') {
    for (const [, channel] of interaction.guild.channels.cache) {
      if (channel.type === ChannelType.GuildText) {
        await channel.permissionOverwrites
          .edit(interaction.guild.roles.everyone, {
            SendMessages: null
          })
          .catch(() => {});
      }
    }

    g.lockdown = false;
    save();

    await log(interaction.guild, '🔓 Lockdown desativado.');

    return interaction.reply('Servidor destravado.');
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const g = guildData(message.guild.id);

  if (g.whitelist.includes(message.author.id)) return;

  const userId = message.author.id;

  if (!g.users[userId]) {
    g.users[userId] = {
      times: [],
      warns: 0
    };
  }

  const user = g.users[userId];
  const now = Date.now();

  user.times = user.times.filter(time => now - time < 5000);
  user.times.push(now);

  let reason = '';

  if (user.times.length >= 6) reason = 'Spam/Flood';

  if (message.mentions.users.size >= 5) reason = 'Mass Mention';

  if (/https?:\/\//i.test(message.content)) reason = 'Link suspeito';

  if (reason) {
    await message.delete().catch(() => {});

    user.warns++;

    await log(
      message.guild,
      `🚨 ${message.author.tag} punido por: ${reason}`
    );

    if (user.warns >= 3) {
      await message.member
        .timeout(10 * 60 * 1000, reason)
        .catch(() => {});

      await log(
        message.guild,
        `⏱️ ${message.author.tag} mutado por 10 minutos.`
      );
    }

    save();
  }
});

client.login(process.env.TOKEN);
