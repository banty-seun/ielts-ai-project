import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const legacyQuestions = [
  {
    id: "q1",
    question: "What time does the tour start?",
    options: [
      { id: "A", text: "8:00 AM" },
      { id: "B", text: "9:00 AM" },
      { id: "C", text: "10:00 AM" },
      { id: "D", text: "11:00 AM" },
    ],
  },
  {
    id: "q2",
    question: "Where should visitors meet?",
    options: [
      { id: "A", text: "Main hall" },
      { id: "B", text: "Reception" },
      { id: "C", text: "Library" },
      { id: "D", text: "Cafeteria" },
    ],
  },
];

const tree = React.createElement(
  "section",
  null,
  legacyQuestions.map((question, index) =>
    React.createElement(
      "article",
      { key: question.id },
      React.createElement("h3", null, `${index + 1}. ${question.question}`),
      React.createElement(
        "ul",
        null,
        question.options.map((option) =>
          React.createElement("li", { key: option.id }, `${option.id}. ${option.text}`),
        ),
      ),
    ),
  ),
);

const html = renderToStaticMarkup(tree);
if (!html || html.trim().length === 0) {
  throw new Error("Legacy listening smoke render produced empty output");
}

if (!html.includes("What time does the tour start?") || !html.includes("Where should visitors meet?")) {
  throw new Error("Legacy listening smoke render missing expected question prompts");
}

console.log("[renderer-harness] legacy mode smoke rendered");
