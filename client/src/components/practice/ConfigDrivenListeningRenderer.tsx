import React from "react";
import type { ListeningRendererRoot } from "@shared/listening";

interface ConfigDrivenListeningRendererProps {
  payload: ListeningRendererRoot;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  readOnly?: boolean;
  onTelemetry?: (event: { type: string; engine: string; blockId: string }) => void;
}

const UnsupportedBlock = ({ engine }: { engine: string }) => (
  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
    Unsupported question engine: {engine}
  </div>
);

const QuestionPrompt = ({ questionNo, prompt }: { questionNo: string; prompt: string }) => (
  <p className="font-medium text-gray-900">{questionNo}. {prompt}</p>
);

const SingleChoiceBlock = ({
  block,
  answers,
  onAnswerChange,
  readOnly,
}: {
  block: Extract<ListeningRendererRoot["blocks"][number], { engine: "mcq_single" | "legacy_mcq" }>;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  readOnly?: boolean;
}) => (
  <div className="space-y-4">
    {block.questions.map((question, index) => (
      <div key={question.question_id} className="rounded-md border border-gray-200 p-3">
        <QuestionPrompt questionNo={String(block.question_range.from + index)} prompt={question.prompt} />
        <div className="mt-2 space-y-2">
          {question.options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                disabled={readOnly}
                checked={answers[question.question_id] === option.id}
                onChange={() => onAnswerChange(question.question_id, option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const MultiSelectBlock = ({
  block,
  answers,
  onAnswerChange,
  readOnly,
}: {
  block: Extract<ListeningRendererRoot["blocks"][number], { engine: "multi_select" }>;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  readOnly?: boolean;
}) => {
  const configuredLimit = Number((block.render_hints as any)?.selection_count);
  const selectionLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : (() => {
        const instructionMatch = block.instructions.match(/select\s+(\d+)/i);
        return instructionMatch ? Number(instructionMatch[1]) : null;
      })();

  return (
    <div className="space-y-4">
      {block.questions.map((question, index) => {
        const selected = new Set((answers[question.question_id] ?? "").split(",").filter(Boolean));
        const showLimitWarning = Number.isFinite(selectionLimit as number) && selected.size > Number(selectionLimit);

        return (
          <div key={question.question_id} className="rounded-md border border-gray-200 p-3">
            <QuestionPrompt questionNo={String(block.question_range.from + index)} prompt={question.prompt} />
            {Number.isFinite(selectionLimit as number) && (
              <p className="mt-1 text-xs text-gray-500">Select {selectionLimit} option(s).</p>
            )}
            <div className="mt-2 space-y-2">
              {question.options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selected.has(option.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.currentTarget.checked) {
                        next.add(option.id);
                      } else {
                        next.delete(option.id);
                      }
                      onAnswerChange(question.question_id, Array.from(next).join(","));
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {showLimitWarning && (
              <p className="mt-2 text-xs text-red-600">
                You selected too many options for this question.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TextCompletionBlock = ({
  block,
  answers,
  onAnswerChange,
  readOnly,
}: {
  block: Extract<ListeningRendererRoot["blocks"][number], { engine: "form_or_table_completion" | "sentence_or_note_completion" }>;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  readOnly?: boolean;
}) => {
  const configuredMaxWords = Number((block.render_hints as any)?.max_words);
  const maxWords = Number.isFinite(configuredMaxWords) && configuredMaxWords > 0
    ? configuredMaxWords
    : (() => {
        const match = block.instructions.match(/max(?:imum)?\s+(\d+)\s+word/i);
        return match ? Number(match[1]) : null;
      })();

  return (
    <div className="space-y-4">
      {block.blanks.map((blank, index) => {
        const question = block.questions[index];
        if (!question) return null;
        const value = answers[question.question_id] ?? "";
        const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
        const exceedsWordLimit = Number.isFinite(maxWords as number) && wordCount > Number(maxWords);
        return (
          <div key={`${question.question_id}-${blank.blank_no}`} className="rounded-md border border-gray-200 p-3">
            {question.prompt.includes("___") ? (
              <div className="font-medium text-gray-900">
                {block.question_range.from + index}.{" "}
                {question.prompt.split("___").map((part, partIndex, parts) => (
                  <React.Fragment key={`${question.question_id}-${partIndex}`}>
                    {part}
                    {partIndex < parts.length - 1 && (
                      <input
                        type="text"
                        disabled={readOnly}
                        value={value}
                        onChange={(event) => onAnswerChange(question.question_id, event.currentTarget.value)}
                        className="mx-2 inline-block w-40 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <QuestionPrompt
                questionNo={String(block.question_range.from + index)}
                prompt={`${question.prompt} (Blank ${blank.blank_no})`}
              />
            )}
            {Number.isFinite(maxWords as number) && (
              <p className="mt-1 text-xs text-gray-500">Max {maxWords} word(s).</p>
            )}
            {!question.prompt.includes("___") && (
              <input
                type="text"
                disabled={readOnly}
                value={value}
                onChange={(event) => onAnswerChange(question.question_id, event.currentTarget.value)}
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            )}
            {exceedsWordLimit && (
              <p className="mt-2 text-xs text-red-600">Answer exceeds the word limit.</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

const MatchingBlock = ({
  block,
  answers,
  onAnswerChange,
  readOnly,
}: {
  block: Extract<ListeningRendererRoot["blocks"][number], { engine: "matching_letters" }>;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  readOnly?: boolean;
}) => (
  <div className="space-y-4">
    {block.questions.map((question, index) => (
      <div key={question.question_id} className="rounded-md border border-gray-200 p-3">
        <QuestionPrompt questionNo={String(block.question_range.from + index)} prompt={question.prompt} />
        <select
          disabled={readOnly}
          value={answers[question.question_id] ?? ""}
          onChange={(event) => onAnswerChange(question.question_id, event.currentTarget.value)}
          className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select a match</option>
          {block.pairs.map((pair) => (
            <option key={`${pair.left}-${pair.right}`} value={pair.left}>
              {pair.left} - {pair.right}
            </option>
          ))}
        </select>
      </div>
    ))}
  </div>
);

const MapDiagramBlock = ({
  block,
  answers,
  onAnswerChange,
  readOnly,
}: {
  block: Extract<ListeningRendererRoot["blocks"][number], { engine: "map_or_diagram_labeling" }>;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  readOnly?: boolean;
}) => (
  <div className="space-y-4">
    {block.questions.map((question, index) => (
      <div key={question.question_id} className="rounded-md border border-gray-200 p-3">
        <QuestionPrompt questionNo={String(block.question_range.from + index)} prompt={question.prompt} />
        <input
          type="text"
          disabled={readOnly}
          value={answers[question.question_id] ?? ""}
          onChange={(event) => onAnswerChange(question.question_id, event.currentTarget.value)}
          className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="Enter label"
        />
      </div>
    ))}
  </div>
);

export function ConfigDrivenListeningRenderer({
  payload,
  answers,
  onAnswerChange,
  readOnly,
  onTelemetry,
}: ConfigDrivenListeningRendererProps) {
  const emittedTelemetryRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    payload.blocks.forEach((block) => {
      const supported =
        block.engine === "mcq_single" ||
        block.engine === "legacy_mcq" ||
        block.engine === "multi_select" ||
        block.engine === "form_or_table_completion" ||
        block.engine === "sentence_or_note_completion" ||
        block.engine === "matching_letters" ||
        block.engine === "map_or_diagram_labeling";
      if (supported) return;
      const key = `${block.block_id}:${String(block.engine)}`;
      if (emittedTelemetryRef.current.has(key)) return;
      emittedTelemetryRef.current.add(key);
      onTelemetry?.({
        type: "unsupported_engine_block",
        engine: String(block.engine),
        blockId: block.block_id,
      });
    });
  }, [onTelemetry, payload.blocks]);

  return (
    <div className="space-y-6">
      {payload.blocks.map((block) => (
        <section key={block.block_id} className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="font-semibold text-gray-900">{block.block_title}</h4>
          <p className="mt-1 text-sm text-gray-600">{block.instructions}</p>

          <div className="mt-4">
            {(block.engine === "mcq_single" || block.engine === "legacy_mcq") && (
              <SingleChoiceBlock block={block} answers={answers} onAnswerChange={onAnswerChange} readOnly={readOnly} />
            )}
            {block.engine === "multi_select" && (
              <MultiSelectBlock block={block} answers={answers} onAnswerChange={onAnswerChange} readOnly={readOnly} />
            )}
            {(block.engine === "form_or_table_completion" || block.engine === "sentence_or_note_completion") && (
              <TextCompletionBlock block={block} answers={answers} onAnswerChange={onAnswerChange} readOnly={readOnly} />
            )}
            {block.engine === "matching_letters" && (
              <MatchingBlock block={block} answers={answers} onAnswerChange={onAnswerChange} readOnly={readOnly} />
            )}
            {block.engine === "map_or_diagram_labeling" && (
              <MapDiagramBlock block={block} answers={answers} onAnswerChange={onAnswerChange} readOnly={readOnly} />
            )}
            {!(
              block.engine === "mcq_single" ||
              block.engine === "legacy_mcq" ||
              block.engine === "multi_select" ||
              block.engine === "form_or_table_completion" ||
              block.engine === "sentence_or_note_completion" ||
              block.engine === "matching_letters" ||
              block.engine === "map_or_diagram_labeling"
            ) && <UnsupportedBlock engine={block.engine} />}
          </div>
        </section>
      ))}
    </div>
  );
}
