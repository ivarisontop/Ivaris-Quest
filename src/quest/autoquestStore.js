let collection;

export function configureAutoquestStore(mongoCollection) {
    collection = mongoCollection;
}

function getCollection() {
    if (!collection) throw new Error('MongoDB auto-quest storage has not been initialized.');
    return collection;
}

export async function enableAutoquest(userId) {
    const store = getCollection();
    const existing = await store.findOne(
        { _id: userId, enabled: true },
        { projection: { _id: 1 } },
    );
    if (existing) return false;

    const result = await store.updateOne(
        { _id: userId },
        { $set: { enabled: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
    );
    return result.upsertedCount > 0 || result.modifiedCount > 0;
}

export async function disableAutoquest(userId) {
    const result = await getCollection().deleteOne({ _id: userId });
    return result.deletedCount > 0;
}

export async function isAutoquestEnabled(userId) {
    return Boolean(await getCollection().findOne(
        { _id: userId, enabled: true },
        { projection: { _id: 1 } },
    ));
}

export async function getAutoquestUsers() {
    const records = await getCollection()
        .find({ enabled: true }, { projection: { _id: 1 } })
        .toArray();
    return records.map((record) => record._id);
}

export async function getAutoquestUserCount() {
    return getCollection().countDocuments({ enabled: true });
}
