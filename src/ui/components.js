import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from 'discord.js';

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2;

export function componentsV2Flags(ephemeral = false) {
    return MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
}

export function buildCard(content, {
    title = 'Inferix Quest Bot',
    emoji = '✨',
    color = 0x5865F2,
    ephemeral = false,
} = {}) {
    const container = new ContainerBuilder().setAccentColor(color);
    const heading = emoji ? `${emoji} **${title}**` : `**${title}**`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading));
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(content)));

    return {
        components: [container],
        flags: componentsV2Flags(ephemeral),
    };
}

export function buildLinkCard({ ephemeral = false } = {}) {
    const button = new ButtonBuilder()
        .setCustomId('link_prompt')
        .setLabel('Click Here to Link Your Account')
        .setStyle(ButtonStyle.Primary);

    const container = new ContainerBuilder().setAccentColor(0x5865F2);
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '# 🔗 Link Your Discord Account\n' +
            'Follow the steps below to link your Discord account to the bot:',
        ),
    );
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '## 🧷 Step 1: Get Your Token\n' +
            '1. Open Discord in your browser\n' +
            '2. Press `Ctrl+Shift+I` (Windows) or `Cmd+Option+I` (Mac)\n' +
            '3. Go to **Application → Storage → Local Storage → https://discord.com/**\n' +
            '4. Find the `token` key and copy its value',
        ),
    );
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '## 🧷 Step 2: Click the Button Below\n' +
            'Click the button below to open the secure token input form.\n\n' +
            '## 🧷 Step 3: Enter Your Token\n' +
            'Paste your token in the input field and submit.\n\n' +
            '## 🧷 Step 4: Start the Bot\n' +
            'After linking, use `/questall` or your prefix questall command to begin.\n\n' +
            '## 🧷 Step 5: Enjoy!\n' +
            'The bot will automatically complete your quests! 🎉\n\n' +
            '*Your token is encrypted and stored locally on the bot.*',
        ),
    );
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(button),
    );

    return {
        components: [container],
        flags: componentsV2Flags(ephemeral),
    };
}
