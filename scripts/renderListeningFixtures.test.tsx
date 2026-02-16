import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listeningRendererFixtures } from "../client/src/fixtures/listeningRendererFixtures";

const renderBlock = (block: any) => {
  if (block.engine === "form_or_table_completion" || block.engine === "sentence_or_note_completion") {
    return React.createElement("ul", null, block.blanks.map((blank: any) => React.createElement("li", { key: String(blank.blank_no) }, `Blank ${blank.blank_no}`)));
  }
  if (block.engine === "mcq_single" || block.engine === "legacy_mcq") {
    return React.createElement(
      "ol",
      null,
      block.questions.map((q: any) =>
        React.createElement("li", { key: q.question_id }, `${q.prompt} (${Array.isArray(q.options) ? q.options.length : 0} options)`),
      ),
    );
  }
  if (block.engine === "multi_select") {
    return React.createElement("div", null, `Multi-select questions: ${block.questions.length}`);
  }
  if (block.engine === "map_or_diagram_labeling") {
    return React.createElement("div", null, `Labels: ${block.labels.length}`);
  }
  if (block.engine === "matching_letters") {
    return React.createElement("div", null, `Pairs: ${block.pairs.length}`);
  }
  throw new Error(`Unsupported engine in renderer harness: ${block.engine}`);
};

for (const fixture of listeningRendererFixtures) {
  const tree = React.createElement(
    "section",
    { key: fixture.section_id },
    fixture.blocks.map((block) =>
      React.createElement(
        "article",
        { key: block.block_id },
        React.createElement("h2", null, block.block_title),
        renderBlock(block),
      ),
    ),
  );

  const html = renderToStaticMarkup(tree);
  if (!html || html.trim().length === 0) {
    throw new Error(`Renderer harness produced empty output for fixture ${fixture.section_id}`);
  }
}

console.log(`[renderer-harness] rendered ${listeningRendererFixtures.length} fixtures`);
