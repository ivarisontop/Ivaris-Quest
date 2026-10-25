# Inferix Quest Bot

A Discord.js bot to manage and complete quests automatically.

## Features / Commands

| Command | Description |
|---|---|
| `/link` | Link your account so the bot can track and complete quests for you |
| `/quest` | Complete a single specific quest |
| `/questall` | Complete all available quests at once |
| `/autoquest` | Enable automatic quest completion in the background |
| `/setadminrole` | Set the role allowed to configure admin commands (Manage Server required) |
| `/adminrole` | Show the configured admin role |
| `/setpremium` | Set, enable, disable, or check the server premium role (admin role required) |
| `/setstatus` | Set the bot activity status (admin role required) |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Your bot's token from the Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Your application's client ID |
| `MONGODB_URI` | Yes | MongoDB connection string; keep it private |
| `MONGODB_DB` | No | Database name (default: `inferix_quest_bot`) |
| `SESSION_SECRET` | Yes on Railway | Stable encryption key, at least 32 characters |
| `BOT_PREFIX` | No | Prefix for text commands (default: `,`) |
| `ADMIN_ROLE_ID` | No | Discord role ID allowed to use admin configuration commands globally |

Create a `.env` file in the root directory:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB=inferix_quest_bot
SESSION_SECRET=use-a-stable-random-secret-of-at-least-32-characters
BOT_PREFIX=,
```

## File-based configuration (hosts without environment variables)

Open `src/utils/config.js` and replace the three `PASTE_..._HERE` placeholders with your MongoDB URI, Discord application/client ID, and Discord bot token. For stable encrypted linked-account storage across restarts, also replace the `SESSION_SECRET` placeholder with a private random string of at least 32 characters. Keep this file private and do not publish it. Environment variables still override the values in this file when they are available.

## Installation

```bash
npm ci
```

Then start the bot:

```bash
npm start
```

The Replit `Start application` workflow runs the same command.

## Railway hosting

1. In Railway, create a MongoDB service and a regular Node.js service for this repository. Do not configure the bot as a cron job.
2. Railway detects the existing `npm start` script as the service start command.
3. Add these variables to the bot service:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `MONGODB_URI`, referencing the Mongo service's private `MONGO_URL` (for example, `${{MongoDB.MONGO_URL}}`; use your Mongo service's actual name)
   - `SESSION_SECRET`, a stable random value at least 32 characters long
   - Optional: `MONGODB_DB`, `BOT_PREFIX`, and `ADMIN_ROLE_ID`
4. Set the service restart policy to **Always** when available. Railway's default **On Failure** policy restarts crashed services; Free/trial plans limit this to 10 restarts.

Railway runs this as a continuously running service; UptimeRobot is not required. The bot also exposes `GET /healthz` for optional health checks. On the first MongoDB startup, legacy `tokens.json`, `autoquest.json`, and `data/config.json` records present in the deployment are imported once without deleting the originals.

## Notes

- Make sure your bot has the required Gateway Intents enabled from the Discord Developer Portal.
- Slash commands may take a few minutes to register/update globally.
- By default, premium restriction is disabled. A server manager can run `,setpremium @role` to require that role for `/questall` and `/autoquest`.
- Use `,setpremium off` to allow everyone to use those commands, `,setpremium on` to re-enable the saved role, and `,setpremium status` to check the current setting.
- `,quest <quest-id>` displays the quest name, ID, live progress, and completion status. The progress card refreshes every 5 seconds.
- `,questall` displays completed quests plus remaining/in-progress quests with IDs and live progress. Finished quests are marked `DONE`.
- `,autoquest on` sends you a DM when background mode enrolls in a quest.
- Use `,setadminrole @Admin` to choose the role that can use admin configuration commands.
- Alternatively, add `ADMIN_ROLE_ID` as a Replit Secret with the Discord role ID to use the same admin role across servers.
- Never commit `.env`, `MONGODB_URI`, `tokens.json`, `autoquest.json`, or any generated runtime data.
- Local runs generate `.session-secret` if `SESSION_SECRET` is omitted. Railway requires an explicit stable `SESSION_SECRET`; changing it makes existing encrypted linked-account tokens unreadable.
- Token encryption protects stored data at rest; it does not make account tokens undetectable or prevent Discord from revoking them. Use official Discord bot/OAuth2 authentication where possible.
- Admin configuration commands are `setadminrole`, `adminrole`, `setpremium`, and `setstatus`.
- Set a status with `,setstatus watching Quest updates`, or use `/setstatus` for the guided options.
- The bot exposes `GET /healthz`, returning HTTP 200 after it has connected to Discord. This is optional monitoring; it is not required to keep the Railway service running.

## Support

- **Support Server:** [discord.gg/inferix](https://discord.gg/inferix)
- **Developer:** Elf_magic27
