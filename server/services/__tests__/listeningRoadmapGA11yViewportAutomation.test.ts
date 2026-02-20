import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PRACTICE_PAGE_PATH = path.resolve(process.cwd(), "client/src/pages/practice.tsx");
const practiceSource = readFileSync(PRACTICE_PAGE_PATH, "utf8");

const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

const resolveViewportTokens = (className: string, width: number) => {
  const resolved: string[] = [];
  const tokens = className.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const parts = token.split(":");
    if (parts.length === 1) {
      resolved.push(token);
      continue;
    }
    const prefix = parts[0];
    const value = parts.slice(1).join(":");
    const minWidth = BREAKPOINTS[prefix];
    if (typeof minWidth === "number" && width >= minWidth) {
      resolved.push(value);
    }
  }
  return resolved;
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
};

const linearize = (value: number) => {
  if (value <= 0.03928) {
    return value / 12.92;
  }
  return ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const rgb = hexToRgb(hex);
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
};

const contrastRatio = (textHex: string, bgHex: string) => {
  const l1 = luminance(textHex);
  const l2 = luminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

test("viewport automation validates mobile-first classes for startup and segmented runtime controls", () => {
  const startupContainer = "container mx-auto px-4 py-8 sm:py-12";
  const startupActions = "mt-4 flex flex-col sm:flex-row gap-3";
  const segmentedGrid = "grid-cols-2 sm:grid-cols-4";
  const transitionCard = "p-6 sm:p-8";

  assert.match(practiceSource, new RegExp(startupContainer.replace(/\[/g, "\\[").replace(/\]/g, "\\]")));
  assert.match(practiceSource, new RegExp(startupActions.replace(/\[/g, "\\[").replace(/\]/g, "\\]")));
  assert.match(practiceSource, new RegExp(segmentedGrid.replace(/\[/g, "\\[").replace(/\]/g, "\\]")));
  assert.match(practiceSource, new RegExp(transitionCard.replace(/\[/g, "\\[").replace(/\]/g, "\\]")));

  const mobileStartup = resolveViewportTokens(startupContainer, 375);
  const tabletStartup = resolveViewportTokens(startupContainer, 768);
  const mobileActions = resolveViewportTokens(startupActions, 375);
  const tabletActions = resolveViewportTokens(startupActions, 768);
  const mobileGrid = resolveViewportTokens(segmentedGrid, 375);
  const tabletGrid = resolveViewportTokens(segmentedGrid, 768);

  assert.ok(mobileStartup.includes("py-8"));
  assert.ok(!mobileStartup.includes("py-12"));
  assert.ok(tabletStartup.includes("py-12"));

  assert.ok(mobileActions.includes("flex-col"));
  assert.ok(!mobileActions.includes("flex-row"));
  assert.ok(tabletActions.includes("flex-row"));

  assert.ok(mobileGrid.includes("grid-cols-2"));
  assert.ok(!mobileGrid.includes("grid-cols-4"));
  assert.ok(tabletGrid.includes("grid-cols-4"));
});

test("accessibility automation keeps focus affordances and WCAG AA contrast for runtime status text", () => {
  const focusRingCount = (practiceSource.match(/focus-visible:ring-2/g) ?? []).length;
  assert.ok(focusRingCount >= 6, `Expected >= 6 focus-visible ring affordances, found ${focusRingCount}`);

  const pairings = [
    { text: "#4b5563", bg: "#ffffff", label: "gray-600 on white" },
    { text: "#6b7280", bg: "#ffffff", label: "gray-500 on white" },
    { text: "#1d4ed8", bg: "#eff6ff", label: "blue-700 on blue-50" },
    { text: "#b91c1c", bg: "#fef2f2", label: "red-700 on red-50" },
    { text: "#b45309", bg: "#ffffff", label: "amber-700 on white" },
  ];

  pairings.forEach((pair) => {
    const ratio = contrastRatio(pair.text, pair.bg);
    assert.ok(ratio >= 4.5, `${pair.label} contrast ratio ${ratio.toFixed(2)} is below 4.5`);
  });

  assert.match(practiceSource, /aria-label="Current section audio player"/);
  assert.match(practiceSource, /aria-label="Retry next part transition"/);
  assert.match(practiceSource, /aria-label="Exit safely to dashboard"/);
  assert.match(practiceSource, /role="status" aria-live="polite"/);
});
