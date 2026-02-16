import assert from "node:assert/strict";
import { transformLegacyQuestionsToRenderer } from "../renderer";

const makeQuestions = (count: number) =>
  Array.from({ length: count }, (_, idx) => ({
    id: `q${idx + 1}`,
    question: `Question ${idx + 1}`,
    options: [
      { id: "A", text: "Opt A" },
      { id: "B", text: "Opt B" },
      { id: "C", text: "Opt C" },
      { id: "D", text: "Opt D" },
    ],
    correctAnswer: "A",
    tags: ["general"],
  }));

const templateA = transformLegacyQuestionsToRenderer({
  sectionId: "section-a",
  sectionNo: 1,
  questions: makeQuestions(10) as any,
  segmentCount: 3,
});
assert.equal(templateA.blocks.length, 3);
assert.deepEqual(templateA.blocks.map((b) => b.question_range.to - b.question_range.from + 1), [3, 3, 4]);

const templateB = transformLegacyQuestionsToRenderer({
  sectionId: "section-b",
  sectionNo: 2,
  questions: makeQuestions(9) as any,
  segmentCount: 3,
});
assert.equal(templateB.blocks.length, 3);

const templateC = transformLegacyQuestionsToRenderer({
  sectionId: "section-c",
  sectionNo: 3,
  questions: makeQuestions(8) as any,
  segmentCount: 2,
});
assert.equal(templateC.blocks.length, 2);

console.log("renderer mapping template tests passed");
