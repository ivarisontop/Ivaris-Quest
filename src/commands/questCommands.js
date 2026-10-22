import {
    ActionRowBuilder,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { TokenStore } from '../quest/tokenStore.js';
import { QuestClient } from '../quest/questClient.js';
import {
    disableAutoquest,
    enableAutoquest,
    isAutoquestEnabled,
} from '../quest/autoquestStore.js';
import {
    getPremiumConfig,
    getAdminRoleId,
    updatePremiumConfig,
} from '../utils/premiumConfig.js';
import { hasAdminAccess } from '../utils/adminAccess.js';
import {
    buildCard,
    buildLinkCard,
    componentsV2Flags,
} from '../ui/components.js';
import { takeQuestRest } from '../quest/questRest.js';

const LINK_BUTTON_ID = 'link_prompt';
const LINK_MODAL_ID = 'link_token_modal';
const TOKEN_INPUT_ID = 'discord_user_token';
// Keep at 1 unless Discord explicitly permits a higher quest limit.
const TRIGGER_QUEST_COUNT = 1000;
const TRIGGER_MAX_DURATION_SECONDS = 300;
const activeTriggers = new Set();

function selectRandomShortQuests(manager) {
    const supportedTaskTypes = new Set([
        'WATCH_VIDEO',
        'WATCH_VIDEO_ON_MOBILE',
        'PLAY_ON_DESKTOP',
    ]);
    const candidates = manager.filterQuestsValid().filter((quest) => {
        const { taskName, total } = manager.getProgressDetails(quest);
        return supportedTaskTypes.has(taskName)
            && total > 0
            && total <= TRIGGER_MAX_DURATION_SECONDS;
    });

    for (let index = candidates.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }

    return candidates.slice(0, TRIGGER_QUEST_COUNT);
}

export function makeTokenStore(secret, collection) {
    return new TokenStore(secret, collection);
}

function missingToken(interaction) {
    return interaction.reply(buildCard(
        'You have not linked a Discord account yet. Use `/link` first.',
        { title: 'Account Not Linked', emoji: '🔗', ephemeral: true },
    ));
}

function questName(quest) {
    return quest?.config?.messages?.quest_name ?? `Quest ${quest?.id ?? 'unknown'}`;
}

function questSummary(quest) {
    const status = quest.isCompleted()
        ? 'completed'
        : quest.isEnrolledQuest()
            ? 'in progress'
            : 'available';
    return `• **${questName(quest)}** — ${status} — ID: \`${quest.id}\``;
}

function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function progressBar(percent, width = 12) {
    const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function questProgressLine(quest, manager) {
    const name = questName(quest);
    const progress = manager.getProgressDetails(quest);
    if (quest.isCompleted()) {
        return `✅ **${name}**\nID: \`${quest.id}\` • **DONE**`;
    }

    const percent = progress.percent;
    const total = progress.total ? formatDuration(progress.total) : 'unknown';
    const done = progress.total ? formatDuration(progress.done) : '0:00';
    const state = quest.isEnrolledQuest() ? 'in progress' : 'waiting to enroll';
    return `⚡ **${name}**\nID: \`${quest.id}\` • ${state}\n${progressBar(percent)} **${percent}%** • ⏱️ ${done}/${total}`;
}

function questBoard(quests, manager, { single = false } = {}) {
    if (single) return questProgressLine(quests[0], manager);

    const completed = quests.filter((quest) => quest.isCompleted());
    const remaining = quests.filter((quest) => !quest.isCompleted());
    const sections = [];
    if (completed.length) {
        sections.push(`✅ **Completed (${completed.length})**\n${completed.map((quest) => questProgressLine(quest, manager)).join('\n')}`);
    }
    if (remaining.length) {
        sections.push(`📋 **Remaining / in progress (${remaining.length})**\n${remaining.map((quest) => questProgressLine(quest, manager)).join('\n')}`);
    }
    return sections.join('\n\n') || 'No active quests are available.';
}

function createLiveProgress(target, quests, manager, { single = false, title = 'Working on quests', emoji = '⚡', ephemeral = false } = {}) {
    const current = new Map(quests.map((quest) => [quest.id, quest]));
    let status = '';
    let lastRender = 0;
    let rendering = false;
    let renderPromise = null;

    const render = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastRender < 4_500) return;
        if (rendering) return renderPromise;
        rendering = true;
        lastRender = now;
        const operation = (async () => {
            try {
                const board = questBoard([...current.values()], manager, { single });
                const content = status ? `${status}\n\n${board}` : board;
                await target.edit(buildCard(
                    content.slice(0, 3_900),
                    { title, emoji, ephemeral },
                ));
            } catch {
                // The command may have expired or the message may have been deleted.
            }
        })();
        renderPromise = operation;
        try {
            await operation;
        } finally {
            if (renderPromise === operation) {
                renderPromise = null;
                rendering = false;
            }
        }
        return operation;
    };

    const interval = setInterval(() => { render().catch(() => {}); }, 5_000);
    return {
        update(quest) {
            current.set(quest.id, quest);
            render().catch(() => {});
        },
        quests() {
            return [...current.values()];
        },
        render() {
            return render(true);
        },
        async setStatus(message) {
            status = message;
            if (rendering) await renderPromise;
            return render(true);
        },
        async clearStatus() {
            status = '';
            if (rendering) await renderPromise;
            return render(true);
        },
        async finish() {
            clearInterval(interval);
            await render(true);
        },
    };
}

function memberHasRole(member, roleId) {
    if (!member || !roleId) return false;
    if (member.roles?.cache) return member.roles.cache.has(roleId);
    return Array.isArray(member.roles) && member.roles.includes(roleId);
}

async function hasConfiguredAdminRole(source) {
    const guildId = source.guild?.id;
    if (!guildId) return false;
    const roleId = await getAdminRoleId(guildId);
    return memberHasRole(source.member, roleId);
}

async function hasPremiumAccess(source) {
    const guildId = source.guild?.id;
    if (!guildId) return true;
    const config = await getPremiumConfig(guildId);
    if (!config.enabled) return true;
    return memberHasRole(source.member, config.roleId);
}

function premiumDenied(source) {
    const ephemeral = Boolean(source.isChatInputCommand?.());
    return source.reply(buildCard(
        'This is a premium command. You need the server premium role to use it.',
        { title: 'Premium Access Required', emoji: '👑', ephemeral },
    ));
}

async function formatPremiumStatus(guildId) {
    const config = await getPremiumConfig(guildId);
    if (!config.enabled) {
        return 'Premium restriction is **disabled**. Everyone can use `/questall` and `/autoquest`.';
    }
    return config.roleId
        ? `Premium restriction is **enabled**. Required role: <@&${config.roleId}>.`
        : 'Premium restriction is enabled, but no role is configured. Run `,setpremium @role`.';
}

function parsePrefixRole(message, args) {
    const mentionedRole = message.mentions?.roles?.first?.();
    if (mentionedRole) return mentionedRole;
    const roleId = args[0]?.replace(/[<@&>]/g, '');
    return roleId ? message.guild?.roles?.cache?.get(roleId) : null;
}

async function fetchManager(userId, client) {
    const token = await client.tokenStore.get(userId);
    if (!token) return null;
    const questClient = new QuestClient(token);
    const manager = await questClient.fetchQuests();
    return { token, questClient, manager };
}

async function completeQuest(userId, quest, client, onProgress = () => {}) {
    const token = await client.tokenStore.get(userId);
    if (!token) throw new Error('No linked Discord account was found.');

    const questClient = new QuestClient(token);
    const manager = await questClient.fetchQuests();
    const freshQuest = manager.get(quest.id) ?? quest;
    const completed = await manager.doingQuest(freshQuest, console.log, onProgress);
    const claimed = await manager.claimRewards();
    return { completed, claimed, quest: freshQuest, manager };
}

export async function handleLinkPromptButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId(LINK_MODAL_ID)
        .setTitle('Link Discord account');

    const input = new TextInputBuilder()
        .setCustomId(TOKEN_INPUT_ID)
        .setLabel('Discord user token')
        .setPlaceholder('Paste your token here')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(20);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

export async function handleLinkModal(interaction, client) {
    const token = interaction.fields.getTextInputValue(TOKEN_INPUT_ID).trim();
    if (!token) {
        await interaction.reply(buildCard(
            'No token was provided.',
            { title: 'Token Required', emoji: '⚠️', ephemeral: true },
        ));
        return;
    }

    await interaction.deferReply({ flags: componentsV2Flags(true) });
    try {
        const questClient = new QuestClient(token);
        const user = await questClient.fetchUserRaw();
        await client.tokenStore.save(interaction.user.id, token);
        await interaction.editReply(buildCard(
            `Linked successfully to **${user.global_name ?? user.username ?? 'your account'}**.`,
            { title: 'Account Linked', emoji: '✅', ephemeral: true },
        ));
    } catch {
        await interaction.editReply(buildCard(
            'That token could not be verified. Check it and try `/link` again.',
            { title: 'Token Verification Failed', emoji: '❌', color: 0xED4245, ephemeral: true },
        ));
    }
}

export const linkCommand = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account for quest tracking'),
    prefix: 'link',

    async execute(interaction) {
        await interaction.reply(buildLinkCard({ ephemeral: true }));
    },

    async prefixExecute(message) {
        await message.reply(buildLinkCard());
    },
};

export const unlinkCommand = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Remove your saved Discord account token'),
    prefix: 'unlink',

    async execute(interaction, client) {
        const removed = await client.tokenStore.remove(interaction.user.id);
        await interaction.reply(buildCard(
            removed ? 'Your linked account was removed.' : 'You do not have a linked account.',
            { title: removed ? 'Account Unlinked' : 'No Linked Account', emoji: removed ? '✅' : 'ℹ️', ephemeral: true },
        ));
    },

    async prefixExecute(message, _args, client) {
        const removed = await client.tokenStore.remove(message.author.id);
        await message.reply(buildCard(
            removed ? 'Your linked account was removed.' : 'You do not have a linked account.',
            { title: removed ? 'Account Unlinked' : 'No Linked Account', emoji: removed ? '✅' : 'ℹ️' },
        ));
    },
};

export const tokencheckCommand = {
    data: new SlashCommandBuilder()
        .setName('tokencheck')
        .setDescription('Check whether your linked Discord account is valid'),
    prefix: 'tokencheck',

    async execute(interaction, client) {
        if (!await client.tokenStore.has(interaction.user.id)) return missingToken(interaction);
        await interaction.deferReply({ flags: componentsV2Flags(true) });
        try {
            const result = await fetchManager(interaction.user.id, client);
            await interaction.editReply(buildCard(
                `Your linked account is valid. Found **${result.manager.size}** quest(s).`,
                { title: 'Token Valid', emoji: '✅', ephemeral: true },
            ));
        } catch {
            await interaction.editReply(buildCard(
                'Your saved token is no longer valid. Use `/link` to update it.',
                { title: 'Token Expired', emoji: '⚠️', color: 0xFEE75C, ephemeral: true },
            ));
        }
    },

    async prefixExecute(message, _args, client) {
        if (!await client.tokenStore.has(message.author.id)) {
            await message.reply(buildCard(
                'You have not linked a Discord account yet. Use the link command first.',
                { title: 'Account Not Linked', emoji: '🔗' },
            ));
            return;
        }
        try {
            const result = await fetchManager(message.author.id, client);
            await message.reply(buildCard(
                `Your linked account is valid. Found **${result.manager.size}** quest(s).`,
                { title: 'Token Valid', emoji: '✅' },
            ));
        } catch {
            await message.reply(buildCard(
                'Your saved token is no longer valid. Use the link command to update it.',
                { title: 'Token Expired', emoji: '⚠️', color: 0xFEE75C },
            ));
        }
    },
};

export const questlistCommand = {
    data: new SlashCommandBuilder()
        .setName('questlist')
        .setDescription('View your available and completed quests'),
    prefix: 'questlist',

    async execute(interaction, client) {
        if (!await client.tokenStore.has(interaction.user.id)) return missingToken(interaction);
        await interaction.deferReply({ flags: componentsV2Flags(true) });
        try {
            const { manager } = await fetchManager(interaction.user.id, client);
            const quests = manager.list();
            const content = quests.length
                ? `**Your quests (${quests.length})**\n${quests.map(questSummary).join('\n')}`
                : 'No quests were found.';
            await interaction.editReply(buildCard(
                content.slice(0, 1900),
                { title: 'Your Quests', emoji: '🎮', ephemeral: true },
            ));
        } catch {
            await interaction.editReply(buildCard(
                'Could not fetch your quests. Your linked token may have expired.',
                { title: 'Quest List Unavailable', emoji: '❌', color: 0xED4245, ephemeral: true },
            ));
        }
    },

    async prefixExecute(message, _args, client) {
        if (!await client.tokenStore.has(message.author.id)) {
            await message.reply(buildCard(
                'You have not linked a Discord account yet. Use the link command first.',
                { title: 'Account Not Linked', emoji: '🔗' },
            ));
            return;
        }
        try {
            const { manager } = await fetchManager(message.author.id, client);
            const quests = manager.list();
            const content = quests.length
                ? `**Your quests (${quests.length})**\n${quests.map(questSummary).join('\n')}`
                : 'No quests were found.';
            await message.reply(buildCard(
                content.slice(0, 1900),
                { title: 'Your Quests', emoji: '🎮' },
            ));
        } catch {
            await message.reply(buildCard(
                'Could not fetch your quests. Your linked token may have expired.',
                { title: 'Quest List Unavailable', emoji: '❌', color: 0xED4245 },
            ));
        }
    },
};

export const questCommand = {
    data: new SlashCommandBuilder()
        .setName('quest')
        .setDescription('Complete one quest')
        .addStringOption((option) =>
            option
                .setName('quest_id')
                .setDescription('Quest ID from /questlist; omit to use the first available quest')
                .setRequired(false),
        ),
    prefix: 'quest',

    async execute(interaction, client) {
        if (!await client.tokenStore.has(interaction.user.id)) return missingToken(interaction);
        await interaction.deferReply({ flags: componentsV2Flags(true) });
        try {
            const { manager } = await fetchManager(interaction.user.id, client);
            const requestedId = interaction.options.getString('quest_id');
            const quest = requestedId
                ? manager.get(requestedId)
                : manager.filterQuestsValid()[0];
            if (!quest) {
                await interaction.editReply(buildCard(
                    requestedId ? 'That quest ID was not found.' : 'No active quests are available.',
                    { title: 'Quest Unavailable', emoji: 'ℹ️', ephemeral: true },
                ));
                return;
            }
            const target = { edit: (payload) => interaction.editReply(payload) };
            const live = createLiveProgress(
                target,
                [quest],
                manager,
                { single: true, title: 'Working on quest', emoji: '⚡', ephemeral: true },
            );
            await live.render();
            const result = await completeQuest(interaction.user.id, quest, client, live.update);
            live.update(result.quest);
            if (result.completed) {
                await takeQuestRest(interaction.user.id, {
                    onRestStart: (seconds) => live.setStatus(
                        `⏸️ **Taking a short rest**\nCompleted this quest. Resuming in about **${seconds} seconds**...`,
                    ),
                    log: (message) => console.log(`[Quest] ${message}`),
                });
                await live.clearStatus();
            }
            await live.finish();
            await interaction.editReply(buildCard(
                result.completed
                    ? `✅ **${questName(result.quest)}**\nID: \`${result.quest.id}\`\n\nQuest complete. Claimed **${result.claimed}** reward(s).`
                    : `⚠️ **${questName(result.quest)}**\nID: \`${result.quest.id}\`\n\nQuest could not be completed.`,
                {
                    title: result.completed ? 'Quest Complete' : 'Quest Not Complete',
                    emoji: result.completed ? '✅' : '⚠️',
                    color: result.completed ? 0x57F287 : 0xFEE75C,
                    ephemeral: true,
                },
            ));
        } catch {
            await interaction.editReply(buildCard(
                'Could not complete that quest. Your linked token may have expired.',
                { title: 'Quest Failed', emoji: '❌', color: 0xED4245, ephemeral: true },
            ));
        }
    },

    async prefixExecute(message, args, client) {
        if (!await client.tokenStore.has(message.author.id)) {
            await message.reply(buildCard(
                'You have not linked a Discord account yet. Use the link command first.',
                { title: 'Account Not Linked', emoji: '🔗' },
            ));
            return;
        }
        try {
            const { manager } = await fetchManager(message.author.id, client);
            const quest = args[0] ? manager.get(args[0]) : manager.filterQuestsValid()[0];
            if (!quest) {
                await message.reply(buildCard(
                    args[0] ? 'That quest ID was not found.' : 'No active quests are available.',
                    { title: 'Quest Unavailable', emoji: 'ℹ️' },
                ));
                return;
            }
            const progressMessage = await message.reply(buildCard(
                questProgressLine(quest, manager),
                { title: 'Working on quest', emoji: '⚡' },
            ));
            const target = { edit: (payload) => progressMessage.edit(payload) };
            const live = createLiveProgress(target, [quest], manager, { single: true, title: 'Working on quest', emoji: '⚡' });
            const result = await completeQuest(message.author.id, quest, client, live.update);
            live.update(result.quest);
            if (result.completed) {
                await takeQuestRest(message.author.id, {
                    onRestStart: (seconds) => live.setStatus(
                        `⏸️ **Taking a short rest**\nCompleted this quest. Resuming in about **${seconds} seconds**...`,
                    ),
                    log: (logMessage) => console.log(`[Quest] ${logMessage}`),
                });
                await live.clearStatus();
            }
            await live.finish();
            await progressMessage.edit(buildCard(
                result.completed
                    ? `✅ **${questName(result.quest)}**\nID: \`${result.quest.id}\`\n\nQuest complete. Claimed ${result.claimed} reward(s).`
                    : `⚠️ **${questName(result.quest)}**\nID: \`${result.quest.id}\`\n\nQuest could not be completed.`,
                {
                    title: result.completed ? 'Quest Complete' : 'Quest Not Complete',
                    emoji: result.completed ? '✅' : '⚠️',
                    color: result.completed ? 0x57F287 : 0xFEE75C,
                },
            ));
        } catch {
            await message.reply(buildCard(
                'Could not complete that quest. Your linked token may have expired.',
                { title: 'Quest Failed', emoji: '❌', color: 0xED4245 },
            ));
        }
    },
};

export const questallCommand = {
    data: new SlashCommandBuilder()
        .setName('questall')
        .setDescription('Complete all active quests'),
    prefix: 'questall',

    async execute(interaction, client) {
        if (!await hasPremiumAccess(interaction)) return premiumDenied(interaction);
        if (!await client.tokenStore.has(interaction.user.id)) return missingToken(interaction);
        await interaction.deferReply({ flags: componentsV2Flags(true) });
        try {
            const { manager } = await fetchManager(interaction.user.id, client);
            const quests = manager.list().filter(
                (quest) => quest.id !== '1412491570820812933' && !quest.isExpired(),
            );
            if (!quests.length) {
                await interaction.editReply(buildCard(
                    'No active quests are available.',
                    { title: 'No Active Quests', emoji: 'ℹ️', ephemeral: true },
                ));
                return;
            }
            const pendingQuests = quests.filter((quest) => !quest.isCompleted());
            const target = { edit: (payload) => interaction.editReply(payload) };
            const live = createLiveProgress(
                target,
                quests,
                manager,
                { title: 'Working on quests', emoji: '⚡', ephemeral: true },
            );
            await live.render();
            let completed = quests.filter((quest) => quest.isCompleted()).length;
            let claimed = 0;
            for (const quest of pendingQuests) {
                const result = await completeQuest(interaction.user.id, quest, client, live.update);
                live.update(result.quest);
                if (result.completed) completed++;
                claimed += result.claimed;
                if (result.completed) {
                    await takeQuestRest(interaction.user.id, {
                        onRestStart: (seconds) => live.setStatus(
                            `⏸️ **Taking a short rest**\nCompleted **${completed}** quest(s). Resuming in about **${seconds} seconds**...`,
                        ),
                        log: (message) => console.log(`[Quest] ${message}`),
                    });
                    await live.clearStatus();
                }
            }
            await live.finish();
            await interaction.editReply(buildCard(
                `✅ **Completed (${completed})**\n${live.quests().map((quest) => `• ${questName(quest)} — ID: \`${quest.id}\` — ${quest.isCompleted() ? 'DONE' : 'not completed'}`).join('\n').slice(0, 3_500)}\n\nClaimed **${claimed}** reward(s).`,
                { title: 'All Quests Processed', emoji: '✅', ephemeral: true },
            ));
        } catch {
            await interaction.editReply(buildCard(
                'Could not process all quests. Your linked token may have expired.',
                { title: 'Quest Processing Failed', emoji: '❌', color: 0xED4245, ephemeral: true },
            ));
        }
    },

    async prefixExecute(message, _args, client) {
        if (!await hasPremiumAccess(message)) return premiumDenied(message);
        if (!await client.tokenStore.has(message.author.id)) {
            await message.reply(buildCard(
                'You have not linked a Discord account yet. Use the link command first.',
                { title: 'Account Not Linked', emoji: '🔗' },
            ));
            return;
        }
        try {
            const { manager } = await fetchManager(message.author.id, client);
            const quests = manager.list().filter(
                (quest) => quest.id !== '1412491570820812933' && !quest.isExpired(),
            );
            if (!quests.length) {
                await message.reply(buildCard(
                    'No active quests are available.',
                    { title: 'No Active Quests', emoji: 'ℹ️' },
                ));
                return;
            }
            const pendingQuests = quests.filter((quest) => !quest.isCompleted());
            const progressMessage = await message.reply(buildCard(
                questBoard(quests, manager),
                { title: 'Working on quests', emoji: '⚡' },
            ));
            const target = { edit: (payload) => progressMessage.edit(payload) };
            const live = createLiveProgress(target, quests, manager, { title: 'Working on quests', emoji: '⚡' });
            await live.render();
            let completed = quests.filter((quest) => quest.isCompleted()).length;
            let claimed = 0;
            for (const quest of pendingQuests) {
                const result = await completeQuest(message.author.id, quest, client, live.update);
                live.update(result.quest);
                if (result.completed) completed++;
                claimed += result.claimed;
                if (result.completed) {
                    await takeQuestRest(message.author.id, {
                        onRestStart: (seconds) => live.setStatus(
                            `⏸️ **Taking a short rest**\nCompleted **${completed}** quest(s). Resuming in about **${seconds} seconds**...`,
                        ),
                        log: (logMessage) => console.log(`[Quest] ${logMessage}`),
                    });
                    await live.clearStatus();
                }
            }
            await live.finish();
            await progressMessage.edit(buildCard(
                `✅ **Completed (${completed})**\n${live.quests().map((quest) => `• ${questName(quest)} — ID: \`${quest.id}\` — ${quest.isCompleted() ? 'DONE' : 'not completed'}`).join('\n').slice(0, 3_500)}\n\nClaimed ${claimed} reward(s).`,
                { title: 'All Quests Processed', emoji: '✅' },
            ));
        } catch {
            await message.reply(buildCard(
                'Could not process all quests. Your linked token may have expired.',
                { title: 'Quest Processing Failed', emoji: '❌', color: 0xED4245 },
            ));
        }
    },
};

async function setAutoquest(interactionOrMessage, client, mode) {
    const userId = interactionOrMessage.user?.id ?? interactionOrMessage.author?.id;
    const enabled = await isAutoquestEnabled(userId);
    if (mode === 'status') return `Autoquest is currently **${enabled ? 'enabled' : 'disabled'}**.`;
    if (mode === 'on') {
        await enableAutoquest(userId);
        return 'Autoquest enabled.';
    }
    await disableAutoquest(userId);
    return 'Autoquest disabled.';
}

export const triggerCommand = {
    data: new SlashCommandBuilder()
        .setName('trigger')
        .setDescription('Run one random short quest on your linked account (admin only)'),

    async execute(interaction, client) {
        if (!interaction.guild) {
            await interaction.reply(buildCard(
                'This command can only be used inside a server.',
                { title: 'Server Only', emoji: '⚠️', ephemeral: true },
            ));
            return;
        }
        if (!await hasConfiguredAdminRole(interaction)) {
            await interaction.reply(buildCard(
                'You need the configured admin role to use this command.',
                { title: 'Permission Required', emoji: '🔒', ephemeral: true },
            ));
            return;
        }

        const userId = interaction.user.id;
        if (activeTriggers.has(userId)) {
            await interaction.reply(buildCard(
                'A trigger run is already in progress for your linked account.',
                { title: 'Trigger Already Running', emoji: '⏳', ephemeral: true },
            ));
            return;
        }

        activeTriggers.add(userId);
        let live;
        let deferred = false;
        try {
            if (!await client.tokenStore.has(userId)) return await missingToken(interaction);
            await interaction.deferReply({ flags: componentsV2Flags(true) });
            deferred = true;
            const { manager } = await fetchManager(userId, client);
            const quests = selectRandomShortQuests(manager);
            if (quests.length < TRIGGER_QUEST_COUNT) {
                await interaction.editReply(buildCard(
                    `Found ${quests.length} eligible quest(s). At least ${TRIGGER_QUEST_COUNT} active, supported quest(s) of ${TRIGGER_MAX_DURATION_SECONDS} seconds or less are required.`,
                    { title: 'Not Enough Short Quests', emoji: 'ℹ️', ephemeral: true },
                ));
                return;
            }

            live = createLiveProgress(
                { edit: (payload) => interaction.editReply(payload) },
                quests,
                manager,
                { title: 'Admin trigger running', emoji: '⚡', ephemeral: true },
            );
            await live.render();

            const results = [];
            for (const [index, quest] of quests.entries()) {
                await live.setStatus(`Processing quest **${index + 1} of ${TRIGGER_QUEST_COUNT}**...`);
                try {
                    const result = await completeQuest(userId, quest, client, live.update);
                    live.update(result.quest);
                    if (result.completed) {
                        await takeQuestRest(userId, {
                            onRestStart: (seconds) => live.setStatus(
                                `⏸️ **Taking a short rest**\nResuming in about **${seconds} seconds**...`,
                            ),
                            log: (message) => console.log(`[Trigger] ${message}`),
                        });
                    }
                    results.push({ quest: result.quest, completed: result.completed });
                } catch (error) {
                    console.warn(`[Trigger] Could not process quest ${quest.id}: ${error.message}`);
                    results.push({ quest, completed: false });
                }
                await live.clearStatus();
            }

            await live.finish();
            live = null;

            const completedCount = results.filter((result) => result.completed).length;
            const resultLines = results.map(({ quest, completed }) =>
                `• **${questName(quest)}** — ${completed ? 'complete' : 'not completed'} — ID: \`${quest.id}\``,
            ).join('\n');
            const summary = `Trigger finished: **${completedCount}/${TRIGGER_QUEST_COUNT}** quest(s) completed.\n${resultLines}`;
            let dmSent = true;
            try {
                await interaction.user.send(buildCard(
                    summary,
                    { title: 'Trigger Run Complete', emoji: completedCount === TRIGGER_QUEST_COUNT ? '✅' : '⚠️' },
                ));
            } catch (error) {
                dmSent = false;
                console.warn(`[Trigger] Could not DM command runner ${userId}: ${error.message}`);
            }

            await interaction.editReply(buildCard(
                `${summary}${dmSent ? '\n\nI sent you the results by DM.' : '\n\nI could not DM you; check your server privacy settings.'}`,
                {
                    title: 'Trigger Run Complete',
                    emoji: completedCount === TRIGGER_QUEST_COUNT ? '✅' : '⚠️',
                    ephemeral: true,
                },
            ));
        } catch (error) {
            console.error(`[Trigger] Run failed for ${userId}:`, error);
            const errorReply = buildCard(
                'The trigger run failed. Check that your linked account is valid and try again.',
                { title: 'Trigger Failed', emoji: '❌', color: 0xED4245, ephemeral: true },
            );
            if (deferred) {
                await interaction.editReply(errorReply).catch(() => {});
            } else {
                await interaction.reply(errorReply).catch(() => {});
            }
        } finally {
            if (live) await live.finish().catch(() => {});
            activeTriggers.delete(userId);
        }
    },
};

export const autoquestCommand = {
    data: new SlashCommandBuilder()
        .setName('autoquest')
        .setDescription('Enable or disable automatic quest completion')
        .addStringOption((option) =>
            option
                .setName('mode')
                .setDescription('Whether automatic quest completion should be enabled')
                .setRequired(false)
                .addChoices(
                    { name: 'on', value: 'on' },
                    { name: 'off', value: 'off' },
                    { name: 'status', value: 'status' },
                ),
        ),
    prefix: 'autoquest',

    async execute(interaction, client) {
        if (!await hasPremiumAccess(interaction)) return premiumDenied(interaction);
        const mode = interaction.options.getString('mode') ?? 'status';
        const content = await setAutoquest(interaction, client, mode);
        await interaction.reply(buildCard(
            content,
            { title: 'Autoquest', emoji: '⚙️', ephemeral: true },
        ));
    },

    async prefixExecute(message, args, client) {
        if (!await hasPremiumAccess(message)) return premiumDenied(message);
        const mode = ['on', 'off', 'status'].includes(args[0]) ? args[0] : 'status';
        await message.reply(buildCard(
            await setAutoquest(message, client, mode),
            { title: 'Autoquest', emoji: '⚙️' },
        ));
    },
};

export const setpremiumCommand = {
    data: new SlashCommandBuilder()
        .setName('setpremium')
        .setDescription('Configure the server premium role and restriction')
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('Choose how to manage premium access')
                .setRequired(true)
                .addChoices(
                    { name: 'set role and enable', value: 'set' },
                    { name: 'enable', value: 'enable' },
                    { name: 'disable', value: 'disable' },
                    { name: 'status', value: 'status' },
                ),
        )
        .addRoleOption((option) =>
            option
                .setName('role')
                .setDescription('Role allowed to use premium commands (required for set)')
                .setRequired(false),
        ),
    prefix: 'setpremium',

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply(buildCard(
                'This command can only be used inside a server.',
                { title: 'Server Only', emoji: '⚠️', ephemeral: true },
            ));
            return;
        }
        if (!await hasAdminAccess(interaction)) {
            await interaction.reply(buildCard(
                'You need the configured admin role or Manage Server permission to configure premium access.',
                { title: 'Permission Required', emoji: '🔒', ephemeral: true },
            ));
            return;
        }

        const action = interaction.options.getString('action');
        const role = interaction.options.getRole('role');
        await interaction.reply(buildCard(
            await applyPremiumAction(interaction.guild.id, action, role?.id),
            { title: 'Premium Settings', emoji: '👑', ephemeral: true },
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
        if (!await hasAdminAccess(message)) {
            await message.reply(buildCard(
                'You need the configured admin role or Manage Server permission to configure premium access.',
                { title: 'Permission Required', emoji: '🔒' },
            ));
            return;
        }

        const action = normalizePremiumAction(args[0], args.length > 0);
        const role = action === 'set' ? parsePrefixRole(message, args) : null;
        await message.reply(buildCard(
            await applyPremiumAction(message.guild.id, action, role?.id),
            { title: 'Premium Settings', emoji: '👑' },
        ));
    },
};

function normalizePremiumAction(value, hasArgument) {
    const action = value?.toLowerCase();
    if (!hasArgument || action === 'status') return 'status';
    if (action === 'off' || action === 'disable') return 'disable';
    if (action === 'on' || action === 'enable') return 'enable';
    return 'set';
}

async function applyPremiumAction(guildId, action, roleId) {
    if (action === 'status') return formatPremiumStatus(guildId);
    if (action === 'disable') {
        await updatePremiumConfig(guildId, { enabled: false });
        return 'Premium restriction disabled. Everyone can now use `/questall` and `/autoquest`.';
    }
    if (action === 'enable') {
        const current = await getPremiumConfig(guildId);
        if (!current.roleId) return 'No premium role is configured. Use `,setpremium @role` first.';
        await updatePremiumConfig(guildId, { enabled: true });
        return `Premium restriction enabled. Required role: <@&${current.roleId}>.`;
    }
    if (!roleId) return 'Mention a role to set it as premium: `,setpremium @role`.';
    await updatePremiumConfig(guildId, { roleId, enabled: true });
    return `Premium restriction enabled. Required role: <@&${roleId}>.`;
}

export async function runAutoquestForUser(userId, quest, tokenStore, discordClient) {
    const token = await tokenStore.get(userId);
    if (!token) return false;
    const client = new QuestClient(token);
    const manager = await client.fetchQuests();
    const freshQuest = manager.get(quest.id) ?? quest;
    const wasEnrolled = freshQuest.isEnrolledQuest();
    const completed = await manager.doingQuest(freshQuest);
    await manager.claimRewards();
    if (completed) {
        await takeQuestRest(userId, {
            log: (message) => console.log(`[Autoquest] ${message}`),
        });
    }
    const enrolledNow = !wasEnrolled && freshQuest.isEnrolledQuest();

    if (enrolledNow && discordClient) {
        try {
            const user = await discordClient.users.fetch(userId);
            await user.send(
                `⚡ I automatically enrolled you in **${questName(freshQuest)}**.\n` +
                `Quest ID: \`${freshQuest.id}\`\n` +
                `I am working on it now and will mark it **DONE** when it is complete.`,
            );
        } catch (err) {
            console.warn(`Could not DM autoquest enrollment for ${userId}: ${err.message}`);
        }
    }

    return { completed, enrolled: enrolledNow };
}