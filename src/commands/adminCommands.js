import { SlashCommandBuilder } from 'discord.js';
import { buildCard } from '../ui/components.js';
import { PREFIX } from '../utils/config.js';
import {
    adminDenied,
    hasAdminAccess,
    hasManageGuild,
} from '../utils/adminAccess.js';
import { getAdminRoleId, updateAdminRole } from '../utils/premiumConfig.js';

const ACTIVITY_TYPES = {
    playing: 0,
    streaming: 1,
    listening: 2,
    watching: 3,
    competing: 5,
};

function roleFromPrefix(message, args) {
    const mentioned = message.mentions?.roles?.first?.();
    if (mentioned) return mentioned;
    const roleId = args[0]?.replace(/[<@&>]/g, '');
    return roleId ? message.guild?.roles?.cache?.get(roleId) : null;
}

function setPresence(client, text, type = 'watching') {
    const activityType = ACTIVITY_TYPES[type] ?? ACTIVITY_TYPES.watching;
    client.user.setPresence({
        activities: [{ name: text, type: activityType }],
        status: 'online',
    });
    return `Bot status set to **${type} ${text}**.`;
}

export const setadminroleCommand = {
    data: new SlashCommandBuilder()
        .setName('setadminrole')
        .setDescription('Set the role allowed to use admin configuration commands')
        .addRoleOption((option) =>
            option
                .setName('role')
                .setDescription('Role that can configure the bot')
                .setRequired(true),
        ),
    prefix: 'setadminrole',

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply(buildCard(
                'This command can only be used inside a server.',
                { title: 'Server Only', emoji: '⚠️', ephemeral: true },
            ));
            return;
        }
        if (!hasManageGuild(interaction)) {
            await interaction.reply(buildCard(
                'Only members with Manage Server permission can set the admin role.',
                { title: 'Permission Required', emoji: '🔒', ephemeral: true },
            ));
            return;
        }

        const role = interaction.options.getRole('role');
        await updateAdminRole(interaction.guild.id, role.id);
        await interaction.reply(buildCard(
            `Admin configuration commands are now restricted to ${role}. Manage Server members can still use them.`,
            { title: 'Admin Role Updated', emoji: '🛡️', ephemeral: true },
        ));
    },

    async prefixExecute(message, args) {
        if (!message.guild) {
            await message.reply(buildCard(
                'This command can only be used inside a server.',
                { title: 'Server Only', emoji: '⚠️' },
            ));
            return;
        }
        if (!hasManageGuild(message)) {
            await message.reply(buildCard(
                'Only members with Manage Server permission can set the admin role.',
                { title: 'Permission Required', emoji: '🔒' },
            ));
            return;
        }
        const role = roleFromPrefix(message, args);
        if (!role) {
            await message.reply(buildCard(
                `Mention a role: \`${PREFIX}setadminrole @Admin\`.`,
                { title: 'Role Required', emoji: '⚠️' },
            ));
            return;
        }
        await updateAdminRole(message.guild.id, role.id);
        await message.reply(buildCard(
            `Admin configuration commands are now restricted to ${role}. Manage Server members can still use them.`,
            { title: 'Admin Role Updated', emoji: '🛡️' },
        ));
    },
};

export const setstatusCommand = {
    data: new SlashCommandBuilder()
        .setName('setstatus')
        .setDescription('Set the bot activity status')
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('Text shown in the bot status')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('type')
                .setDescription('Activity type')
                .setRequired(false)
                .addChoices(
                    { name: 'Playing', value: 'playing' },
                    { name: 'Watching', value: 'watching' },
                    { name: 'Listening', value: 'listening' },
                    { name: 'Competing', value: 'competing' },
                ),
        ),
    prefix: 'setstatus',

    async execute(interaction, client) {
        if (!await hasAdminAccess(interaction)) return adminDenied(interaction);
        const text = interaction.options.getString('text');
        const type = interaction.options.getString('type') ?? 'watching';
        await interaction.reply(buildCard(
            setPresence(client, text, type),
            { title: 'Bot Status Updated', emoji: '📡', ephemeral: true },
        ));
    },

    async prefixExecute(message, args, client) {
        if (!await hasAdminAccess(message)) return adminDenied(message);
        const type = ACTIVITY_TYPES[args[0]?.toLowerCase()] !== undefined
            ? args.shift().toLowerCase()
            : 'watching';
        const text = args.join(' ').trim();
        if (!text) {
            await message.reply(buildCard(
                `Use \`${PREFIX}setstatus [playing|watching|listening|competing] <text>\`.`,
                { title: 'Status Text Required', emoji: '⚠️' },
            ));
            return;
        }
        await message.reply(buildCard(
            setPresence(client, text, type),
            { title: 'Bot Status Updated', emoji: '📡' },
        ));
    },
};

export const adminroleCommand = {
    data: new SlashCommandBuilder()
        .setName('adminrole')
        .setDescription('Show the current admin role'),
    prefix: 'adminrole',

    async execute(interaction) {
        if (!await hasAdminAccess(interaction)) return adminDenied(interaction);
        const roleId = await getAdminRoleId(interaction.guild?.id);
        await interaction.reply(buildCard(
            roleId ? `Admin role: <@&${roleId}>.` : 'No admin role is configured. A Manage Server member can use `/setadminrole`.',
            { title: 'Admin Role', emoji: '🛡️', ephemeral: true },
        ));
    },

    async prefixExecute(message) {
        if (!await hasAdminAccess(message)) return adminDenied(message);
        const roleId = await getAdminRoleId(message.guild?.id);
        await message.reply(buildCard(
            roleId ? `Admin role: <@&${roleId}>.` : `No admin role is configured. A Manage Server member can use \`${PREFIX}setadminrole @Admin\`.`,
            { title: 'Admin Role', emoji: '🛡️' },
        ));
    },
};