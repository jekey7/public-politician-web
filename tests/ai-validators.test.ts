import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDiscrepancyKindOutput,
  validateEntityMatchOutput,
  validateRagAnswerOutput,
} from "../src/lib/ai-validators";

test("entity match validator accepts bounded confidence", () => {
  const result = validateEntityMatchOutput({
    isSameEntity: true,
    confidence: 0.75,
    rationale: "same school and degree wording",
  });

  assert.equal(result.isSameEntity, true);
  assert.equal(result.confidence, 0.75);
});

test("entity match validator rejects unbounded confidence", () => {
  assert.throws(
    () =>
      validateEntityMatchOutput({
        isSameEntity: true,
        confidence: 2,
        rationale: "invalid",
      }),
    /between 0 and 1/,
  );
});

test("discrepancy validator only accepts allowed categories", () => {
  assert.equal(validateDiscrepancyKindOutput("content_conflict"), "content_conflict");
  assert.throws(() => validateDiscrepancyKindOutput("political_opinion"), /allowed discrepancy kinds/);
});

test("rag validator enforces citations for answered output", () => {
  const answer = validateRagAnswerOutput({
    status: "answered_with_citations",
    answer: "출처가 확인되었습니다.",
    citations: [
      {
        evidenceId: "ev-1",
        sourceOrg: "source",
        sourceUrl: "https://example.invalid/source",
        snippet: "raw text",
      },
    ],
  });

  assert.equal(answer.citations.length, 1);
});

test("rag validator enforces fixed no-material answer", () => {
  assert.deepEqual(validateRagAnswerOutput({ status: "no_material", answer: "관련 자료 없음", citations: [] }), {
    status: "no_material",
    answer: "관련 자료 없음",
    citations: [],
  });

  assert.throws(
    () => validateRagAnswerOutput({ status: "no_material", answer: "아마 없습니다.", citations: [] }),
    /fixed refusal answer/,
  );
});
