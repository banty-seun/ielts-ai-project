import OpenAI from "openai";
import { onboardingSchema, type TaskProgress, type Question, type QuestionOption } from "@shared/schema";
import type { ListeningSectionBlueprint } from "@shared/listening";
import { normalizeAccent } from "./utils/audio.ts";
import type { z } from "zod";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./services/listeningObservability";
import {
  buildLegacyListeningScriptUserPrompt,
  LEGACY_LISTENING_SCRIPT_SYSTEM_PROMPT_TEMPLATE,
  LISTENING_ADVISOR_SYSTEM_PROMPT_TEMPLATE,
  LISTENING_QUESTION_SYSTEM_PROMPT_TEMPLATE,
} from "./services/listeningPromptTemplates";
import {
  assertPromptVersionApprovedForProduction,
  resolvePromptTemplateForExecution,
} from "./services/listeningPromptRegistry";
import { isPrivacySafeLogMode, redactSensitive } from "./utils/privacy";

// Debug types for investigation
type DebugSlice = { head: string; tail: string; length: number };
const sliceForDebug = (s: string, n = 300): DebugSlice => ({
  head: s.slice(0, n),
  tail: s.slice(Math.max(0, s.length - n)),
  length: s.length,
});

const isProduction = process.env.NODE_ENV === "production";
const verboseLog = (...args: any[]) => {
  if (!isProduction) {
    if (isPrivacySafeLogMode()) {
      console.log(...args.map((arg) => redactSensitive(arg)));
      return;
    }
    console.log(...args);
  }
};

const safeErrorLog = (label: string, payload: unknown) => {
  if (isPrivacySafeLogMode()) {
    console.error(label, redactSensitive(payload));
    return;
  }
  console.error(label, payload);
};

interface PlanGenDebug {
  scenario: "A_full" | "B_reduced";
  model: string;
  temperature: number;
  maxTokens: number;
  finishReason: string;
  usage: any;
  rawSummary: DebugSlice;
  elapsedMs: number;
  parseOk: boolean;
  parseError?: { name: string; message: string; pos?: number; around?: string };
}

// Keep module imports test-safe: only require a real key in production.
const resolvedOpenAiApiKey =
  process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0
    ? process.env.OPENAI_API_KEY.trim()
    : process.env.NODE_ENV === "production"
      ? ""
      : "test-openai-key";

if (process.env.NODE_ENV === "production" && !resolvedOpenAiApiKey) {
  throw new Error("OPENAI_API_KEY is required in production");
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: resolvedOpenAiApiKey,
});

// Type for the onboarding data
type OnboardingData = z.infer<typeof onboardingSchema>;

// Function to generate a personalized IELTS study plan using OpenAI
export async function generateIELTSPlan(data: OnboardingData): Promise<any> {
  try {
    // Extract user's preferences for prompt
    const {
      fullName,
      targetBandScore,
      testDate,
      notDecided,
      skillRatings,
      immigrationGoal,
      studyPreferences,
    } = data;

    // Get first name for personalization
    const firstName = fullName.split(" ")[0];

    // Format test date or use default text
    const formattedTestDate = testDate
      ? new Date(testDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : notDecided
        ? "not yet decided"
        : "not specified";

    // Map immigration goal to readable text
    const immigrationGoalText =
      {
        pr: "Permanent Residence",
        study: "Study Permit",
        work: "Work Permit",
        family: "Family Sponsorship",
      }[immigrationGoal] || "Canadian immigration";

    // Map daily commitment to readable text
    const dailyCommitmentText =
      {
        "30mins": "30 minutes",
        "1hour": "1 hour",
        "2hours+": "2+ hours",
      }[studyPreferences.dailyCommitment] || "not specified";

    // Map schedule preference to readable text
    const scheduleText =
      {
        weekday: "weekdays",
        weekend: "weekends",
        both: "both weekdays and weekends",
      }[studyPreferences.schedule] || "not specified";

    // Map learning style to readable text
    const styleText =
      {
        "ai-guided": "AI-guided learning",
        "self-paced": "self-paced learning",
        mixed: "a mix of AI-guided and self-paced learning",
      }[studyPreferences.style] || "not specified";

    // Create the prompt for OpenAI
    const prompt = `
    Create a personalized 4-week IELTS preparation plan for ${firstName} who is preparing for the IELTS exam for Canadian ${immigrationGoalText}.

    User Profile:
    - Target IELTS Band Score: ${targetBandScore}
    - Test Date: ${formattedTestDate}
    - Current skill self-assessment:
      * Listening: ${skillRatings.listening}/9
      * Reading: ${skillRatings.reading}/9
      * Writing: ${skillRatings.writing}/9
      * Speaking: ${skillRatings.speaking}/9
    - Study Preferences:
      * Daily commitment: ${dailyCommitmentText}
      * Study schedule: ${scheduleText}
      * Learning style: ${styleText}

    Plan Requirements:
    1. The learner has committed to studying ${dailyCommitmentText} per day, on ${scheduleText} only. Generate a realistic IELTS study plan that respects this availability. Do not assign tasks on unavailable days. Keep each day's workload within ${dailyCommitmentText}.
    2. Create a structured 4-week study plan with daily activities
    3. Focus more heavily on skills with lower self-assessment scores
    4. For each week, specify:
       - Weekly goals
       - Daily practice activities for each IELTS component
       - Recommended resources and practice tests
       - Progress tracking metrics
    5. Include specific Canadian immigration context in examples and practice
    6. IMPORTANT: Respect the schedule preference "${scheduleText}":
       - If "weekdays": Only schedule activities Monday-Friday (days 1-5)
       - If "weekends": Only schedule activities Saturday-Sunday (days 6-7)  
       - If "both weekdays and weekends": Schedule across all 7 days
    7. Format the response as structured JSON with the following schema:
    {
      "weeklyPlans": [
        {
          "week": 1,
          "goals": ["goal1", "goal2", ...],
          "days": [
            {
              "day": 1,
              "dayType": "weekday|weekend",
              "activities": [
                {
                  "skill": "listening|reading|writing|speaking",
                  "title": "Activity title",
                  "description": "Activity description",
                  "duration": "30min",
                  "resources": ["resource1", "resource2", ...]
                }
              ]
            }
          ],
          "progressMetrics": ["metric1", "metric2", ...]
        }
      ],
      "generalTips": ["tip1", "tip2", ...],
      "recommendedResources": ["resource1", "resource2", ...]
    }
    `;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Using the latest model as of May 2024
      messages: [
        {
          role: "system",
          content:
            "You are an expert IELTS tutor with specialized knowledge of Canadian immigration requirements. Your task is to create personalized IELTS study plans.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });

    // Parse the JSON response
    const planText = response.choices[0].message.content;

    if (!planText) {
      throw new Error(
        "Failed to generate study plan: Empty response from OpenAI",
      );
    }

    // Parse and return the plan
    try {
      const planData = JSON.parse(planText);
      return planData;
    } catch (error) {
      console.error("Error parsing OpenAI JSON response:", error);
      throw new Error("Failed to parse the generated study plan");
    }
  } catch (error) {
    console.error("OpenAI API Error:", error);
    throw error;
  }
}

// Debug wrapper function for investigation
async function generateIELTSPlan_debugRun(
  scenario: "A_full" | "B_reduced",
  messages: any[],
): Promise<PlanGenDebug> {
  const startedAt = Date.now();
  const model = "gpt-4o";
  const temperature = 0;
  const maxTokens = 4000;

  try {
    const res = await openai.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages,
    });

    const finishReason = res.choices?.[0]?.finish_reason ?? "unknown";
    const usage = res.usage ?? {};
    const raw = res.choices?.[0]?.message?.content ?? "";
    const rawSummary = sliceForDebug(raw, 300);

    verboseLog(`[PlanGen][${scenario}][META]`, { finishReason, usage, elapsedMs: Date.now() - startedAt });
    verboseLog(`[PlanGen][${scenario}][RAW_START]`, rawSummary.head);
    verboseLog(`[PlanGen][${scenario}][RAW_END]`, rawSummary.tail);
    verboseLog(`[PlanGen][${scenario}][RAW_LEN]`, rawSummary.length);

    let parseOk = false;
    let parseError: PlanGenDebug["parseError"] | undefined;

    try {
      JSON.parse(raw); // schema validation still happens outside; this is parse-only logging
      parseOk = true;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      const m = /position (\d+)/i.exec(msg);
      let around: string | undefined;
      let pos: number | undefined;
      if (m) {
        pos = Number(m[1]);
        const start = Math.max(0, pos - 200);
        const end = Math.min(raw.length, pos + 200);
        around = raw.slice(start, end);
      }
      parseError = { name: String(err?.name ?? "Error"), message: msg, pos, around };
      console.error(`[PlanGen][${scenario}][PARSE_ERROR]`, parseError);
    }

    return {
      scenario,
      model,
      temperature,
      maxTokens,
      finishReason,
      usage,
      rawSummary,
      elapsedMs: Date.now() - startedAt,
      parseOk: parseOk,
      parseError,
    };
  } catch (openaiError: any) {
    // If OpenAI API call fails, capture error in debug format
    console.error(`[PlanGen][${scenario}][API_ERROR]`, openaiError?.message || openaiError);
    return {
      scenario,
      model,
      temperature,
      maxTokens,
      finishReason: "error",
      usage: {},
      rawSummary: { head: "", tail: "", length: 0 },
      elapsedMs: Date.now() - startedAt,
      parseOk: false,
      parseError: { 
        name: "OpenAI_API_Error", 
        message: openaiError?.message || "Unknown OpenAI API error" 
      },
    };
  }
}

export async function generateIELTSPlan_debugWrapper(data: OnboardingData): Promise<{ A: PlanGenDebug; B: PlanGenDebug }> {
  // Extract user's preferences for prompt (same as original function)
  const {
    fullName,
    targetBandScore,
    testDate,
    notDecided,
    skillRatings,
    immigrationGoal,
    studyPreferences,
  } = data;

  const firstName = fullName.split(" ")[0];
  const formattedTestDate = testDate
    ? new Date(testDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "not decided";

  const immigrationGoalText = immigrationGoal === "study" ? "study" : "immigration";
  const dailyCommitmentText =
    {
      "30mins": "30 minutes",
      "1hour": "1 hour",
      "2hours+": "2+ hours",
    }[studyPreferences.dailyCommitment] || "not specified";

  const scheduleText =
    {
      weekday: "weekdays",
      weekend: "weekends",
      both: "both weekdays and weekends",
    }[studyPreferences.schedule] || "not specified";

  const styleText =
    {
      "ai-guided": "AI-guided learning",
      "self-paced": "self-paced learning",
      mixed: "a mix of AI-guided and self-paced learning",
    }[studyPreferences.style] || "not specified";

  // A) Full prompt (existing behavior)
  const promptFull = `
    Create a personalized 4-week IELTS preparation plan for ${firstName} who is preparing for the IELTS exam for Canadian ${immigrationGoalText}.

    User Profile:
    - Target IELTS Band Score: ${targetBandScore}
    - Test Date: ${formattedTestDate}
    - Current skill self-assessment:
      * Listening: ${skillRatings.listening}/9
      * Reading: ${skillRatings.reading}/9
      * Writing: ${skillRatings.writing}/9
      * Speaking: ${skillRatings.speaking}/9
    - Study Preferences:
      * Daily commitment: ${dailyCommitmentText}
      * Study schedule: ${scheduleText}
      * Learning style: ${styleText}

    Plan Requirements:
    1. The learner has committed to studying ${dailyCommitmentText} per day, on ${scheduleText} only. Generate a realistic IELTS study plan that respects this availability. Do not assign tasks on unavailable days. Keep each day's workload within ${dailyCommitmentText}.
    2. Create a structured 4-week study plan with daily activities
    3. Focus more heavily on skills with lower self-assessment scores
    4. For each week, specify:
       - Weekly goals
       - Daily practice activities for each IELTS component
       - Recommended resources and practice tests
       - Progress tracking metrics
    5. Include specific Canadian immigration context in examples and practice
    6. IMPORTANT: Respect the schedule preference "${scheduleText}":
       - If "weekdays": Only schedule activities Monday-Friday (days 1-5)
       - If "weekends": Only schedule activities Saturday-Sunday (days 6-7)  
       - If "both weekdays and weekends": Schedule across all 7 days
    7. Format the response as structured JSON with the following schema:
    {
      "weeklyPlans": [
        {
          "week": 1,
          "goals": ["goal1", "goal2", ...],
          "days": [
            {
              "day": 1,
              "dayType": "weekday|weekend",
              "activities": [
                {
                  "skill": "listening|reading|writing|speaking",
                  "title": "Activity title",
                  "description": "Activity description",
                  "duration": "30min",
                  "resources": ["resource1", "resource2", ...]
                }
              ]
            }
          ],
          "progressMetrics": ["metric1", "metric2", ...]
        }
      ],
      "generalTips": ["tip1", "tip2", ...],
      "recommendedResources": ["resource1", "resource2", ...]
    }
    `;

  const messagesFull = [
    {
      role: "system",
      content: "You are an expert IELTS tutor with specialized knowledge of Canadian immigration requirements. Your task is to create personalized IELTS study plans.",
    },
    {
      role: "user",
      content: promptFull,
    },
  ];

  // B) Reduced scope prompt (Week 1 only)
  const promptReduced = `
    Create a personalized Week 1 ONLY IELTS preparation plan for ${firstName} who is preparing for the IELTS exam for Canadian ${immigrationGoalText}.

    User Profile:
    - Target IELTS Band Score: ${targetBandScore}
    - Test Date: ${formattedTestDate}
    - Current skill self-assessment:
      * Listening: ${skillRatings.listening}/9
      * Reading: ${skillRatings.reading}/9
      * Writing: ${skillRatings.writing}/9
      * Speaking: ${skillRatings.speaking}/9
    - Study Preferences:
      * Daily commitment: ${dailyCommitmentText}
      * Study schedule: ${scheduleText}
      * Learning style: ${styleText}

    Plan Requirements:
    1. Create ONLY Week 1 of the study plan
    2. Respect the schedule preference "${scheduleText}"
    3. Focus on foundational IELTS skills assessment
    4. Format the response as structured JSON with this schema:
    {
      "week": 1,
      "goals": ["goal1", "goal2", ...],
      "days": [
        {
          "day": 1,
          "dayType": "weekday|weekend",
          "activities": [
            {
              "skill": "listening|reading|writing|speaking",
              "title": "Activity title",
              "description": "Activity description",
              "duration": "30min",
              "resources": ["resource1", "resource2", ...]
            }
          ]
        }
      ],
      "progressMetrics": ["metric1", "metric2", ...]
    }
    `;

  const messagesReduced = [
    {
      role: "system",
      content: "You are an expert IELTS tutor with specialized knowledge of Canadian immigration requirements. Your task is to create personalized IELTS study plans.",
    },
    {
      role: "user",
      content: promptReduced,
    },
  ];

  // Run both scenarios and ensure no errors escape
  try {
    const A = await generateIELTSPlan_debugRun("A_full", messagesFull);
    const B = await generateIELTSPlan_debugRun("B_reduced", messagesReduced);

    verboseLog("[PlanGen][WRAPPER_REPORT]", { A, B });
    return { A, B };
  } catch (wrapperError: any) {
    // Fallback if something catastrophic happens
    console.error("[PlanGen][WRAPPER_ERROR]", wrapperError?.message || wrapperError);
    const errorDebug: PlanGenDebug = {
      scenario: "A_full",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 4000,
      finishReason: "wrapper_error",
      usage: {},
      rawSummary: { head: "", tail: "", length: 0 },
      elapsedMs: 0,
      parseOk: false,
      parseError: { 
        name: "Wrapper_Error", 
        message: wrapperError?.message || "Unknown wrapper error" 
      },
    };
    return { 
      A: errorDebug, 
      B: { ...errorDebug, scenario: "B_reduced" }
    };
  }
}

// Define interface for the formatted user data
interface FormattedUserData {
  name: string;
  targetScore: string;
  currentSkillLevels: {
    Listening: number;
    Reading: number;
    Writing: number;
    Speaking: number;
  };
  studyCommitment: string;
  testDate: string;
  weekNumber?: number; // Added weekNumber parameter
}

// Define interface for the expected response structure
interface ListeningStudyPlan {
  weekFocus: string;
  plan: Array<{
    title: string;
    skill: string;
    day: string;
    duration: string;
    status: string;
  }>;
}

// Extended OnboardingData with optional weekNumber parameter
interface WeeklyPlanRequestData extends OnboardingData {
  weekNumber?: number;
}



// Function to generate IELTS listening questions from script text
export async function generateQuestionsFromScript(
  scriptText: string,
  taskTitle: string,
  difficulty: string = "intermediate"
): Promise<{
  success: boolean;
  questions?: Question[];
  prompt?: {
    prompt_id: string;
    version: string;
    prompt_registry_id: string;
    model_id: string;
  };
  error?: string;
}> {
  try {
    // Validate inputs
    if (!scriptText || scriptText.trim().length === 0) {
      return {
        success: false,
        error: "Script text is required for question generation"
      };
    }

    if (!taskTitle) {
      return {
        success: false,
        error: "Task title is required for question generation"
      };
    }

    const promptResolved = await resolvePromptTemplateForExecution({
      promptId: "listening.question.generation",
      userId: "question-generator",
      sectionId: taskTitle,
    });
    await assertPromptVersionApprovedForProduction({
      promptId: promptResolved.selected.prompt_id,
      version: promptResolved.selected.version,
    });
    const templatePrompt = (promptResolved.selected.template || LISTENING_QUESTION_SYSTEM_PROMPT_TEMPLATE).replace(
      "{{difficulty}}",
      difficulty,
    );

    // Create the system prompt for IELTS question generation
    const systemPrompt = templatePrompt;

    const userPrompt = `Task: ${taskTitle}

Script text:
${scriptText}

Generate exactly 10 IELTS listening comprehension questions for this script. Each question must be multiple-choice with four options labelled A, B, C, and D, and include the answer key plus explanation.`;

    verboseLog(`[Question Generation] Generating questions for "${taskTitle}":`, {
      scriptLength: scriptText.length,
      difficulty,
      wordCount: scriptText.split(/\s+/).length
    });

    // Generate questions using GPT-4o Mini
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Use GPT-4o Mini for cost efficiency
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      max_tokens: 1500, // Increased for multiple questions
      temperature: 0.7, // Balanced creativity and consistency
      response_format: { type: "json_object" }, // Ensure JSON response
    });

    const responseContent = response.choices[0]?.message?.content?.trim();

    if (!responseContent) {
      return {
        success: false,
        error: "OpenAI returned empty response for question generation"
      };
    }

    try {
      // Parse the JSON response
      const parsedResponse = JSON.parse(responseContent);
      const questions = parsedResponse.questions;

      if (!Array.isArray(questions) || questions.length === 0) {
        return {
          success: false,
          error: "No questions found in OpenAI response"
        };
      }

      // Validate question structure and convert options to required format
      const validatedQuestions: Question[] = questions.map((q: any, index: number) => ({
        id: q.id || `q${index + 1}`,
        question: q.question || '',
        options: Array.isArray(q.options) ? q.options.map((option: string, optIndex: number) => ({
          id: `option${optIndex + 1}`,
          text: option
        })) : [],
        correctAnswer: q.correctAnswer || '',
        explanation: q.explanation || '',
        tags: Array.isArray(q.tags) ? q.tags.slice(0, 3) : undefined,
      })).filter((q: Question) => 
        q.question && 
        q.options && 
        q.options.length === 4 && 
        q.correctAnswer && 
        q.explanation
      );

      if (validatedQuestions.length === 0) {
        return {
          success: false,
          error: "No valid questions found after validation"
        };
      }

      verboseLog(`[Question Generation] Generated ${validatedQuestions.length} questions for "${taskTitle}"`);

      return {
        success: true,
        questions: validatedQuestions,
        prompt: {
          prompt_id: promptResolved.selected.prompt_id,
          version: promptResolved.selected.version,
          prompt_registry_id: `${promptResolved.selected.prompt_id}@${promptResolved.selected.version}`,
          model_id: promptResolved.selected.model_id,
        },
      };

    } catch (parseError) {
      console.error("[Question Generation] Failed to parse JSON response:", parseError);
      safeErrorLog("[Question Generation] Parse failure payload", {
        responseLength: responseContent.length,
      });
      
      return {
        success: false,
        error: "Failed to parse question generation response"
      };
    }

  } catch (error: any) {
    console.error("[Question Generation] OpenAI API error:", error);
    return {
      success: false,
      error: error.message || "Failed to generate questions"
    };
  }
}

// Function to generate a listening-focused study plan
export async function generateListeningStudyPlan(
  data: WeeklyPlanRequestData,
): Promise<ListeningStudyPlan | { success: false; reason: string; details?: any }> {
  const weekRef = String(data.weekNumber ?? 1);
  const planSpan = startListeningStageSpan({
    stage: "plan_selected",
    context: createTelemetryContext({
      traceId: `trc_plan_${weekRef}`,
      requestId: `req_plan_${weekRef}`,
      userId: null,
      weeklyPlanId: weekRef,
      sessionId: null,
      sectionId: null,
      partId: null,
      agentName: "tutor_agent",
    }),
  });
  let planSuccess = false;
  let planActivities = 0;
  let planErrorClass: string | null = null;
  try {
    // Extract user's preferences for prompt
    const {
      fullName,
      targetBandScore,
      testDate,
      notDecided,
      skillRatings,
      immigrationGoal,
      studyPreferences,
    } = data;

    // Get first name for personalization
    const firstName = fullName.split(" ")[0];

    // Format test date or use default text
    const formattedTestDate = testDate
      ? new Date(testDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : notDecided
        ? "not yet decided"
        : "not specified";

    // Map daily commitment to readable text
    const dailyCommitmentText =
      {
        "30mins": "30 minutes",
        "1hour": "1 hour",
        "2hours+": "2+ hours",
      }[studyPreferences.dailyCommitment] || "not specified";

    // Extract week number or default to week 1
    const weekNumber = data.weekNumber || 1;
    
    // Format the user data for the AI
    const formattedUserData: FormattedUserData = {
      name: firstName,
      targetScore: targetBandScore.toString(),
      currentSkillLevels: {
        Listening: skillRatings.listening,
        Reading: skillRatings.reading,
        Writing: skillRatings.writing,
        Speaking: skillRatings.speaking,
      },
      studyCommitment: dailyCommitmentText,
      testDate: formattedTestDate,
      weekNumber: weekNumber, // Include the week number in the data for the AI
    };

    // Convert formatted data to JSON string for the AI
    const formattedDataString = `Please generate a JSON response with a 5-day listening plan based on this user data: ${JSON.stringify(formattedUserData, null, 2)}`;

    // Define the system prompt for listening-focused plan based on week number
    let weekFocusDescription;
    
    // Customize the focus description based on the week number
    switch (weekNumber) {
      case 1:
        weekFocusDescription = "building foundational listening skills using IELTS Listening exam formats";
        break;
      case 2:
        weekFocusDescription = "developing note-taking strategies and improving comprehension of academic contexts";
        break;
      case 3:
        weekFocusDescription = "distinguishing specific information and understanding speaker attitudes in various accents";
        break;
      case 4:
        weekFocusDescription = "understanding complex conversations with multiple speakers and implied meanings";
        break;
      case 5:
        weekFocusDescription = "mastering challenging academic lectures and technical vocabulary";
        break;
      case 6:
        weekFocusDescription = "integrating all listening skills and practicing with full IELTS test conditions";
        break;
      default:
        weekFocusDescription = "building foundational listening skills using IELTS Listening exam formats";
    }
    
    const systemPrompt = `You are an AI Learning Experience Designer for an IELTS preparation platform focused on Canadian immigration. Your job is to generate a personalized weekly study plan focused exclusively on Listening skills. The plan should be based on user onboarding data (e.g., target score, time to test, current skill level, study time, learning style), and structured to be delivered over 5 days.

This is Week ${weekNumber} of the user's preparation journey. Your plan must prioritize ${weekFocusDescription}, including:
- Everyday social contexts (e.g., conversations like office dialogues, service calls)
- Monologues (e.g., announcements, recorded guides)
- Educational settings (e.g., classroom conversations, academic lectures)
- Emphasize exposure to diverse accents including: British, Canadian, Australian, American, and NewZealand.

✅ IMPORTANT: Task Title Format
The title MUST follow this exact pattern: "{Test Type}: {Scenario}"

Test Types by IELTS Part:
- Part 1: "Conversation" (two people in everyday social context, 6-7 min)
- Part 2: "Monologue" (one person in everyday social context, 6 min)
- Part 3: "Academic Discussion" (2-4 people in educational/training context, 6-7 min)
- Part 4: "Academic Lecture" (one speaker in academic context, 6 min)

Examples of correct titles:
- "Conversation: Booking a hotel room"
- "Monologue: Museum tour guide"
- "Academic Discussion: Students planning a research project"
- "Academic Lecture: Climate change impacts"

✅ Each day should contain 1 Listening task with:
- testType: "Conversation" | "Monologue" | "Academic Discussion" | "Academic Lecture"
- scenario: Brief scenario description (3-6 words) for the title
- ieltsPart: 1 | 2 | 3 | 4 (matching the test type)
- activityType: "dialogue" or "monologue" (Parts 1 & 3 are dialogues, Parts 2 & 4 are monologues)
- dayDurationMinutes: the exact number of minutes the user committed for that day based on onboarding (weekday/weekend rules)
- audioDurationMinutes: always set to 6 (each audio clip should target ~6:00 runtime)
- description: Brief task description focusing on skills practiced
- accent: "British" | "Canadian" | "Australian" | "American" | "NewZealand"

Format your response as a JSON array of 5 items, one for each day. Each item must include:
{
  "testType": "Conversation | Monologue | Academic Discussion | Academic Lecture",
  "scenario": "Brief scenario (3-6 words)",
  "ieltsPart": 1 | 2 | 3 | 4,
  "activityType": "dialogue | monologue",
  "description": "Brief task description focusing on skills",
  "dayDurationMinutes": number,
  "audioDurationMinutes": 6,
  "accent": "British | Canadian | Australian | American | NewZealand"
}

Rules:
- Respect availability: Only schedule on available days; durations must match the user's onboarding selection for weekday/weekend.
- The UI will construct the title as "{testType}: {scenario}" automatically.
- No Reading, Writing, or Speaking practice in this prompt.
- JSON only. No extra text.`;

    // Log the prompt for debugging
    verboseLog("OpenAI Prompt Details:");
    verboseLog("- System Prompt Length:", systemPrompt.length);
    verboseLog("- User Data Length:", formattedDataString.length);
    verboseLog("- API key configured:", Boolean(process.env.OPENAI_API_KEY));
    verboseLog("- Formatted User Data:", formattedUserData);

    // Call OpenAI API with better error handling
    try {
      verboseLog("Calling OpenAI API to generate Listening study plan...");
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: formattedDataString,
          },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 2000,
      });

      // Parse the JSON response
      const planText = response.choices[0].message.content;
      verboseLog("Received response from OpenAI");
      
      // Log token usage for monitoring
      verboseLog("OpenAI Token Usage:", {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      });

      if (!planText) {
        console.error("Empty response from OpenAI");
        return {
          success: false,
          reason: "GPT-4o returned an empty response",
          details: { response }
        };
      }

      // Parse and return the plan
      try {
        // Parse the response into an object
        const planData = JSON.parse(planText);
        verboseLog(
          "Raw OpenAI response structure:",
          JSON.stringify(planData, null, 2),
        );

        // Generate a week focus based on the week number
        let defaultWeekFocus;
        switch (weekNumber) {
          case 1:
            defaultWeekFocus = "Foundational listening skills with diverse accents";
            break;
          case 2:
            defaultWeekFocus = "Note-taking strategies for academic contexts";
            break;
          case 3:
            defaultWeekFocus = "Understanding speaker attitudes across different accents";
            break;
          case 4:
            defaultWeekFocus = "Complex conversations and implied meanings";
            break;
          case 5:
            defaultWeekFocus = "Academic lectures and technical vocabulary";
            break;
          case 6:
            defaultWeekFocus = "Full IELTS test practice and skill integration";
            break;
          default:
            defaultWeekFocus = "Foundational listening skills with diverse accents";
        }

        // Create a properly formatted plan array
        let planArray = [];

        // Check different possible structures the AI might have returned
        if (Array.isArray(planData)) {
          // Direct array structure
          planArray = planData.map((item: any, index: number) => {
            // Use testType and scenario to construct the title
            const testType = item.testType || "Conversation";
            const scenario = item.scenario || "Listening Practice";
            const formattedTitle = `${testType}: ${scenario}`;

            return {
              title: formattedTitle,
              testType: testType,
              scenario: scenario,
              ieltsPart: item.ieltsPart || (item.activityType === "monologue" ? 2 : 1),
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              dayNumber: index + 1,
              duration: `${item.audioDurationMinutes || 6} min`,
              status: "not_started",
              accent: item.accent || "British",
              description: item.description || "",
              activityType: item.activityType || "dialogue"
            };
          });
        } else if (planData.plan && Array.isArray(planData.plan)) {
          // Object with plan array
          planArray = planData.plan.map((item: any, index: number) => {
            const testType = item.testType || "Conversation";
            const scenario = item.scenario || "Listening Practice";
            const formattedTitle = `${testType}: ${scenario}`;

            return {
              title: formattedTitle,
              testType: testType,
              scenario: scenario,
              ieltsPart: item.ieltsPart || (item.activityType === "monologue" ? 2 : 1),
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              dayNumber: index + 1,
              duration: `${item.audioDurationMinutes || 6} min`,
              status: "not_started",
              accent: item.accent || "British",
              description: item.taskDescription || item.description || "",
              activityType: item.activityType || "dialogue"
            };
          });
        } else if (planData.weeklyPlan && Array.isArray(planData.weeklyPlan)) {
          // Object with weeklyPlan array
          planArray = planData.weeklyPlan.map((item: any, index: number) => {
            const testType = item.testType || "Conversation";
            const scenario = item.scenario || "Listening Practice";
            const formattedTitle = `${testType}: ${scenario}`;

            return {
              title: formattedTitle,
              testType: testType,
              scenario: scenario,
              ieltsPart: item.ieltsPart || (item.activityType === "monologue" ? 2 : 1),
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              dayNumber: index + 1,
              duration: `${item.audioDurationMinutes || 6} min`,
              status: "not_started",
              accent: item.accent || "British",
              description: item.taskDescription || item.description || "",
              activityType: item.activityType || "dialogue"
            };
          });
        } else if (planData.days && Array.isArray(planData.days)) {
          // Object with days array
          planArray = planData.days.map((item: any, index: number) => {
            const testType = item.testType || "Conversation";
            const scenario = item.scenario || "Listening Practice";
            const formattedTitle = `${testType}: ${scenario}`;

            return {
              title: formattedTitle,
              testType: testType,
              scenario: scenario,
              ieltsPart: item.ieltsPart || (item.activityType === "monologue" ? 2 : 1),
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              dayNumber: index + 1,
              duration: `${item.audioDurationMinutes || 6} min`,
              status: "not_started",
              accent: item.accent || "British",
              description: item.taskDescription || item.description || "",
              activityType: item.activityType || "dialogue"
            };
          });
        } else if (
          planData.listeningPlan &&
          Array.isArray(planData.listeningPlan)
        ) {
          // OpenAI response with listeningPlan array
          planArray = planData.listeningPlan.map((item: any, index: number) => ({
            title: item.taskTitle || item.title || `Listening Practice ${index + 1}`,
            skill: "Listening",
            day:
              ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] ||
              `Day ${index + 1}`,
            duration: item.duration || "30 min",
            status: "not_started",
            accent: item.accent || "",
            description: item.taskDescription || item.description || "",
            contextType: item.contextType || "",
          }));
        } else if (planData.studyPlan && Array.isArray(planData.studyPlan)) {
          // OpenAI response with studyPlan array
          planArray = planData.studyPlan.map((item: any, index: number) => ({
            title: item.taskTitle || item.title || `Listening Practice ${index + 1}`,
            skill: "Listening",
            day:
              ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] ||
              `Day ${index + 1}`,
            duration: item.duration || "30 min",
            status: "not_started",
            accent: item.accent || "",
            description: item.taskDescription || item.description || "",
            contextType: item.contextType || "",
          }));
        } else {
          // If no recognizable structure, create default tasks for the week
          const weekdays = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
          ];
          const activities = [
            "Office Conversation Practice",
            "Academic Lecture Comprehension",
            "Public Announcement Exercise",
            "Service Interaction Listening",
            "Multi-speaker Discussion Practice",
          ];
          const accents = [
            "British",
            "Canadian",
            "Australian",
            "American",
            "NewZealand",
          ];

          planArray = weekdays.map((day, index) => ({
            title: `Listening: ${activities[index]}`,
            skill: "Listening",
            day: day,
            duration: "45 min",
            status: "not_started",
            accent: accents[index],
            description: `Practice with ${accents[index]} accent in a ${index % 2 === 0 ? "conversational" : "academic"} context.`,
          }));
        }

        // Format it into our expected structure
        const studyPlan: ListeningStudyPlan = {
          weekFocus: planData.weekFocus || defaultWeekFocus,
          plan: planArray,
        };
        planSuccess = true;
        planActivities = planArray.length;

        verboseLog(
          "Successfully processed listening study plan with",
          planArray.length,
          "activities",
        );
        return studyPlan;
      } catch (parseError) {
        planErrorClass = "PLAN_PARSE_ERROR";
        console.error("Error parsing OpenAI JSON response:", parseError);
        safeErrorLog("Plan generation parse failure payload", {
          responseLength: planText.length,
        });
        return {
          success: false,
          reason: "Failed to parse the generated listening study plan",
          details: {
            error: parseError,
            rawResponseLength: planText.length,
          }
        };
      }
    } catch (openaiError: any) {
      planErrorClass = "PLAN_OPENAI_ERROR";
      safeErrorLog("OpenAI API Error", openaiError);
      // Detailed OpenAI error logging
      const errorDetails = {
        message: openaiError.message,
        type: openaiError.type,
        code: openaiError.code,
        statusCode: openaiError.status,
        responseData: openaiError.response?.data,
      };
      
      safeErrorLog("OpenAI Error Details", errorDetails);
      
      return {
        success: false,
        reason: "GPT-4o API error",
        details: errorDetails
      };
    }
  } catch (generalError) {
    planErrorClass = "PLAN_UNKNOWN_ERROR";
    console.error("General error in generateListeningStudyPlan:", generalError);
    return {
      success: false,
      reason: "Unexpected error while generating listening study plan",
      details: generalError
    };
  } finally {
    await finishListeningStageSpan(planSpan, {
      success: planSuccess,
      errorClass: planSuccess ? null : planErrorClass ?? "PLAN_GENERATION_FAILED",
      metadata: {
        activities: planActivities,
        week: weekRef,
      },
    });
  }
}

/**
 * Generate an IELTS listening script for a specific task using GPT-4o Mini
 * @param task - TaskProgress object containing task details
 * @param userLevel - User's current skill level (from onboarding)
 * @param targetBand - Target band score (from onboarding)
 * @returns Generated script content
 */
// IELTS Script System Prompt for dynamic, part-free titles
export const IELTS_SCRIPT_SYSTEM_PROMPT = LEGACY_LISTENING_SCRIPT_SYSTEM_PROMPT_TEMPLATE;

export const LISTENING_SESSION_PACKAGE_SYSTEM = `
You are an IELTS Listening tutor. Generate a package of listening practice items for a single session.

Goal:
- Produce a batch of audios (prefetchCount provided by the user prompt) that all match the same activityType and scenario.
- Each audio must include: a realistic script JSON (per IELTS script schema) and a 10-question MCQ set with answers.

Inputs (provided in user message):
- activityType: "dialogue" | "monologue"
- scenario: short label ("University Lecture", "Office Dialogue", etc.)
- sessionDurationMinutes: integer (total time available for this session)
- targetBand: integer (goal)
- userLevel: integer (current)
- accent: "British" | "Canadian" | "Australian" | "American" | "NewZealand" (optional; choose if not provided)

Constraints:
- You MUST generate exactly the number of audios requested in the user prompt.
- All audios in this package must use the SAME activityType and scenario family (topics vary but stay within the scenario/domain).
- Every audio must be distinct: no repeated scripts, contextLabels, question sets, or recycled storylines. contextLabel values must be unique.
- Each audio MUST target a spoken duration of 6 minutes (≈360 seconds). Allow slight variation 330–390 seconds to feel natural.
- Total estimated audio time should stay within sessionDurationMinutes minus a small buffer (~2 minutes) for reading questions.
- Each audio MUST have exactly 10 MCQs (A–D) with correctAnswer and explanation.

Return JSON only in this exact shape:
{
  "session": {
    "title": "Type: Scenario",
    "activityType": "dialogue" | "monologue",
    "scenario": "short label",
    "sessionDurationMinutes": number,
    "estimatedTotalAudioSec": number
  },
  "audios": [
    {
      "index": 1,
      "script": {
        "script": "Full script text",
        "scriptType": "dialogue" | "monologue",
        "topicDomain": "e.g., 'Classroom' | 'Office' | 'Service Call'",
        "contextLabel": "short title",
        "scenarioOverview": "1–2 sentence summary",
        "accent": "British" | "American" | "Canadian" | "Australian" | "NewZealand",
        "estimatedDurationSec": number,
        "ieltsPart": 1 | 2 | 3 | 4
      },
      "questions": [
        {
          "id": "q1",
          "question": "…",
          "options": ["A", "B", "C", "D"],
          "correctAnswer": "A",
          "explanation": "…"
        }
      ]
    }
  ]
}
No commentary. JSON only.
`;

export const buildSessionPackageUserPrompt = ({
  activityType,
  scenario,
  sessionDurationMinutes,
  targetBand,
  userLevel,
  accent,
  count = 4,
  excludeLabels = [],
}: {
  activityType: "dialogue" | "monologue";
  scenario: string;
  sessionDurationMinutes: number;
  targetBand: number;
  userLevel: number;
  accent?: string;
  count?: number;
  excludeLabels?: string[];
}) => `
Create a listening session package with prefetchCount=${count}.

Inputs:
- activityType: ${activityType}
- scenario: ${scenario}
- sessionDurationMinutes: ${sessionDurationMinutes}
- targetBand: ${targetBand}
- userLevel: ${userLevel}
- accent: ${accent ?? "auto-select"}

Requirements:
- SAME activityType and scenario across all audios
- Generate exactly ${count} distinct audios. Each audio must have a unique contextLabel and a unique script plus question set.
- Vary subtopics, participants, and specific details while staying within the scenario family.
${excludeLabels && excludeLabels.length > 0 ? `- Do NOT reuse any of these contextLabel themes: ${excludeLabels.join(", ")}` : ""}
- Each audio: target 6-minute spoken script (~900–1050 words, 330–390 seconds) + exactly 10 MCQs (A–D) with answers and explanations
- Keep cumulative estimated audio time within sessionDurationMinutes - 2 minutes
- JSON only per system schema
`;

export interface ListeningSessionPackageParams {
  activityType: "dialogue" | "monologue";
  scenario: string;
  sessionDurationMinutes: number;
  targetBand: number;
  userLevel: number;
  accent?: string;
  prefetchCount?: number;
}

export interface ListeningSessionPackageQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface ListeningSessionPackageAudio {
  index: number;
  script: {
    script: string;
    scriptType: "dialogue" | "monologue";
    topicDomain?: string;
    contextLabel?: string;
    scenarioOverview?: string;
    accent: "British" | "Canadian" | "Australian" | "American" | "NewZealand";
    estimatedDurationSec?: number;
    ieltsPart?: 1 | 2 | 3 | 4;
  };
  questions: ListeningSessionPackageQuestion[];
}

export interface ListeningSessionPackage {
  session: {
    title: string;
    activityType: "dialogue" | "monologue";
    scenario: string;
    sessionDurationMinutes: number;
    estimatedTotalAudioSec: number;
    accent: "British" | "Canadian" | "Australian" | "American" | "NewZealand";
  };
  audios: ListeningSessionPackageAudio[];
}

const ensureArray = <T>(value: any, fallback: T[]): T[] => (Array.isArray(value) ? value : fallback);

export async function generateListeningSessionPackage(
  params: ListeningSessionPackageParams,
): Promise<ListeningSessionPackage> {
  const normalizedAccent = params.accent ? normalizeAccent(params.accent) : undefined;
  const targetPrefetchCount = params.prefetchCount ?? 4;

  const systemPrompt = LISTENING_SESSION_PACKAGE_SYSTEM;

  const requestPackage = async (
    count: number,
    attempt: number,
    excludeLabels: string[],
  ) => {
    const userPrompt = buildSessionPackageUserPrompt({
      ...params,
      accent: normalizedAccent,
      count,
      excludeLabels,
    });

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: attempt > 1
            ? `${userPrompt}\n\nReminder: Provide ${count} new, distinct audios. Avoid any previously supplied scripts, contextLabels, or questions.`
            : userPrompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 6000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("OpenAI returned empty session package response");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      safeErrorLog("[Session Package] Failed to parse JSON response", {
        responseLength: content.length,
      });
      throw new Error("Failed to parse session package response");
    }

    const accentFromResponse = normalizedAccent ?? normalizeAccent(parsed?.session?.accent);
    const audiosRaw = ensureArray(parsed?.audios, []);

    return {
      accent: accentFromResponse,
      audiosRaw,
    };
  };

  const activityType = params.activityType;
  const scenario = params.scenario.trim();
  const sessionDurationMinutes = params.sessionDurationMinutes;

  const uniqueAudios: ListeningSessionPackageAudio[] = [];
  const seenScripts = new Set<string>();
  const seenContextLabels = new Set<string>();
  const seenContextLabelsRaw = new Set<string>();

  let resolvedAccent = normalizedAccent ?? "British";
  const MAX_ATTEMPTS = 3;

  const normalizeAudio = (
    audio: any,
    accent: string,
  ): ListeningSessionPackageAudio | null => {
    const script = audio?.script ?? {};
    const scriptText = typeof script?.script === "string" ? script.script.trim() : "";
    if (!scriptText) {
      return null;
    }

    const signature = scriptText.toLowerCase();
    if (seenScripts.has(signature)) {
      return null;
    }

    const contextLabelRaw = typeof script?.contextLabel === "string" ? script.contextLabel.trim() : undefined;
    const contextKey = contextLabelRaw ? contextLabelRaw.toLowerCase() : undefined;
    if (contextKey && seenContextLabels.has(contextKey)) {
      return null;
    }

    const scriptAccent = normalizeAccent(script?.accent ?? accent);
    const scriptType =
      activityType === "dialogue" ? ("dialogue" as const) : ("monologue" as const);

    const questionsRaw = ensureArray(audio?.questions, []);
    const normalizedQuestions = questionsRaw.slice(0, 10);
    const questions: ListeningSessionPackageQuestion[] = normalizedQuestions
      .map((q: any, qIdx: number) => ({
        id: typeof q?.id === "string" ? q.id : `q${qIdx + 1}`,
        question: typeof q?.question === "string" ? q.question : "",
        options: ensureArray(q?.options, []).slice(0, 4).map((opt: any) => String(opt)),
        correctAnswer: typeof q?.correctAnswer === "string" ? q.correctAnswer : "",
        explanation: typeof q?.explanation === "string" ? q.explanation : "",
      }))
      .filter((q) => q.question.trim().length > 0);

    if (!questions.length) {
      return null;
    }

    const estimatedSecRaw = typeof script?.estimatedDurationSec === "number"
      ? script.estimatedDurationSec
      : 360;
    const estimatedSec = Math.max(330, Math.min(390, Math.round(estimatedSecRaw)));

    seenScripts.add(signature);
    if (contextKey) {
      seenContextLabels.add(contextKey);
      seenContextLabelsRaw.add(contextLabelRaw!);
    }

    return {
      index: uniqueAudios.length + 1,
      script: {
        script: scriptText,
        scriptType: script?.scriptType === "monologue" ? "monologue" : scriptType,
        topicDomain: typeof script?.topicDomain === "string" ? script.topicDomain : undefined,
        contextLabel: contextLabelRaw,
        scenarioOverview:
          typeof script?.scenarioOverview === "string" ? script.scenarioOverview : undefined,
        accent: scriptAccent,
        estimatedDurationSec: estimatedSec,
        ieltsPart:
          script?.ieltsPart === 1 || script?.ieltsPart === 2 || script?.ieltsPart === 3 || script?.ieltsPart === 4
            ? script.ieltsPart
            : undefined,
      },
      questions,
    };
  };

  let attempt = 0;
  while (uniqueAudios.length < targetPrefetchCount && attempt < MAX_ATTEMPTS) {
    attempt += 1;
    const remaining = targetPrefetchCount - uniqueAudios.length;
    const excludeLabels = Array.from(seenContextLabelsRaw.values());
    const { accent, audiosRaw } = await requestPackage(remaining, attempt, excludeLabels);
    resolvedAccent = accent;

    audiosRaw.forEach((audio: any) => {
      const normalized = normalizeAudio(audio, accent);
      if (normalized) {
        uniqueAudios.push(normalized);
      }
    });
  }

  if (uniqueAudios.length === 0) {
    throw new Error("Session package did not include any audio items");
  }

  const audios = uniqueAudios
    .slice(0, targetPrefetchCount)
    .map((audio, idx) => ({
      ...audio,
      index: idx + 1,
    }));

  const estimatedTotalAudioSec = audios.reduce((total, audio) => {
    const duration = audio.script.estimatedDurationSec;
    return total + (typeof duration === "number" ? duration : 0);
  }, 0);

  const title = `${activityType.charAt(0).toUpperCase()}${activityType.slice(1)}: ${scenario}`;

  return {
    session: {
      title,
      activityType,
      scenario,
      sessionDurationMinutes,
      estimatedTotalAudioSec,
      accent: resolvedAccent,
    },
    audios,
  };
}

/**
 * Generate concise, actionable feedback for a single audio after learner completes 10 questions
 * Spec: Per-audio AI Study Advisor - provides score, grounded summary, and 3 imperative tips
 */
export async function generateAdvisorFeedback(params: {
  audioIndex: number;
  questions: Array<{
    id: string;
    question: string;
    correctAnswer: string;
    selectedAnswer: string | null;
  }>;
  scriptExcerpt?: string;
}): Promise<{
  success: boolean;
  scoreText?: string;
  summary?: string;
  actions?: string[];
  prompt?: {
    prompt_id: string;
    version: string;
    prompt_registry_id: string;
    model_id: string;
  };
  error?: string;
}> {
  try {
    const { audioIndex, questions, scriptExcerpt } = params;

    // Calculate score
    const correct = questions.filter(q => q.selectedAnswer === q.correctAnswer).length;
    const total = questions.length;
    const scoreText = `${correct}/${total}`;

    const promptResolved = await resolvePromptTemplateForExecution({
      promptId: "listening.coaching.advisor",
      userId: "coach-advisor",
      sectionId: `audio-${audioIndex + 1}`,
    });
    await assertPromptVersionApprovedForProduction({
      promptId: promptResolved.selected.prompt_id,
      version: promptResolved.selected.version,
    });

    // Build the system prompt (concise, actionable)
    const systemPrompt = promptResolved.selected.template || LISTENING_ADVISOR_SYSTEM_PROMPT_TEMPLATE;

    // Build user prompt with question details
    const incorrectQuestions = questions
      .map((q, idx) => ({
        ...q,
        qNumber: idx + 1,
        isCorrect: q.selectedAnswer === q.correctAnswer
      }))
      .filter(q => !q.isCorrect);

    const userPrompt = `Audio ${audioIndex + 1} - Score: ${scoreText}

Questions (10 total):
${questions.map((q, idx) => `Q${idx + 1}: ${q.question}
  Correct: ${q.correctAnswer}
  Selected: ${q.selectedAnswer || 'Not answered'}
  ${q.selectedAnswer === q.correctAnswer ? '✓ Correct' : '✗ Incorrect'}`).join('\n\n')}

${scriptExcerpt ? `\nScript excerpt:\n${scriptExcerpt.substring(0, 500)}...` : ''}

Provide:
1. A grounded summary (120-180 words) referencing specific question numbers where errors occurred and patterns observed.
2. Exactly 3 actionable tips the learner can apply on the next audio.`;

    verboseLog('[Advisor Feedback] Generating for audio', audioIndex, 'Score:', scoreText);

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-effective for feedback
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 400, // Enough for 180 words + 3 tips
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (!content) {
      return {
        success: false,
        error: 'Empty response from OpenAI advisor'
      };
    }

    try {
      const parsed = JSON.parse(content);

      // Validate response structure
      if (!parsed.summary || !Array.isArray(parsed.actions)) {
        return {
          success: false,
          error: 'Invalid advisor response structure'
        };
      }

      // Validate actions count
      if (parsed.actions.length !== 3) {
        verboseLog('[Advisor Feedback] Warning: Expected 3 actions, got', parsed.actions.length);
      }

      // Validate summary length (120-180 words, allow some buffer)
      const wordCount = parsed.summary.split(/\s+/).length;
      if (wordCount > 200) {
        verboseLog('[Advisor Feedback] Warning: Summary exceeds 180 words:', wordCount);
      }

      verboseLog('[Advisor Feedback] Generated successfully:', {
        scoreText,
        summaryWords: wordCount,
        actionsCount: parsed.actions.length
      });

      return {
        success: true,
        scoreText,
        summary: parsed.summary,
        actions: parsed.actions.slice(0, 3), // Ensure exactly 3
        prompt: {
          prompt_id: promptResolved.selected.prompt_id,
          version: promptResolved.selected.version,
          prompt_registry_id: `${promptResolved.selected.prompt_id}@${promptResolved.selected.version}`,
          model_id: promptResolved.selected.model_id,
        },
      };

    } catch (parseError) {
      console.error('[Advisor Feedback] Failed to parse JSON:', parseError);
      return {
        success: false,
        error: 'Failed to parse advisor response'
      };
    }

  } catch (error: any) {
    console.error('[Advisor Feedback] OpenAI API error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate advisor feedback'
    };
  }
}

export async function generateListeningScriptForTask(
  task: TaskProgress,
  userLevel: number,
  targetBand: number
): Promise<{
  success: boolean;
  scriptText?: string;
  accent?: string;
  scriptType?: string;
  ieltsPart?: number;
  topicDomain?: string;
  contextLabel?: string;
  scenarioOverview?: string;
  estimatedDurationSec?: number;
  difficulty?: string;
  prompt?: {
    prompt_id: string;
    version: string;
    prompt_registry_id: string;
    model_id: string;
  };
  error?: string;
}> {
  try {
    // Validate inputs
    if (!task.taskTitle) {
      return {
        success: false,
        error: "Task title is required for script generation"
      };
    }

    const progressMeta = (task.progressData ?? {}) as Record<string, any>;
    const progressActivityType =
      typeof progressMeta.activityType === "string"
        ? progressMeta.activityType.toLowerCase()
        : undefined;
    const scriptTypeNormalized =
      typeof task.scriptType === "string"
        ? task.scriptType.toLowerCase()
        : undefined;

    const activityType =
      progressActivityType === "dialogue" || progressActivityType === "monologue"
        ? progressActivityType
        : scriptTypeNormalized === "monologue"
          ? "monologue"
          : "dialogue";

    const scenarioCandidate =
      typeof progressMeta.scenario === "string" && progressMeta.scenario.trim().length > 0
        ? progressMeta.scenario
        : typeof task.contextLabel === "string" && task.contextLabel.trim().length > 0
          ? task.contextLabel
          : typeof task.topicDomain === "string" && task.topicDomain.trim().length > 0
            ? task.topicDomain
            : task.taskTitle ?? "Listening Practice";
    const scenario = scenarioCandidate;

    const accentRaw =
      typeof task.accent === "string" && task.accent.trim().length > 0
        ? task.accent
        : typeof progressMeta.accent === "string" && progressMeta.accent.trim().length > 0
          ? progressMeta.accent
          : "British";
    const accent = normalizeAccent(accentRaw);

    const promptResolved = await resolvePromptTemplateForExecution({
      promptId: "listening.script.legacy",
      userId: task.userId,
      sectionId: task.id,
    });
    await assertPromptVersionApprovedForProduction({
      promptId: promptResolved.selected.prompt_id,
      version: promptResolved.selected.version,
    });

    const userPrompt = buildLegacyListeningScriptUserPrompt({
      taskTitle: task.taskTitle,
      activityType,
      scenario,
      targetBand,
      userLevel,
      accent,
    });

    verboseLog(`[Script Generation] Generating IELTS script for "${task.taskTitle}":`, {
      userLevel,
      targetBand,
      weekNumber: task.weekNumber,
      activityType,
      scenario
    });

    // Generate the script using GPT-4o Mini
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Use GPT-4o Mini for cost efficiency
      messages: [
        {
          role: "system",
          content: promptResolved.selected.template || IELTS_SCRIPT_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      max_tokens: 1500, // Increased for complete script
      temperature: 0.7, // Balanced creativity and consistency
      response_format: { type: "json_object" }, // Ensure JSON response
    });

    const responseContent = response.choices[0]?.message?.content?.trim();

    if (!responseContent) {
      return {
        success: false,
        error: "OpenAI returned empty response"
      };
    }

    try {
      // Parse the JSON response
      const parsedResponse = JSON.parse(responseContent);
      
      if (!parsedResponse.script) {
        return {
          success: false,
          error: "No script content in OpenAI response"
        };
      }

      const estimatedDurationRaw = typeof parsedResponse.estimatedDurationSec === "number"
        ? parsedResponse.estimatedDurationSec
        : 360;
      const estimatedDurationSec = Math.max(330, Math.min(390, Math.round(estimatedDurationRaw)));

      verboseLog(`[Script Generation] Generated IELTS script:`, {
        ieltsPart: parsedResponse.ieltsPart,
        topicDomain: parsedResponse.topicDomain,
        contextLabel: parsedResponse.contextLabel,
        accent: parsedResponse.accent,
        scriptType: parsedResponse.scriptType,
        estimatedDurationSec
      });

      return {
        success: true,
        scriptText: parsedResponse.script,
        accent: parsedResponse.accent || "British",
        scriptType: parsedResponse.scriptType || "dialogue",
        ieltsPart: parsedResponse.ieltsPart,
        topicDomain: parsedResponse.topicDomain,
        contextLabel: parsedResponse.contextLabel,
        scenarioOverview: parsedResponse.scenarioOverview,
        estimatedDurationSec,
        difficulty: `Band ${targetBand}`, // Maintain for compatibility
        prompt: {
          prompt_id: promptResolved.selected.prompt_id,
          version: promptResolved.selected.version,
          prompt_registry_id: `${promptResolved.selected.prompt_id}@${promptResolved.selected.version}`,
          model_id: promptResolved.selected.model_id,
        },
      };

    } catch (parseError) {
      console.error("[Script Generation] Failed to parse JSON response:", parseError);
      safeErrorLog("[Script Generation] Parse failure payload", {
        responseLength: responseContent.length,
      });
      
      return {
        success: false,
        error: "Failed to parse script generation response"
      };
    }

  } catch (error: any) {
    console.error("[Script Generation] OpenAI API error:", error);
    return {
      success: false,
      error: error.message || "Failed to generate script"
    };
  }
}

export async function generateListeningSegmentFromBlueprint(params: {
  blueprint: ListeningSectionBlueprint;
  segmentNo: 1 | 2 | 3;
  targetDurationSeconds: number;
  userLevel: number;
  targetBand: number;
  accent: string;
  promptTemplate: string;
}): Promise<{
  success: boolean;
  transcript?: string;
  predictedDurationSec?: number;
  difficulty?: string;
  difficultyConfidence?: number;
  error?: string;
}> {
  try {
    const accent = normalizeAccent(params.accent);
    const blueprintContext = JSON.stringify({
      section_id: params.blueprint.section_id,
      section_no: params.blueprint.section_no,
      context_type: params.blueprint.context_type,
      entities: params.blueprint.entities,
      timeline: params.blueprint.timeline,
      facts: params.blueprint.facts,
      topic_domain: params.blueprint.topic_domain,
      context_label: params.blueprint.context_label,
      scenario_overview: params.blueprint.scenario_overview,
      script_type: params.blueprint.script_type,
    });

    const userPrompt = params.promptTemplate
      .replace("{{blueprint_context}}", blueprintContext)
      .replace("{{segment_no}}", String(params.segmentNo))
      .replace("{{target_duration_seconds}}", String(params.targetDurationSeconds))
      .replace("{{user_level}}", String(params.userLevel))
      .replace("{{target_band}}", String(params.targetBand))
      .replace("{{accent}}", accent);

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You generate structured IELTS listening segment JSON. Output JSON only.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.4,
      max_tokens: 1800,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        success: false,
        error: "OPENAI_EMPTY_RESPONSE",
      };
    }

    const parsed = JSON.parse(content);
    const transcript = typeof parsed?.transcript === "string" ? parsed.transcript.trim() : "";
    if (!transcript) {
      return {
        success: false,
        error: "SEGMENT_EMPTY_TRANSCRIPT",
      };
    }

    const predictedRaw =
      typeof parsed?.predictedDurationSec === "number" ? parsed.predictedDurationSec : params.targetDurationSeconds;
    const predictedDurationSec = Math.max(60, Math.round(predictedRaw));
    const difficulty =
      typeof parsed?.difficulty === "string" && parsed.difficulty.trim().length > 0
        ? parsed.difficulty
        : `Band ${params.targetBand}`;
    const difficultyConfidenceRaw =
      typeof parsed?.difficultyConfidence === "number" ? parsed.difficultyConfidence : 0.75;
    const difficultyConfidence = Math.max(0, Math.min(1, difficultyConfidenceRaw));

    return {
      success: true,
      transcript,
      predictedDurationSec,
      difficulty,
      difficultyConfidence,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? "SEGMENT_GENERATION_FAILED",
    };
  }
}
