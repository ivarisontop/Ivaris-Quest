const MIN_QUESTS_BEFORE_REST = 2;
const MAX_QUESTS_BEFORE_REST = 3;
const MIN_REST_SECONDS = 30;
const MAX_REST_SECONDS = 60;

const userRestStates = new Map();

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getState(userId) {
    let state = userRestStates.get(userId);
    if (!state) {
        state = {
            completedSinceRest: 0,
            questsUntilRest: randomInt(MIN_QUESTS_BEFORE_REST, MAX_QUESTS_BEFORE_REST),
            restPromise: null,
        };
        userRestStates.set(userId, state);
    }
    return state;
}

/**
 * Count a completed quest and pause after a random 2–3 quests.
 *
 * The per-user promise prevents quests started close together from running
 * through an active rest at the same time.
 */
export async function takeQuestRest(userId, { onRestStart = () => {}, log = () => {} } = {}) {
    if (!userId) return { rested: false };

    const state = getState(userId);
    if (state.restPromise) await state.restPromise;

    state.completedSinceRest++;
    if (state.completedSinceRest < state.questsUntilRest) {
        return { rested: false };
    }

    const restSeconds = randomInt(MIN_REST_SECONDS, MAX_REST_SECONDS);
    state.completedSinceRest = 0;
    state.questsUntilRest = randomInt(MIN_QUESTS_BEFORE_REST, MAX_QUESTS_BEFORE_REST);

    const restPromise = (async () => {
        try {
            await onRestStart(restSeconds);
        } catch {
            // A progress-message update must not cancel the required rest.
        }
        log(`Taking a ${restSeconds}-second rest after completing quests.`);
        await sleep(restSeconds * 1000);
    })();

    state.restPromise = restPromise;
    try {
        await restPromise;
    } finally {
        if (state.restPromise === restPromise) state.restPromise = null;
    }

    return { rested: true, seconds: restSeconds };
}