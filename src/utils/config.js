/**
 * Ivaris Quest Bot configuration.
 *
 * Put your credentials below when your hosting provider does not support
 * environment variables. Keep this file private and never publish it.
 * Environment variables, when available, take priority over these values.
 */

export const MONGODB_URI = process.env.MONGODB_URI?.trim() || 'PASTE_YOUR_MONGODB_URI_HERE';
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim() || 'PASTE_YOUR_DISCORD_CLIENT_ID_HERE';
export const DISCORD_TOKEN = process.env.DISCORD_TOKEN?.trim() || 'PASTE_YOUR_DISCORD_BOT_TOKEN_HERE';

// Optional: use a long random value (at least 32 characters) to keep encrypted
// linked-account tokens readable across restarts/host migrations.
export const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || 'CHANGE_THIS_TO_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS_LONG';

export const PREFIX = process.env.BOT_PREFIX || ',';
export const MONGODB_DB = process.env.MONGODB_DB?.trim() || 'inferix_quest_bot';
export const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID?.trim() || '';
