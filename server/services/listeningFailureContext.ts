export const buildScriptSubsystemFailureContext = (params: {
  stage?: string;
  errorCode?: string;
  retryable?: boolean;
  details?: unknown;
  continuity?: unknown;
  anchorValidation?: unknown;
}) => {
  const details = Array.isArray(params.details) ? params.details : [];
  return {
    stage: params.stage ?? "script_subsystem",
    error_code: params.errorCode ?? "UNKNOWN",
    retryable: Boolean(params.retryable),
    details,
    continuity_report: params.continuity ?? null,
    anchor_validation: params.anchorValidation ?? null,
  };
};
