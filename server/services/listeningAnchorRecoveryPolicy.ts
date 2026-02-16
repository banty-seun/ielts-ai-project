export const getAnchorRecoveryDecision = (params: {
  policy: string;
  attempt: number;
  maxAttempts: number;
}) => {
  if (params.attempt >= params.maxAttempts) {
    return "stop" as const;
  }
  if (params.policy === "segment") {
    return "segment" as const;
  }
  return "anchor_map" as const;
};
