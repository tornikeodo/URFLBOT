require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const express = require('express');
const fs = require('fs');

// Load team data
const teams = JSON.parse(fs.readFileSync('./teams.json'));

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// Express setup for status reporting
const app = express();
const port = 3000;
app.get('/', (req, res) => {
  res.send('Bot is running and status has been updated!');
});
app.listen(port, () => {
  console.log(`🔗 Server running at http://localhost:${port}`);
});

// Status messages for rotation
const statusMessages = ["[VEF] Hub"];
let currentIndex = 0;

function updateStatus() {
  const currentStatus = statusMessages[currentIndex];
  client.user.setPresence({
    activities: [{ name: currentStatus, type: ActivityType.Playing }],
    status: 'idle',
  });
  currentIndex = (currentIndex + 1) % statusMessages.length;
}

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  setInterval(updateStatus, 60000); // Updates every 60 seconds

  // Register slash commands
  const offerCommand = new SlashCommandBuilder()
    .setName('offer')
    .setDescription('Offer a contract to a player')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user you are signing')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('role')
        .setDescription('Role being offered')
        .setRequired(true)
        .addChoices(
          { name: 'Rotation', value: 'Rotation' },
          { name: 'Starter', value: 'Starter' },
          { name: 'Captain', value: 'Captain' },
          { name: 'Assistant Manager', value: 'Assistant Manager' }
        )
    )
    .addStringOption(option =>
      option.setName('position')
        .setDescription('Position being offered')
        .setRequired(true)
        .addChoices(
          { name: 'Striker', value: 'Striker' },
          { name: 'Midfielder', value: 'Midfielder' },
          { name: 'Center-back', value: 'Center-back' },
          { name: 'Goalkeeper', value: 'Goalkeeper' }
        )
    );

  const viewCommand = new SlashCommandBuilder()
    .setName('view')
    .setDescription('View all members with a specific role')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to view members of')
        .setRequired(true)
    );

  const releaseCommand = new SlashCommandBuilder()
    .setName('release')
    .setDescription('Release a user from their team role')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to release from the team role')
        .setRequired(true)
    );

  client.application.commands.set([offerCommand, viewCommand, releaseCommand]);
  console.log('Slash commands registered.');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isButton()) return;
  const { commandName, options, member, guild } = interaction;

  // Handle /offer command
  if (commandName === 'offer') {
    await interaction.deferReply({ ephemeral: true });

    const signee = options.getUser('user');
    const role = options.getString('role');
    const position = options.getString('position');
    const contractID = Math.floor(Math.random() * 100000);

    const teamEntry = Object.entries(teams).find(([_, teamData]) =>
      member.roles.cache.has(teamData.roleID)
    );
    if (!teamEntry) {
      return interaction.editReply({ content: 'You don\'t have a team role assigned.' });
    }

    const [teamName, teamData] = teamEntry;
    const offerEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🏆 Contract Offer 🏆')
      .setDescription(`You have received a contract offer from **${teamName}**!`)
      .setThumbnail(teamData.imageURL)
      .addFields(
        { name: '🆔 Contract ID', value: `**${contractID}**` },
        { name: '👤 Coach', value: interaction.user.tag },
        { name: '🤝 Signee', value: signee.tag },
        { name: '⚽ Position', value: position },
        { name: '📜 Role', value: role }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('accept_offer')
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success)
    );

    await signee.send({ embeds: [offerEmbed], components: [row] });
    await interaction.editReply({ content: `Offer sent to ${signee.tag}.` });
  }

  // Handle accepting the offer button
  if (interaction.isButton() && interaction.customId === 'accept_offer') {
    await interaction.deferUpdate();

    const originalEmbed = interaction.message.embeds[0];
    if (!originalEmbed) return;

    const contractIDField = originalEmbed.fields.find(f => f.name === '🆔 Contract ID');
    const teamField = originalEmbed.description.match(/\*\*(.+)\*\*/)?.[1];

    const transactionChannel = client.channels.cache.get(process.env.TRANSACTION_CHANNEL_ID);
    if (!transactionChannel) {
      console.error("Transaction channel not found. Check TRANSACTION_CHANNEL_ID in your .env file.");
      return interaction.followUp({
        content: '⚠️ Error: Transaction channel not found.',
        ephemeral: true,
      });
    }

    const transactionEmbed = EmbedBuilder.from(originalEmbed)
      .setTitle('🎉 Contract Signed 🎉')
      .setFooter({ text: `Accepted by ${interaction.user.tag}` });

    await transactionChannel.send({ embeds: [transactionEmbed] });

    const signeeMember = await guild.members.fetch(interaction.user.id);
    const teamRole = guild.roles.cache.find(role => role.name === teamField);
    if (teamRole) await signeeMember.roles.add(teamRole);

    await interaction.message.edit({ embeds: [transactionEmbed], components: [] });

    await interaction.followUp({
      content: `🎉 ${interaction.user.tag} has accepted the contract offer!`,
      ephemeral: false,
    });
  }

  // Handle /view command
  if (commandName === 'view') {
    if (!guild) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
    }
  
    // Defer reply to prevent timeout
    await interaction.deferReply({ ephemeral: true });
  
    try {
      // Fetch all members of the guild to ensure the cache is complete
      await guild.members.fetch();
  
      const role = options.getRole('role');
      const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(role.id));
      const memberList = membersWithRole.map(member => member.toString()).join('\n');
  
      const embed = new EmbedBuilder()
        .setColor(role.color || '#0099ff')
        .setTitle(`Members with ${role.name}`)
        .setDescription(memberList || 'No members found.');
  
      // Send the final reply
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in /view command:', error);
      await interaction.editReply({
        content: 'An error occurred while processing the command. Please try again later.',
      });
    }
  }
  
  

  // Handle /release command
  if (commandName === 'release') {
    if (!guild) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
    }
  
    // Defer the reply to prevent timeout
    await interaction.deferReply({ ephemeral: true });
  
    try {
      const targetUser = options.getUser('user');
      const targetMember = await guild.members.fetch(targetUser.id);
  
      // Find the team role
      const teamRole = Object.values(teams).find(team =>
        targetMember.roles.cache.has(team.roleID)
      );
  
      if (!teamRole) {
        return interaction.editReply({
          content: `${targetUser.tag} is not associated with any team role.`,
        });
      }
  
      // Remove the team role from the member
      await targetMember.roles.remove(teamRole.roleID);
  
      // Confirm successful role removal
      await interaction.editReply({
        content: `Released ${targetUser.tag} from the team role.`,
      });
    } catch (error) {
      console.error('Error in /release command:', error);
  
      // Handle unexpected errors
      await interaction.editReply({
        content: 'An error occurred while processing the command. Please try again later.',
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
