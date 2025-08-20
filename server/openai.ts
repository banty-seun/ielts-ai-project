import OpenAI from "openai";
import { onboardingSchema, type TaskProgress, type Question, type QuestionOption } from "@shared/schema";
import type { z } from "zod";

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
    const systemPrompt = `You are an expert IELTS Listening tutor. Generate 4-5 multiple-choice questions based on the provided listening script.

Requirements:
- Questions should test listening comprehension skills appropriate for IELTS
- Include questions about main ideas, specific details, inferences, and vocabulary in context
- Each question must have exactly 4 options (A, B, C, D)
- Include realistic distractors that test careful listening
- Provide clear explanations for the correct answers
- Questions should be appropriate for ${difficulty} level

Please respond with a JSON object in this exact format:
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

Only return the JSON object — no additional explanation.`;

    const userPrompt = `Task: ${taskTitle}

Script text:
${scriptText}

Generate 4-5 IELTS listening comprehension questions based on this script.`;

    console.log(`[Question Generation] Generating questions for "${taskTitle}":`, {
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

      console.log(`[Question Generation] Generated ${validatedQuestions.length} questions for "${taskTitle}"`);

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
- Emphasize exposure to diverse accents including: British, Canadian, Australian, New Zealand, and North American.

✅ Each day should contain 1 Listening task with:
- A scenario (e.g., "Office Dialogue", "University Lecture", "Airport Announcement")
- A conversationType (e.g., "Job Interview", "Study Abroad Seminar", "Flight Information")
- A concise description
- An estimated duration (based on the user's daily study commitment)
- The accent being focused on

Format your response as a JSON array of 5 items, one for each day. Each item must include:
{
  "scenario": "Location/Setting",
  "conversationType": "Specific conversation type",
  "description": "Brief task description",
  "duration": "time estimate",
  "accent": "accent type"
}

Do not include any extra explanations or summaries outside the plan itself.
Focus on helping the learner build familiarity with question types, improve selective listening, and handle different accents confidently. You may occasionally include short strategy tips in the task description.
This plan will be shown in a dashboard UI, so make sure the task names and descriptions are concise, readable, and focused on clarity.
Do not include Reading, Writing, or Speaking practice — this prompt is only for the Listening module.`;

    // Log the prompt for debugging
    console.log("OpenAI Prompt Details:");
    console.log("- System Prompt Length:", systemPrompt.length);
    console.log("- User Data Length:", formattedDataString.length);
    console.log("- API Key Check:", process.env.OPENAI_API_KEY ? "Present" : "Missing");
    console.log("- Formatted User Data:", JSON.stringify(formattedUserData, null, 2));

    // Call OpenAI API with better error handling
    try {
      console.log("Calling OpenAI API to generate Listening study plan...");
      
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
      console.log("Received response from OpenAI");
      
      // Log token usage for monitoring
      console.log("OpenAI Token Usage:", {
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
        console.log(
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
            "New Zealand",
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

        console.log(
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
No commentary. JSON only.
`;

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

    // Create user prompt with task details
    const userPrompt = `Create an IELTS listening script for: "${task.taskTitle}". 
    
Requirements:
- Pick ONE IELTS Listening Part format (1-4)
- Pick ONE topic domain aligned with IELTS topics
- Language level should be appropriate for Band ${targetBand} learners (current level Band ${userLevel})
- Target duration 1–3 minutes when spoken aloud
- You MUST choose a valid IELTS part and a topic domain per the system instructions and return the JSON only.`;

    console.log(`[Script Generation] Generating IELTS script for "${task.taskTitle}":`, {
      userLevel,
      targetBand,
      weekNumber: task.weekNumber
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

      console.log(`[Script Generation] Generated IELTS script:`, {
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
