import { getAutoquestUsers } from '../quest/autoquestStore.js';
import { runAutoquestForUser } from '../commands/questCommands.js';
import { QuestClient } from '../quest/questClient.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
const completedQuestIds = new Set(); // track already-processed quest IDs globally
const inFlightQuestIds = new Set();
const inFlightUsers = new Set();

async function processUserQuests(userId, quests, client) {
    for (const quest of quests) {
        const key = `${userId}:${quest.id}`;
        if (completedQuestIds.has(key) || inFlightQuestIds.has(key)) continue;

        inFlightQuestIds.add(key);
        try {
            const result = await runAutoquestForUser(userId, quest, client.tokenStore, client);
            if (result?.completed) completedQuestIds.add(key);
        } catch {
            // A failed quest can be retried during the next watcher poll.
        } finally {
            inFlightQuestIds.delete(key);
        }
    }
}

export function startAutoquestWatcher(client) {
    console.log('  \x1b[92m●\x1b[0m \x1b[97mAutoquest watcher started\x1b[0m');

    setInterval(async () => {
        const users = await getAutoquestUsers();
        if (users.length === 0) return;

        for (const userId of users) {
            try {
                const token = await client.tokenStore.get(userId);
                if (!token) continue;

                const qc = new QuestClient(token);
                const manager = await qc.fetchQuests();
                const valid = manager.filterQuestsValid();
                if (!valid.length || inFlightUsers.has(userId)) continue;

                inFlightUsers.add(userId);
                // Process one user's quests in order so a rest happens before the next quest.
                processUserQuests(userId, valid, client)
                    .catch(() => {})
                    .finally(() => inFlightUsers.delete(userId));
            } catch {
                // silently skip — token may be expired, handled inside runAutoquestForUser
            }
        }
    }, POLL_INTERVAL_MS);
}
