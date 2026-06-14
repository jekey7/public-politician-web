import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, filterOptions, searchPoliticians } from "../src/lib/search";

test("home search returns all mock profiles without filters", () => {
  const results = searchPoliticians({});

  assert.deepEqual(
    results.map((politician) => politician.politicianId),
    ["mock-001", "mock-002"],
  );
});

test("home search filters by party, region, and committee", () => {
  assert.deepEqual(searchPoliticians({ party: "가상정당" }).map((politician) => politician.politicianId), ["mock-001"]);
  assert.deepEqual(searchPoliticians({ region: "부산" }).map((politician) => politician.politicianId), ["mock-002"]);
  assert.deepEqual(searchPoliticians({ committee: "자료투명성" }).map((politician) => politician.politicianId), ["mock-001"]);
});

test("home search query matches sourced profile fields", () => {
  const results = searchPoliticians({ query: "법학과" });

  assert.deepEqual(
    results.map((politician) => politician.politicianId),
    ["mock-002"],
  );
});

test("home search exposes stable filter options from sourced mock fields", () => {
  const options = filterOptions();

  assert.deepEqual(options.parties, ["가상정당", "샘플정당"]);
  assert.deepEqual(options.regions, ["부산", "서울"]);
  assert.ok(options.committees.includes("데이터투명성특별위원회"));
});

test("qa answer state returns cited material or fixed no-material response", async () => {
  const cited = await answerQuestion("김공개 행정학과");
  const missing = await answerQuestion("지원하지않는질문");

  assert.equal(cited.status, "answered_with_citations");
  assert.ok(cited.citations.length > 0);
  assert.ok(cited.citations.every((citation) => citation.sourceOrg && citation.sourceUrl));
  assert.deepEqual(missing, {
    answer: "관련 자료 없음",
    citations: [],
    status: "no_material",
  });
});
