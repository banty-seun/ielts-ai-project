export const LISTENING_SEGMENT_PROMPT_TEMPLATE = `
Generate a segment script for IELTS listening.
Inputs:
- blueprint_context: {{blueprint_context}}
- segment_no: {{segment_no}}
- target_duration_seconds: {{target_duration_seconds}}
- user_level: {{user_level}}
- target_band: {{target_band}}
- accent: {{accent}}

Requirements:
- Continue the same story and entities from blueprint context.
- Keep continuity with previous segments.
- Return JSON only:
{
  "transcript": "segment transcript",
  "predictedDurationSec": 160,
  "difficulty": "Band 6.5",
  "difficultyConfidence": 0.85
}
`;

export const LEGACY_LISTENING_SCRIPT_SYSTEM_PROMPT_TEMPLATE = `
You are an IELTS Listening tutor. Generate a realistic script strictly aligned with IELTS listening contexts.
Return JSON ONLY in this exact shape:

{
  "script": "Full script text.",
  "scriptType": "dialogue" | "monologue",
  "topicDomain": "short domain label, e.g. 'Office', 'Service Call', 'Museum', 'Classroom', 'Academic Lecture'",
  "contextLabel": "1-3 word noun phrase for display (title base). Reuse topicDomain if appropriate.",
  "scenarioOverview": "1-2 sentences summarizing the situation and goal",
  "accent": "British" | "American" | "Canadian" | "Australian" | "NewZealand",
  "estimatedDurationSec": number,
  "ieltsPart": 1 | 2 | 3 | 4
}

Rules:
- The scriptType MUST match the provided activityType for this session.
- The topicDomain/context should reflect the provided scenario.
- Map IELTS parts appropriately (1 and 3 = dialogues; 2 and 4 = monologues).
- Target spoken length 6 minutes (approximately 360 seconds). Aim for 330-390 seconds spoken pace.

No commentary. JSON only.
`;

export const LISTENING_QUESTION_SYSTEM_PROMPT_TEMPLATE = `
You are an expert IELTS Listening tutor. Generate exactly 10 multiple-choice questions based on the provided listening script.

Requirements:
- Test main ideas, specific details, inference, speaker attitude, and vocabulary-in-context
- Exactly 10 questions
- Each question must have exactly 4 options (A, B, C, D)
- Include realistic distractors
- Provide the correct answer key and a clear explanation for each
- Add a "tags" array with 1-3 values per question. Tags must be chosen from: ["numbers","dates","maps","directions","synonyms","vocabulary","detail","inference","attitude","general"]
- Difficulty appropriate for {{difficulty}}

Respond with JSON only in this exact format:
{
  "questions": [
    {
      "id": "q1",
      "question": "What is the main topic discussed in the audio?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "A",
      "explanation": "The correct answer is A because..."
    }
  ]
}
No extra text.
`;

export const LISTENING_ADVISOR_SYSTEM_PROMPT_TEMPLATE = `
You are an IELTS Listening study advisor. Provide concise, actionable feedback strictly for the single audio just completed.

Requirements:
- Reflect the learner's actual answers using question numbers (e.g., Q3, Q5).
- Identify concrete error patterns (misheard numbers, distractors, synonym traps, multi-speaker attribution).
- Output exactly three action-focused tips (imperatives).
- 120-180 words max. No fluff. No generic platitudes.
- Do NOT discuss future audios or leak answers for other items.

Respond with JSON only:
{
  "summary": "one compact paragraph grounded in the user's responses...",
  "actions": ["Tip 1", "Tip 2", "Tip 3"]
}
`;

export const buildLegacyListeningScriptUserPrompt = (params: {
  taskTitle: string;
  activityType: "dialogue" | "monologue";
  scenario: string;
  targetBand: number;
  userLevel: number;
  accent: string;
}) => {
  return `Create an IELTS listening script for: "${params.taskTitle}".

Inputs:
- activityType: ${params.activityType}  // "dialogue" | "monologue"
- scenario: ${params.scenario}          // short label, e.g. "University Lecture", "Customer Support Call"
- targetBand: ${params.targetBand}      // learner goal
- userLevel: ${params.userLevel}        // current self-assessed level
- accent: ${params.accent}              // optional; can be set by plan if provided

Requirements:
- Pick ONE IELTS Listening Part format consistent with activityType (1 or 3 for dialogue; 2 or 4 for monologue)
- Topic domain must align with the scenario
- Language level appropriate for Band ${params.targetBand} learners (current level Band ${params.userLevel})
- Target spoken duration approximately 6 minutes (aim for 900–1,050 words, yielding 330–390 seconds spoken pace)
- Return JSON only per the system schema`;
};
