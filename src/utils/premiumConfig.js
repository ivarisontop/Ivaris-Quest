let collection;

export function configureGuildSettingsStore(mongoCollection) {
    collection = mongoCollection;
}

function getCollection() {
    if (!collection) throw new Error('MongoDB guild-settings storage has not been initialized.');
    return collection;
}

export async function getPremiumConfig(guildId) {
    const guildConfig = await getCollection().findOne(
        { _id: guildId },
        { projection: { premium: 1 } },
    );
    const premium = guildConfig?.premium;
    return {
        enabled: Boolean(premium?.enabled),
        roleId: premium?.roleId ?? null,
    };
}

export async function updatePremiumConfig(guildId, changes) {
    const updates = {};
    if ('enabled' in changes) updates['premium.enabled'] = Boolean(changes.enabled);
    if ('roleId' in changes) updates['premium.roleId'] = changes.roleId ?? null;
    if (Object.keys(updates).length === 0) return getPremiumConfig(guildId);

    await getCollection().updateOne(
        { _id: guildId },
        {
            $set: { ...updates, updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
    );
    return getPremiumConfig(guildId);
}

export async function getAdminRoleId(guildId) {
    const guildConfig = guildId
        ? await getCollection().findOne({ _id: guildId }, { projection: { adminRoleId: 1 } })
        : null;
    return guildConfig?.adminRoleId ?? process.env.ADMIN_ROLE_ID?.trim() ?? null;
}

export async function updateAdminRole(guildId, roleId) {
    const value = roleId || null;
    await getCollection().updateOne(
        { _id: guildId },
        {
            $set: { adminRoleId: value, updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
    );
    return value;
}
