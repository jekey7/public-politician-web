import assert from "node:assert/strict";
import test from "node:test";
import { politicians } from "../src/lib/mock-data";
import { answerQuestionFromSnapshot, buildRagCorpus } from "../src/lib/rag";
import { buildPublicSnapshot } from "../src/lib/snapshot";

const snapshot = buildPublicSnapshot(politicians, "2026-06-11T00:00:00.000Z");

test("rag corpus is built only from sourced snapshot facts", () => {
  const corpus = buildRagCorpus(snapshot);

  assert.equal(corpus.length, snapshot.verified_facts.length);
  for (const entry of corpus) {
    assert.ok(entry.evidenceId);
    assert.ok(entry.sourceOrg);
    assert.ok(entry.sourceUrl);
    assert.ok(entry.text.includes(entry.displayName));
  }
});

test("rag answer includes citations when snapshot facts match", () => {
  const answer = answerQuestionFromSnapshot("김공개 행정학과", snapshot);

  assert.equal(answer.status, "answered_with_citations");
  assert.ok(answer.citations.length > 0);
  assert.ok(answer.citations.every((citation) => citation.sourceUrl));
});

test("rag answer refuses unsupported questions", () => {
  const answer = answerQuestionFromSnapshot("없는자료", snapshot);

  assert.equal(answer.status, "no_material");
  assert.equal(answer.answer, "관련 자료 없음");
  assert.deepEqual(answer.citations, []);
});
