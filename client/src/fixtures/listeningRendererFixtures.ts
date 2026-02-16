import type { ListeningRendererRoot } from "../../../shared/listening";

export const listeningRendererFixtures: ListeningRendererRoot[] = [
  {
    renderer_schema_version: "1.0.0",
    section_id: "fixture-section-form",
    section_no: 1,
    blocks: [
      {
        block_id: "block-1",
        block_title: "Form Completion",
        instructions: "Complete the form.",
        question_range: { from: 1, to: 3 },
        segment_no: 1,
        render_hints: { layout: "form" },
        engine: "form_or_table_completion",
        questions: [
          { question_id: "q1", prompt: "Name", answer_key: "John", tags: ["detail"] },
          { question_id: "q2", prompt: "Date", answer_key: "Monday", tags: ["dates"] },
          { question_id: "q3", prompt: "Cost", answer_key: "50", tags: ["numbers"] },
        ],
        blanks: [
          { blank_no: 1, accepted_answers: ["John"] },
          { blank_no: 2, accepted_answers: ["Monday"] },
          { blank_no: 3, accepted_answers: ["50"] },
        ],
      },
    ],
  },
  {
    renderer_schema_version: "1.0.0",
    section_id: "fixture-section-summary",
    section_no: 1,
    blocks: [
      {
        block_id: "block-2",
        block_title: "Summary Completion",
        instructions: "Fill in the missing words.",
        question_range: { from: 4, to: 6 },
        segment_no: 2,
        render_hints: { layout: "summary" },
        engine: "sentence_or_note_completion",
        questions: [
          { question_id: "q4", prompt: "Main topic", answer_key: "transport", tags: ["general"] },
          { question_id: "q5", prompt: "Number", answer_key: "12", tags: ["numbers"] },
          { question_id: "q6", prompt: "Direction", answer_key: "north", tags: ["directions"] },
        ],
        blanks: [
          { blank_no: 4, accepted_answers: ["transport"] },
          { blank_no: 5, accepted_answers: ["12", "twelve"] },
          { blank_no: 6, accepted_answers: ["north"] },
        ],
      },
    ],
  },
  {
    renderer_schema_version: "1.0.0",
    section_id: "fixture-section-mcq",
    section_no: 1,
    blocks: [
      {
        block_id: "block-3",
        block_title: "Single Select",
        instructions: "Choose one option.",
        question_range: { from: 7, to: 8 },
        segment_no: 3,
        render_hints: { layout: "mcq" },
        engine: "mcq_single",
        questions: [
          {
            question_id: "q7",
            prompt: "What time?",
            answer_key: "A",
            tags: ["detail"],
            options: [
              { id: "A", label: "8 AM" },
              { id: "B", label: "9 AM" },
              { id: "C", label: "10 AM" },
              { id: "D", label: "11 AM" },
            ],
          },
          {
            question_id: "q8",
            prompt: "Where?",
            answer_key: "C",
            tags: ["maps"],
            options: [
              { id: "A", label: "Hall" },
              { id: "B", label: "Lobby" },
              { id: "C", label: "Library" },
              { id: "D", label: "Cafeteria" },
            ],
          },
        ],
      },
    ],
  },
  {
    renderer_schema_version: "1.0.0",
    section_id: "fixture-section-multi",
    section_no: 1,
    blocks: [
      {
        block_id: "block-4",
        block_title: "Multi Select",
        instructions: "Select two answers.",
        question_range: { from: 9, to: 10 },
        segment_no: 1,
        render_hints: { layout: "checklist" },
        engine: "multi_select",
        questions: [
          {
            question_id: "q9",
            prompt: "Choose facilities",
            answer_key: "A,C",
            tags: ["detail"],
            options: [
              { id: "A", label: "Gym" },
              { id: "B", label: "Pool" },
              { id: "C", label: "Lab" },
            ],
          },
          {
            question_id: "q10",
            prompt: "Choose routes",
            answer_key: "B,D",
            tags: ["directions"],
            options: [
              { id: "A", label: "North" },
              { id: "B", label: "East" },
              { id: "C", label: "South" },
              { id: "D", label: "West" },
            ],
          },
        ],
      },
    ],
  },
  {
    renderer_schema_version: "1.0.0",
    section_id: "fixture-section-map",
    section_no: 1,
    blocks: [
      {
        block_id: "block-5",
        block_title: "Map Labeling",
        instructions: "Label the map.",
        question_range: { from: 11, to: 12 },
        segment_no: 2,
        render_hints: { layout: "map" },
        engine: "map_or_diagram_labeling",
        questions: [
          { question_id: "q11", prompt: "Point A", answer_key: "Reception", tags: ["maps"] },
          { question_id: "q12", prompt: "Point B", answer_key: "Entrance", tags: ["maps"] },
        ],
        labels: [
          { label_id: "A", correct_value: "Reception" },
          { label_id: "B", correct_value: "Entrance" },
        ],
      },
    ],
  },
  {
    renderer_schema_version: "1.0.0",
    section_id: "fixture-section-matching",
    section_no: 1,
    blocks: [
      {
        block_id: "block-6",
        block_title: "Matching",
        instructions: "Match the statements.",
        question_range: { from: 13, to: 14 },
        segment_no: 3,
        render_hints: { layout: "matching" },
        engine: "matching_letters",
        questions: [
          { question_id: "q13", prompt: "Speaker A", answer_key: "B", tags: ["attitude"] },
          { question_id: "q14", prompt: "Speaker B", answer_key: "A", tags: ["attitude"] },
        ],
        pairs: [
          { left: "A", right: "Library" },
          { left: "B", right: "Laboratory" },
        ],
      },
    ],
  },
];
