export const normalizeAccent = (accent?: string): "British" | "Canadian" | "Australian" | "American" | "NewZealand" => {
  if (!accent) return "British";
  const key = accent.trim().toLowerCase();
  const map: Record<string, "British" | "Canadian" | "Australian" | "American" | "NewZealand"> = {
    british: "British",
    "en-gb": "British",
    canadian: "Canadian",
    "en-ca": "Canadian",
    australian: "Australian",
    "en-au": "Australian",
    american: "American",
    "en-us": "American",
    "north american": "American",
    "north-american": "American",
    "new zealand": "NewZealand",
    "new-zealand": "NewZealand",
    newzealand: "NewZealand",
    "en-nz": "NewZealand",
  };

  return map[key] ?? "British";
};
