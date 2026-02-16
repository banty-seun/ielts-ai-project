import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS,
  LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS,
  buildListeningRelationLookupSelect,
  checkListeningRelations,
  mapMissingListeningRelations,
} from "../listeningGovernancePrerequisites";

test("governance+rollout prerequisite relation set includes critical tables", () => {
  assert.equal(
    LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS.includes("listening_governance_ledger"),
    true,
  );
  assert.equal(
    LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS.includes("listening_rollout_audit"),
    true,
  );
});

test("scheduler prerequisite relation set extends critical rollout prerequisites", () => {
  assert.equal(
    LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS.includes("listening_governance_ledger"),
    true,
  );
  assert.equal(
    LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS.includes("listening_rollout_audit"),
    true,
  );
  assert.equal(
    LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS.includes("listening_governance_review_report"),
    true,
  );
});

test("relation lookup select and missing relation mapping are deterministic", () => {
  const relations = ["table_a", "table_b", "table_c"] as const;
  const select = buildListeningRelationLookupSelect(relations);
  assert.equal(select.includes("to_regclass('public.table_a') as rel_0"), true);
  assert.equal(select.includes("to_regclass('public.table_b') as rel_1"), true);
  assert.equal(select.includes("to_regclass('public.table_c') as rel_2"), true);

  const missing = mapMissingListeningRelations(relations, {
    rel_0: "table_a",
    rel_1: null,
    rel_2: undefined,
  });
  assert.deepEqual(missing, ["table_b", "table_c"]);
});

test("relation checker fails when rollout prerequisite relation is missing", async () => {
  const observedSql: string[] = [];
  const pool = {
    async query(sql: string) {
      observedSql.push(sql);
      return {
        rows: [
          {
            rel_0: "listening_governance_ledger",
            rel_1: null,
          },
        ],
      };
    },
  } as any;

  const result = await checkListeningRelations(
    pool,
    LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRelations, ["listening_rollout_audit"]);
  assert.deepEqual(result.checkedRelations, [
    "listening_governance_ledger",
    "listening_rollout_audit",
  ]);
  assert.equal(observedSql.some((sql) => sql.includes("to_regclass('public.listening_governance_ledger')")), true);
  assert.equal(observedSql.some((sql) => sql.includes("to_regclass('public.listening_rollout_audit')")), true);
});

test("relation checker passes when governance and rollout prerequisites exist", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            rel_0: "listening_governance_ledger",
            rel_1: "listening_rollout_audit",
          },
        ],
      };
    },
  } as any;

  const result = await checkListeningRelations(
    pool,
    LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.missingRelations, []);
  assert.deepEqual(result.checkedRelations, [
    "listening_governance_ledger",
    "listening_rollout_audit",
  ]);
});
