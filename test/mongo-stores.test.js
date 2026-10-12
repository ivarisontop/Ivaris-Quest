import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenStore } from '../src/quest/tokenStore.js';
import {
    configureAutoquestStore,
    disableAutoquest,
    enableAutoquest,
    getAutoquestUserCount,
    getAutoquestUsers,
    isAutoquestEnabled,
} from '../src/quest/autoquestStore.js';
import {
    configureGuildSettingsStore,
    getAdminRoleId,
    getPremiumConfig,
    updateAdminRole,
    updatePremiumConfig,
} from '../src/utils/premiumConfig.js';

function setPath(target, dottedPath, value) {
    const parts = dottedPath.split('.');
    let current = target;
    for (const part of parts.slice(0, -1)) {
        current[part] ??= {};
        current = current[part];
    }
    current[parts.at(-1)] = value;
}

class MemoryCollection {
    documents = new Map();

    matches(filter, document) {
        return Object.entries(filter).every(([key, value]) => document[key] === value);
    }

    async findOne(filter) {
        const document = this.documents.get(filter._id);
        return document && this.matches(filter, document)
            ? structuredClone(document)
            : null;
    }

    async updateOne(filter, update, { upsert = false } = {}) {
        let document = this.documents.get(filter._id);
        const inserted = !document && upsert;
        if (!document && !upsert) return { upsertedCount: 0, modifiedCount: 0 };

        if (!document) {
            document = { _id: filter._id };
            this.documents.set(filter._id, document);
        }
        const before = JSON.stringify(document);

        if (inserted && update.$setOnInsert) {
            Object.assign(document, structuredClone(update.$setOnInsert));
        }
        for (const [key, value] of Object.entries(update.$set ?? {})) {
            if (key.includes('.')) setPath(document, key, structuredClone(value));
            else document[key] = structuredClone(value);
        }

        return {
            upsertedCount: inserted ? 1 : 0,
            modifiedCount: !inserted && JSON.stringify(document) !== before ? 1 : 0,
        };
    }

    async deleteOne(filter) {
        if (!this.documents.has(filter._id)) return { deletedCount: 0 };
        this.documents.delete(filter._id);
        return { deletedCount: 1 };
    }

    async countDocuments(filter = {}) {
        return [...this.documents.values()].filter((document) => this.matches(filter, document)).length;
    }

    find(filter = {}) {
        return {
            toArray: async () => [...this.documents.values()]
                .filter((document) => this.matches(filter, document))
                .map((document) => structuredClone(document)),
        };
    }
}

test('linked-account tokens are encrypted in MongoDB and can be read, counted, and removed', async () => {
    const collection = new MemoryCollection();
    const store = new TokenStore('stable-test-secret-'.padEnd(48, 'x'), collection);

    await store.save('user-1', 'discord-user-token');
    assert.equal(await store.has('user-1'), true);
    assert.equal(await store.get('user-1'), 'discord-user-token');
    assert.equal(await store.size(), 1);
    assert.deepEqual(await store.listUserIds(), ['user-1']);
    assert.equal(collection.documents.get('user-1').encryptedToken.includes('discord-user-token'), false);
    assert.equal(await store.remove('user-1'), true);
    assert.equal(await store.get('user-1'), null);
});

test('auto-quest preferences persist and can be listed and disabled', async () => {
    const collection = new MemoryCollection();
    configureAutoquestStore(collection);

    assert.equal(await enableAutoquest('user-2'), true);
    assert.equal(await enableAutoquest('user-2'), false);
    assert.equal(await isAutoquestEnabled('user-2'), true);
    assert.deepEqual(await getAutoquestUsers(), ['user-2']);
    assert.equal(await getAutoquestUserCount(), 1);
    assert.equal(await disableAutoquest('user-2'), true);
    assert.equal(await isAutoquestEnabled('user-2'), false);
});

test('guild admin and premium settings persist independently', async () => {
    const collection = new MemoryCollection();
    configureGuildSettingsStore(collection);

    await updateAdminRole('guild-1', 'role-1');
    await updatePremiumConfig('guild-1', { roleId: 'role-2', enabled: true });
    assert.equal(await getAdminRoleId('guild-1'), 'role-1');
    assert.deepEqual(await getPremiumConfig('guild-1'), { enabled: true, roleId: 'role-2' });

    await updatePremiumConfig('guild-1', { enabled: false });
    assert.deepEqual(await getPremiumConfig('guild-1'), { enabled: false, roleId: 'role-2' });
});
