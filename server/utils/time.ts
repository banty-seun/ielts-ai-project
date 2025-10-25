export const minutesToLabel = (mins?: number) =>
  typeof mins === "number" && mins > 0 ? `${mins} min` : "30 min";
