import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const LEGACY_MIGRATION_ID = 'legacy-json-stores-v1';

function readLegacyJson(relativePath, fallback) {
    const filePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        throw new Error(`Could not read legacy storage file: ${relativePath}`);
    }
}

async function bulkUpsert(collection, records) {
    if (records.length === 0) return 0;

    const result = await collection.bulkWrite(
        records.map((record) => ({
            updateOne: {
                filter: { _id: record._id },
                update: { $setOnInsert: record },
                upsert: true,
            },
        })),
        { ordered: false },
    );
    return result.upsertedCount;
}

async function importLegacyJsonStores(database, collections) {
    const migrations = database.collection('_migrations');
    if (await migrations.findOne({ _id: LEGACY_MIGRATION_ID })) {
        return { linkedAccounts: 0, autoquestUsers: 0, guildSettings: 0 };
    }

    const legacyTokens = readLegacyJson('tokens.json', {});
    const legacyAutoquest = readLegacyJson('autoquest.json', []);
    const legacyConfig = readLegacyJson('data/config.json', {});

    const linkedAccountRecords = Object.entries(
        legacyTokens && typeof legacyTokens === 'object' && !Array.isArray(legacyTokens)
            ? legacyTokens
            : {},
    )
        .filter(([userId, encryptedToken]) => userId && typeof encryptedToken === 'string' && encryptedToken)
        .map(([userId, encryptedToken]) => ({
            _id: userId,
            encryptedToken,
            createdAt: new Date(),
        }));

    const autoquestRecords = Array.isArray(legacyAutoquest)
        ? [...new Set(legacyAutoquest.filter((userId) => typeof userId === 'string' && userId))]
            .map((userId) => ({ _id: userId, enabled: true }))
        : [];

    const legacyGuilds = legacyConfig?.guilds;
    const guildSettingRecords = legacyGuilds && typeof legacyGuilds === 'object' && !Array.isArray(legacyGuilds)
        ? Object.entries(legacyGuilds)
            .filter(([guildId, config]) => guildId && config && typeof config === 'object')
            .map(([guildId, config]) => ({
                _id: guildId,
                adminRoleId: config.adminRoleId ?? null,
                premium: {
                    enabled: Boolean(config.premium?.enabled),
                    roleId: config.premium?.roleId ?? null,
                },
            }))
        : [];

    const imported = {
        linkedAccounts: await bulkUpsert(collections.linkedAccounts, linkedAccountRecords),
        autoquestUsers: await bulkUpsert(collections.autoquestUsers, autoquestRecords),
        guildSettings: await bulkUpsert(collections.guildSettings, guildSettingRecords),
    };

    try {
        await migrations.insertOne({
            _id: LEGACY_MIGRATION_ID,
            completedAt: new Date(),
            imported,
        });
    } catch (error) {
        if (error?.code !== 11000) throw error;
    }

    return imported;
}

export async function connectMongoStorage() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
        throw new Error('MONGODB_URI is required. Add the MongoDB connection string to the service environment.');
    }

    let client;
    try {
        client = new MongoClient(uri, {
            appName: 'inferix-quest-bot',
            serverSelectionTimeoutMS: 12_000,
        });
        await client.connect();

        const databaseName = process.env.MONGODB_DB?.trim() || 'inferix_quest_bot';
        const database = client.db(databaseName);
        await database.command({ ping: 1 });

        const collections = {
            linkedAccounts: database.collection('linked_accounts'),
            autoquestUsers: database.collection('autoquest_users'),
            guildSettings: database.collection('guild_settings'),
        };
        await collections.autoquestUsers.createIndex({ enabled: 1 });

        const imported = await importLegacyJsonStores(database, collections);
        const importedCount = Object.values(imported).reduce((total, count) => total + count, 0);
        console.log(`MongoDB connected. Imported ${importedCount} legacy record(s).`);

        return { client, database, collections };
    } catch (error) {
        await client?.close().catch(() => {});
        if (error instanceof Error && error.message.startsWith('MONGODB_URI is required')) {
            throw error;
        }
        throw new Error(`MongoDB setup failed (${error?.name || 'unknown error'}). Check the URI and database access.`);
    }
}
