import { SlashCommandBuilder } from 'discord.js';
import { buildCard } from '../ui/components.js';
import { PREFIX } from '../utils/config.js';

const COMMANDS = [
    ['link', 'Link your Discord account'],
    ['unlink', 'Remove your linked account'],
    ['tokencheck', 'Check your linked account'],
    ['quest', 'Complete one quest by ID'],
    ['questall', 'Show and complete all quests'],
    ['trigger', 'Run one random short quest (admin only)'],
    ['questlist', 'List quest names, IDs, and status'],
    ['autoquest', 'Enable or disable automatic quests'],
    ['setadminrole', 'Set the admin configuration role'],
    ['adminrole', 'Show the configured admin role'],
    ['setpremium', 'Configure premium access'],
    ['setstatus', 'Set the bot activity status'],
    ['ping', 'Check bot latency'],
    ['help', 'Show this command list'],
];

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('See all available commands'),
    prefix: 'help',

    async execute(interaction) {
        await interaction.reply(buildHelp());
    },

    async prefixExecute(message) {
        await message.reply(buildHelp());
    },
};

function buildHelp() {
    const lines = COMMANDS
        .map(([name, description]) => `\`/${name}\`  \`${PREFIX}${name}\` — ${description}`)
        .join('\n');
    return buildCard(lines, { title: 'Inferix Quest Bot — Commands', emoji: '📖' });
}