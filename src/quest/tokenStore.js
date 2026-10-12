import * as crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
};

function deriveKey(secret, salt) {
    return crypto.scryptSync(secret, salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

function legacyKey(secret) {
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text, secret) {
    const salt = crypto.randomBytes(16);
    const key = deriveKey(secret, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
        version: 2,
        kdf: 'scrypt',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted.toString('hex'),
    });
}

function decrypt(stored, secret) {
    try {
        const parsed = JSON.parse(stored);
        const { iv, tag, data } = parsed;
        const key = parsed.kdf === 'scrypt' && parsed.salt
            ? deriveKey(secret, Buffer.from(parsed.salt, 'hex'))
            : legacyKey(secret);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        return Buffer.concat([
            decipher.update(Buffer.from(data, 'hex')),
            decipher.final(),
        ]).toString('utf8');
    } catch {
        return null;
    }
}

export class TokenStore {
    constructor(secret, collection) {
        if (typeof secret !== 'string' || secret.length < 32) {
            throw new Error('SESSION_SECRET must be at least 32 characters long.');
        }
        if (!collection) {
            throw new Error('A MongoDB linked-accounts collection is required.');
        }
        this.secret = secret;
        this.collection = collection;
    }

    async save(userId, token) {
        if (!userId || typeof token !== 'string' || token.length === 0) {
            throw new Error('A user ID and token are required.');
        }
        await this.collection.updateOne(
            { _id: userId },
            {
                $set: {
                    encryptedToken: encrypt(token, this.secret),
                    updatedAt: new Date(),
                },
                $setOnInsert: { createdAt: new Date() },
            },
            { upsert: true },
        );
    }

    async get(userId) {
        const record = await this.collection.findOne(
            { _id: userId },
            { projection: { encryptedToken: 1 } },
        );
        if (!record?.encryptedToken) return null;
        return decrypt(record.encryptedToken, this.secret);
    }

    async remove(userId) {
        const result = await this.collection.deleteOne({ _id: userId });
        return result.deletedCount > 0;
    }

    async has(userId) {
        return Boolean(await this.collection.findOne(
            { _id: userId },
            { projection: { _id: 1 } },
        ));
    }

    async size() {
        return this.collection.countDocuments({});
    }

    async listUserIds() {
        const records = await this.collection.find({}, { projection: { _id: 1 } }).toArray();
        return records.map((record) => record._id);
    }
}
