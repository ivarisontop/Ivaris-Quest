import { handleLinkModal, handleLinkPromptButton } from '../commands/questCommands.js';
import { buildCard } from '../ui/components.js';

export default {
    name: 'interactionCreate',
    once: false,
    async execute(interaction, client) {

        // Modal: link token
        if (interaction.isModalSubmit() && interaction.customId === 'link_token_modal') {
            await handleLinkModal(interaction, client);
            return;
        }

        // Button: link_prompt (opens modal)
        if (interaction.isButton() && interaction.customId === 'link_prompt') {
            await handleLinkPromptButton(interaction);
            return;
        }

        // Slash commands
        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (err) {
            console.error(err);
            const msg = buildCard(
                'Something went wrong while processing that command.',
                { title: 'Command Error', emoji: '❌', color: 0xED4245, ephemeral: true },
            );
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(msg).catch(() => {});
            } else {
                await interaction.reply(msg).catch(() => {});
            }
        }
    },
};
