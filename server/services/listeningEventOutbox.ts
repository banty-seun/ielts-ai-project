import { randomUUID } from "crypto";
import type { ListeningEventEnvelope, ListeningEventTopic } from "@shared/listening";
import { storage } from "../storage";

export const persistListeningEventToOutbox = async (params: {
  taskProgressId: string;
  userId: string;
  topic: ListeningEventTopic;
  event: ListeningEventEnvelope;
}) => {
  return storage.insertListeningEventOutbox({
    id: `leo_${randomUUID()}`,
    taskProgressId: params.taskProgressId,
    userId: params.userId,
    topic: params.topic,
    eventType: params.event.event_type,
    eventVersion: params.event.event_version,
    eventId: params.event.event_id,
    envelope: params.event as unknown as Record<string, unknown>,
  });
};
