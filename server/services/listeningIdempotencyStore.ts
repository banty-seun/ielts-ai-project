import { storage } from "../storage";

const IDEMPOTENCY_ROOT_KEY = "listeningIdempotency";
const MAX_KEYS_PER_TASK = 500;

const readStore = (progressData: Record<string, any>) => {
  const raw = progressData[IDEMPOTENCY_ROOT_KEY];
  if (!raw || typeof raw !== "object") {
    return {} as Record<string, string>;
  }
  return raw as Record<string, string>;
};

export const hasProcessedListeningIdempotencyKey = async (taskId: string, idempotencyKey: string) => {
  const task = await storage.getTaskProgress(taskId);
  if (!task) return false;

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const keyStore = readStore(progressData);
  return Boolean(keyStore[idempotencyKey]);
};

export const markProcessedListeningIdempotencyKey = async (taskId: string, idempotencyKey: string) => {
  const task = await storage.getTaskProgress(taskId);
  if (!task) return;

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const keyStore = readStore(progressData);
  if (keyStore[idempotencyKey]) {
    return;
  }

  keyStore[idempotencyKey] = new Date().toISOString();
  const keys = Object.keys(keyStore);
  if (keys.length > MAX_KEYS_PER_TASK) {
    keys
      .sort((a, b) => new Date(keyStore[a]).getTime() - new Date(keyStore[b]).getTime())
      .slice(0, keys.length - MAX_KEYS_PER_TASK)
      .forEach((staleKey) => {
        delete keyStore[staleKey];
      });
  }

  await storage.updateTaskProgress(taskId, {
    progressData: {
      ...progressData,
      [IDEMPOTENCY_ROOT_KEY]: keyStore,
    },
  });
};
