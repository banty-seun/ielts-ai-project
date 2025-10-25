import OpenAI from "openai";
import { onboardingSchema, type TaskProgress, type Question, type QuestionOption } from "@shared/schema";
import { normalizeAccent } from "./utils/audio.ts";
import type { z } from "zod";

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
    console.log(...args);
  }
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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

    // Create the system prompt for IELTS question generation
    const systemPrompt = `You are an expert IELTS Listening tutor. Generate exactly 10 multiple-choice questions based on the provided listening script.

Requirements:
- Test main ideas, specific details, inference, speaker attitude, and vocabulary-in-context
- Exactly 10 questions
- Each question must have exactly 4 options (A, B, C, D)
- Include realistic distractors
- Provide the correct answer key and a clear explanation for each
- Difficulty appropriate for ${difficulty}

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
No extra text.`;

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
        explanation: q.explanation || ''
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
        questions: validatedQuestions
      };

    } catch (parseError) {
      console.error("[Question Generation] Failed to parse JSON response:", parseError);
      console.error("[Question Generation] Raw response:", responseContent);
      
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

✅ Each day should contain 1 Listening task with:
- A scenario (e.g., "Office Dialogue", "University Lecture", "Airport Announcement")
- A conversationType (e.g., "Job Interview", "Study Abroad Seminar", "Flight Information")
- ⚡ activityType: "dialogue" or "monologue" (use IELTS conventions; Part 1 & 3 are dialogues, Part 2 & 4 are monologues)
- ⚡ dayDurationMinutes: the exact number of minutes the user committed for that day based on onboarding (weekday/weekend rules)
- A concise description
- The accent being focused on

Format your response as a JSON array of 5 items, one for each day. Each item must include:
{
  "scenario": "Location/Setting",
  "conversationType": "Specific conversation type",
  "activityType": "dialogue | monologue",
  "description": "Brief task description",
  "dayDurationMinutes": number,
  "accent": "British | Canadian | Australian | American | NewZealand"
}

Rules:
- Respect availability: Only schedule on available days; durations must match the user's onboarding selection for weekday/weekend.
- Keep titles concise. UI will display as "Type: Scenario" (e.g., "Monologue: University Lecture").
- No Reading, Writing, or Speaking practice in this prompt.
- JSON only. No extra text.`;

    // Log the prompt for debugging
    verboseLog("OpenAI Prompt Details:");
    verboseLog("- System Prompt Length:", systemPrompt.length);
    verboseLog("- User Data Length:", formattedDataString.length);
    verboseLog("- API Key Check:", process.env.OPENAI_API_KEY ? "Present" : "Missing");
    verboseLog("- Formatted User Data:", JSON.stringify(formattedUserData, null, 2));

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
            const scenario = item.scenario || "Listening Practice";
            const conversationType = item.conversationType || `Session ${index + 1}`;
            const formattedTitle = `${scenario}: ${conversationType}`;
            
            return {
              title: formattedTitle,
              scenario: scenario,
              conversationType: conversationType,
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              duration: item.duration || "30 min",
              status: "not_started",
              accent: item.accent || "British",
              description: item.description || ""
            };
          });
        } else if (planData.plan && Array.isArray(planData.plan)) {
          // Object with plan array
          planArray = planData.plan.map((item: any, index: number) => {
            const scenario = item.scenario || "Listening Practice";
            const conversationType = item.conversationType || `Session ${index + 1}`;
            const formattedTitle = `${scenario}: ${conversationType}`;
            
            return {
              title: formattedTitle,
              scenario: scenario,
              conversationType: conversationType,
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              duration: item.duration || "30 min",
              status: "not_started",
              accent: item.accent || "British",
              description: item.taskDescription || item.description || ""
            };
          });
        } else if (planData.weeklyPlan && Array.isArray(planData.weeklyPlan)) {
          // Object with weeklyPlan array
          planArray = planData.weeklyPlan.map((item: any, index: number) => {
            const scenario = item.scenario || "Listening Practice";
            const conversationType = item.conversationType || `Session ${index + 1}`;
            const formattedTitle = `${scenario}: ${conversationType}`;
            
            return {
              title: formattedTitle,
              scenario: scenario,
              conversationType: conversationType,
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              duration: item.duration || "30 min",
              status: "not_started",
              accent: item.accent || "British",
              description: item.taskDescription || item.description || ""
            };
          });
        } else if (planData.days && Array.isArray(planData.days)) {
          // Object with days array
          planArray = planData.days.map((item: any, index: number) => {
            const scenario = item.scenario || "Listening Practice";
            const conversationType = item.conversationType || `Session ${index + 1}`;
            const formattedTitle = `${scenario}: ${conversationType}`;
            
            return {
              title: formattedTitle,
              scenario: scenario,
              conversationType: conversationType,
              skill: "Listening",
              day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index] || `Day ${index + 1}`,
              duration: item.duration || "30 min",
              status: "not_started",
              accent: item.accent || "British",
              description: item.taskDescription || item.description || ""
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

        verboseLog(
          "Successfully processed listening study plan with",
          planArray.length,
          "activities",
        );
        return studyPlan;
      } catch (parseError) {
        console.error("Error parsing OpenAI JSON response:", parseError);
        console.error("Raw response:", planText);
        return {
          success: false,
          reason: "Failed to parse the generated listening study plan",
          details: {
            error: parseError,
            rawResponse: planText
          }
        };
      }
    } catch (openaiError: any) {
      console.error("OpenAI API Error:", openaiError);
      // Detailed OpenAI error logging
      const errorDetails = {
        message: openaiError.message,
        type: openaiError.type,
        code: openaiError.code,
        statusCode: openaiError.status,
        responseData: openaiError.response?.data,
        stack: openaiError.stack
      };
      
      console.error("OpenAI Error Details:", JSON.stringify(errorDetails, null, 2));
      
      return {
        success: false,
        reason: "GPT-4o API error",
        details: errorDetails
      };
    }
  } catch (generalError) {
    console.error("General error in generateListeningStudyPlan:", generalError);
    return {
      success: false,
      reason: "Unexpected error while generating listening study plan",
      details: generalError
    };
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
export const IELTS_SCRIPT_SYSTEM_PROMPT = `
You are an IELTS Listening tutor. Generate a realistic script strictly aligned with IELTS listening contexts.
Return JSON ONLY in this exact shape:

{
  "script": "Full script text.",
  "scriptType": "dialogue" | "monologue",
  "topicDomain": "short domain label, e.g. 'Office', 'Service Call', 'Museum', 'Classroom', 'Academic Lecture'",
  "contextLabel": "1–3 word noun phrase for display (title base). Reuse topicDomain if appropriate.",
  "scenarioOverview": "1–2 sentences summarizing the situation and goal",
  "accent": "British" | "American" | "Canadian" | "Australian" | "NewZealand",
  "estimatedDurationSec": number,
  "ieltsPart": 1 | 2 | 3 | 4
}

Rules:
- The scriptType MUST match the provided activityType for this session.
- The topicDomain/context should reflect the provided scenario.
- Map IELTS parts appropriately (1 & 3 = dialogues; 2 & 4 = monologues).
- Target spoken length 90–180 seconds (approx. 1–3 minutes).

No commentary. JSON only.
`;

export const LISTENING_SESSION_PACKAGE_SYSTEM = `
You are an IELTS Listening tutor. Generate a package of listening practice items for a single session.

Goal:
- Produce a batch of audios (prefetchCount = 4) that all match the same activityType and scenario.
- Each audio must include: a realistic script JSON (per IELTS script schema) and a 10-question MCQ set with answers.

Inputs (provided in user message):
- activityType: "dialogue" | "monologue"
- scenario: short label ("University Lecture", "Office Dialogue", etc.)
- sessionDurationMinutes: integer (total time available for this session)
- targetBand: integer (goal)
- userLevel: integer (current)
- accent: "British" | "Canadian" | "Australian" | "American" | "NewZealand" (optional; choose if not provided)

Constraints:
- All audios in this package must use the SAME activityType and scenario family (topics vary but stay within the scenario/domain).
- Preferred per-audio spoken duration: 90–180 seconds. Vary lengths slightly to feel natural.
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
}: {
  activityType: "dialogue" | "monologue";
  scenario: string;
  sessionDurationMinutes: number;
  targetBand: number;
  userLevel: number;
  accent?: string;
}) => `
Create a listening session package with prefetchCount=4.

Inputs:
- activityType: ${activityType}
- scenario: ${scenario}
- sessionDurationMinutes: ${sessionDurationMinutes}
- targetBand: ${targetBand}
- userLevel: ${userLevel}
- accent: ${accent ?? "auto-select"}

Requirements:
- SAME activityType and scenario across all audios
- Each audio: 90–180 sec script + exactly 10 MCQs (A–D) with answers and explanations
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

  const systemPrompt = LISTENING_SESSION_PACKAGE_SYSTEM;
  const userPrompt = buildSessionPackageUserPrompt({
    ...params,
    accent: normalizedAccent,
  });

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
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
    console.error("[Session Package] Failed to parse JSON response", { content });
    throw new Error("Failed to parse session package response");
  }

  const activityType = params.activityType;
  const scenario = params.scenario.trim();
  const sessionDurationMinutes = params.sessionDurationMinutes;
  const accent = normalizedAccent ?? normalizeAccent(parsed?.session?.accent);

  const title = `${activityType.charAt(0).toUpperCase()}${activityType.slice(1)}: ${scenario}`;

  const audiosRaw = ensureArray(parsed?.audios, []).slice(0, 4);

  const audios: ListeningSessionPackageAudio[] = audiosRaw.map((audio: any, idx: number) => {
    const script = audio?.script ?? {};
    const scriptAccent = normalizeAccent(script?.accent ?? accent);
    const scriptType =
      activityType === "dialogue" ? ("dialogue" as const) : ("monologue" as const);

    const questionsRaw = ensureArray(audio?.questions, []).slice(0, 10);
    const questions: ListeningSessionPackageQuestion[] = questionsRaw
      .map((q: any, qIdx: number) => ({
        id: typeof q?.id === "string" ? q.id : `q${qIdx + 1}`,
        question: typeof q?.question === "string" ? q.question : "",
        options: ensureArray(q?.options, []).slice(0, 4).map((opt: any) => String(opt)),
        correctAnswer: typeof q?.correctAnswer === "string" ? q.correctAnswer : "",
        explanation: typeof q?.explanation === "string" ? q.explanation : "",
      }))
      .filter((q) => q.question.trim().length > 0);

    const estimatedSec =
      typeof script?.estimatedDurationSec === "number"
        ? script.estimatedDurationSec
        : undefined;

    return {
      index: typeof audio?.index === "number" ? audio.index : idx + 1,
      script: {
        script: String(script?.script ?? ""),
        scriptType: script?.scriptType === "monologue" ? "monologue" : scriptType,
        topicDomain: typeof script?.topicDomain === "string" ? script.topicDomain : undefined,
        contextLabel: typeof script?.contextLabel === "string" ? script.contextLabel : undefined,
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
  });

  const estimatedTotalAudioSec = audios.reduce((total, audio) => {
    const duration = audio.script.estimatedDurationSec;
    return total + (typeof duration === "number" ? duration : 0);
  }, 0);

  return {
    session: {
      title,
      activityType,
      scenario,
      sessionDurationMinutes,
      estimatedTotalAudioSec,
      accent,
    },
    audios,
  };
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

    // Create user prompt with task details
    const userPrompt = `Create an IELTS listening script for: "${task.taskTitle}".

Inputs:
- activityType: ${activityType}  // "dialogue" | "monologue"
- scenario: ${scenario}          // short label, e.g. "University Lecture", "Customer Support Call"
- targetBand: ${targetBand}      // learner goal
- userLevel: ${userLevel}        // current self-assessed level
- accent: ${accent}              // optional; can be set by plan if provided

Requirements:
- Pick ONE IELTS Listening Part format consistent with activityType (1 or 3 for dialogue; 2 or 4 for monologue)
- Topic domain must align with the scenario
- Language level appropriate for Band ${targetBand} learners (current level Band ${userLevel})
- Target spoken duration 1–3 minutes
- Return JSON only per the system schema`;

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
          content: IELTS_SCRIPT_SYSTEM_PROMPT
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

      verboseLog(`[Script Generation] Generated IELTS script:`, {
        ieltsPart: parsedResponse.ieltsPart,
        topicDomain: parsedResponse.topicDomain,
        contextLabel: parsedResponse.contextLabel,
        accent: parsedResponse.accent,
        scriptType: parsedResponse.scriptType,
        estimatedDurationSec: parsedResponse.estimatedDurationSec
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
        estimatedDurationSec: parsedResponse.estimatedDurationSec,
        difficulty: `Band ${targetBand}` // Maintain for compatibility
      };

    } catch (parseError) {
      console.error("[Script Generation] Failed to parse JSON response:", parseError);
      console.error("[Script Generation] Raw response:", responseContent);
      
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
