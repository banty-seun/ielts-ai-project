import assert from "node:assert/strict";
import {
  __resetListeningOrchestratorWorkerForTests,
  enqueueListeningOrchestratorJob,
  getListeningOrchestratorQueueSnapshot,
} from "../listeningOrchestratorWorker";

__resetListeningOrchestratorWorkerForTests();

const first = enqueueListeningOrchestratorJob({
  taskId: "task-1",
  userId: "user-1",
  sectionNo: 1,
  priorityClass: "P3_LATER",
  priorityScore: 10,
});
assert.equal(first.deduped, false);

const deduped = enqueueListeningOrchestratorJob({
  taskId: "task-1",
  userId: "user-1",
  sectionNo: 1,
  priorityClass: "P1_CURRENT",
  priorityScore: 99,
});
assert.equal(deduped.deduped, true);

enqueueListeningOrchestratorJob({
  taskId: "task-2",
  userId: "user-1",
  sectionNo: 1,
  priorityClass: "P2_NEXT_24H",
  priorityScore: 50,
});

const snapshot = getListeningOrchestratorQueueSnapshot();
assert.equal(snapshot.length, 2);
const task1 = snapshot.find((item) => item.taskId === "task-1");
assert.ok(task1);
assert.equal(task1?.priorityClass, "P1_CURRENT");
assert.equal(task1?.priorityScore, 99);

__resetListeningOrchestratorWorkerForTests();

console.log("listening orchestrator worker tests passed");
