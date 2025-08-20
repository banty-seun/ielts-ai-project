/**
 * Title Builder Service
 * Generates dynamic, part-free listening task titles based on scenario metadata
 */

type ScriptType = 'dialogue' | 'monologue';
type Mode = 'dialogue' | 'discussion' | 'lecture' | 'monologue';

/**
 * Convert string to title case
 */
export function toTitleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Derive the mode based on metadata clues
 */
export function deriveMode(meta: {
  scriptType?: ScriptType | null;
  contextLabel?: string | null;
  topicDomain?: string | null;
  scenarioOverview?: string | null;
}): Mode {
  const hay = `${meta.contextLabel ?? ''} ${meta.topicDomain ?? ''} ${meta.scenarioOverview ?? ''}`.toLowerCase();

  // If it smells academic/lecture-like → "Lecture Analysis"
  if (/(lecture|talk|seminar|keynote|presentation|professor|academic)/.test(hay)) return 'lecture';

  // Group/small-group/tutorial style → "Discussion"
  if (/(discussion|tutorial|group|roundtable|panel|debate|project meeting|classroom)/.test(hay)) return 'discussion';

  if (meta.scriptType === 'monologue') return 'monologue';

  // Default
  return 'dialogue';
}

/**
 * Get appropriate suffix for the mode
 */
export function suffixForMode(mode: Mode): string {
  switch (mode) {
    case 'lecture':     return 'Lecture Analysis';
    case 'discussion':  return 'Discussion';
    case 'monologue':   return 'Monologue';
    case 'dialogue':
    default:            return 'Dialogue Practice';
  }
}

/**
 * Generate a dynamic listening task title
 * Examples: "Office Dialogue Practice", "Museum Guide Monologue", "Academic Lecture Analysis"
 */
export function makeListeningTaskTitle(meta: {
  scriptType?: ScriptType | null;
  contextLabel?: string | null;
  topicDomain?: string | null;
  scenarioOverview?: string | null;
}): string {
  const baseRaw = meta.contextLabel?.trim() || meta.topicDomain?.trim() || 'Listening Practice';
  const base = toTitleCase(baseRaw);
  return `${base} ${suffixForMode(deriveMode(meta))}`;
}

/**
 * Check if a title needs to be updated (contains "Part" or is generic)
 */
export function needsTitleUpdate(title: string | null | undefined): boolean {
  if (!title) return true;
  
  // Check for generic titles or titles containing "Part N"
  return /^listening practice/i.test(title) || /\bpart\s*\d+\b/i.test(title);
}