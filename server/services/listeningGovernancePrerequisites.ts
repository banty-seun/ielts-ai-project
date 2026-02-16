import type { Pool } from "pg";

export const LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS = [
  "listening_governance_ledger",
  "listening_rollout_audit",
] as const;

export const LISTENING_GOVERNANCE_SCHEDULER_REQUIRED_RELATIONS = [
  ...LISTENING_GOVERNANCE_ROLLOUT_PREREQUISITE_RELATIONS,
  "listening_governance_review_report",
  "listening_governance_exception",
] as const;

export const buildListeningRelationLookupSelect = (relations: readonly string[]) => {
  return relations
    .map((relation, index) => `to_regclass('public.${relation}') as rel_${index}`)
    .join(", ");
};

export const mapMissingListeningRelations = (
  relations: readonly string[],
  row: Record<string, string | null | undefined>,
) => {
  return relations.filter((_, index) => !row[`rel_${index}`]);
};

export const checkListeningRelations = async (
  pool: Pool,
  relations: readonly string[],
) => {
  const select = buildListeningRelationLookupSelect(relations);
  const result = await pool.query(`select ${select};`);
  const row = (result.rows?.[0] ?? {}) as Record<string, string | null | undefined>;
  const missingRelations = mapMissingListeningRelations(relations, row);
  return {
    ok: missingRelations.length === 0,
    missingRelations,
    checkedRelations: [...relations],
  };
};
