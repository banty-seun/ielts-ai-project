import type { Pool } from "pg";
import { checkListeningRelations } from "./listeningGovernancePrerequisites";

export const LISTENING_RELEASE_REQUIRED_RELATIONS = [
  "listening_section_state",
  "listening_execution_lock",
  "listening_dead_letter",
  "listening_readiness_model",
  "listening_queue_metric",
  "listening_event_outbox",
] as const;

export const LISTENING_RELEASE_SCHEMA_REMEDIATION =
  "Apply migrations 0005_add_listening_section_state_table.sql, " +
  "0006_add_listening_orchestration_ops_tables.sql, and " +
  "0007_add_listening_event_outbox.sql, then rerun `npm run guard:listening-schema`.";

export type ListeningReleaseSchemaGateResult = {
  ok: boolean;
  db: string;
  schema: string;
  missingRelations: string[];
  checkedRelations: string[];
  message: string;
};

export const formatListeningSchemaGateFailureMessage = (params: {
  db: string;
  schema: string;
  missingRelations: string[];
}) => {
  return (
    `[ListeningSchemaGate] FAIL missing required relation(s): ${params.missingRelations.join(", ")} ` +
    `(db=${params.db}, schema=${params.schema}). Remediation: ${LISTENING_RELEASE_SCHEMA_REMEDIATION}`
  );
};

export const formatListeningSchemaGateSuccessMessage = (params: {
  db: string;
  schema: string;
  checkedCount: number;
}) => {
  return (
    `[ListeningSchemaGate] PASS (db=${params.db}, schema=${params.schema}) ` +
    `checked_relations=${params.checkedCount}`
  );
};

export const runListeningReleaseSchemaGate = async (
  pool: Pool,
): Promise<ListeningReleaseSchemaGateResult> => {
  const dbMeta = await pool.query("select current_database() as db, current_schema() as schema;");
  const db = String(dbMeta.rows?.[0]?.db ?? "unknown");
  const schema = String(dbMeta.rows?.[0]?.schema ?? "public");

  const check = await checkListeningRelations(pool, LISTENING_RELEASE_REQUIRED_RELATIONS);
  if (!check.ok) {
    return {
      ok: false,
      db,
      schema,
      missingRelations: [...check.missingRelations],
      checkedRelations: [...check.checkedRelations],
      message: formatListeningSchemaGateFailureMessage({
        db,
        schema,
        missingRelations: [...check.missingRelations],
      }),
    };
  }

  return {
    ok: true,
    db,
    schema,
    missingRelations: [],
    checkedRelations: [...check.checkedRelations],
    message: formatListeningSchemaGateSuccessMessage({
      db,
      schema,
      checkedCount: check.checkedRelations.length,
    }),
  };
};
