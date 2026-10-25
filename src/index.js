import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'node:http';
import deployCommands from './utils/deployCommands.js';
import { makeTokenStore } from './commands/questCommands.js';
import { connectMongoStorage } from './storage/mongoStorage.js';
import { configureAutoquestStore } from './quest/autoquestStore.js';
import { configureGuildSettingsStore } from './utils/premiumConfig.js';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const col = {
    reset:  '\x1b[0m', bright: '\x1b[1m', cyan: '\x1b[96m',
    blue:   '\x1b[34m', white: '\x1b[97m', purple: '\x1b[35m',
    green:  '\x1b[92m', dim:   '\x1b[90m',
};

function banner() {
    const lines = [
        '',
        `${col.cyan}${col.bright}   ██████╗  ██████╗██╗   ██╗ ██╗${col.reset}`,
        `${col.cyan}${col.bright}  ██╔═══██╗██╔════╝██║   ██║███║${col.reset}`,
        `${col.blue}${col.bright}  ██║   ██║██║     ██║   ██║╚██║${col.reset}`,
        `${col.blue}${col.bright}  ██║▄▄ ██║██║     ╚██╗ ██╔╝ ██║${col.reset}`,
        `${col.white}${col.bright}  ╚██████╔╝╚██████╗ ╚████╔╝  ██║${col.reset}`,
        `${col.white}${col.bright}   ╚══▀▀═╝  ╚═════╝  ╚═══╝   ╚═╝${col.reset}`,
        '',
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        `  ${col.green}●${col.reset} ${col.white}Inferix Quest Bot${col.reset}  ${col.dim}|${col.reset}   ${col.white}dsc.gg/synoraxdev${col.reset}`,
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        '',
    ];
    for (const line of lines) process.stdout.write(line + '\n');
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('DISCORD_TOKEN is not set.'); process.exit(1); }

function getStorageSecret() {
    const configuredSecret = process.env.SESSION_SECRET?.trim();
    if (configuredSecret) {
        if (configuredSecret.length < 32) {
            console.error('SESSION_SECRET must be at least 32 characters long.');
            process.exit(1);
        }
        return configuredSecret;
    }

    if (process.env.RAILWAY_SERVICE_ID) {
        console.error('SESSION_SECRET must be set explicitly in Railway to keep encrypted tokens readable across restarts.');
        process.exit(1);
    }

    const generatedSecretFile = '.session-secret';
    if (existsSync(generatedSecretFile)) {
        const savedSecret = readFileSync(generatedSecretFile, 'utf8').trim();
        if (savedSecret.length >= 32) return savedSecret;
        console.error('.session-secret is invalid. Delete it to generate a new secret.');
        process.exit(1);
    }

    const generatedSecret = randomBytes(48).toString('base64url');
    writeFileSync(generatedSecretFile, `${generatedSecret}\n`, { mode: 0o600 });
    chmodSync(generatedSecretFile, 0o600);
    console.log('SESSION_SECRET was not set; generated a local secret in .session-secret.');
    return generatedSecret;
}

const STORAGE_SECRET = getStorageSecret();

let mongoStorage;
try {
    mongoStorage = await connectMongoStorage();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
configureAutoquestStore(mongoStorage.collections.autoquestUsers);
configureGuildSettingsStore(mongoStorage.collections.guildSettings);

banner();
await deployCommands(TOKEN, process.env.DISCORD_CLIENT_ID);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel],
});

const healthServer = createServer((req, res) => {
    if (req.url?.split('?')[0] !== '/healthz') {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'not_found' }));
        return;
    }

    const healthy = client.isReady();
    res.writeHead(healthy ? 200 : 503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'starting' }));
});
const healthPort = Number(process.env.PORT) || 3000;
healthServer.listen(healthPort, '0.0.0.0', () => {
    console.log(`Health check listening on port ${healthPort} at /healthz.`);
});

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; closing bot and MongoDB connections.`);
    client.destroy();
    try {
        await Promise.all([
            new Promise((resolve) => healthServer.close(resolve)),
            mongoStorage.client.close(),
        ]);
    } finally {
        process.exit(0);
    }
}
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

client.commands       = new Collection();
client.prefixCommands = new Collection();
client.tokenStore     = makeTokenStore(STORAGE_SECRET, mongoStorage.collections.linkedAccounts);

const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const mod = await import(pathToFileURL(join(__dirname, 'commands', file)).href);
    // Single default export
    if (mod.default) {
        const cmd = mod.default;
        if (cmd?.data)   client.commands.set(cmd.data.name, cmd);
        if (cmd?.prefix) client.prefixCommands.set(cmd.prefix, cmd);
    }
    // Named exports (questCommands.js has multiple)
    for (const [key, cmd] of Object.entries(mod)) {
        if (key === 'default' || key === 'makeTokenStore' || key === 'handleLinkModal' || key === 'handleLinkPromptButton' || key === 'runAutoquestForUser') continue;
        if (cmd?.data)   client.commands.set(cmd.data.name, cmd);
        if (cmd?.prefix) client.prefixCommands.set(cmd.prefix, cmd);
    }
}

const eventFiles = readdirSync(join(__dirname, 'events')).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
    const mod   = await import(pathToFileURL(join(__dirname, 'events', file)).href);
    const event = mod.default;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

await client.login(TOKEN);
