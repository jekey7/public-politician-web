import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAssemblyProfileCollector,
  parsePublicPipelineCollectorMode,
  publicPipelineStatus,
  selectPublicPipelineCollector,
} from "../src/lib/public-pipeline";
import { OpenAssemblyCollector } from "../src/lib/collectors/open-assembly";

test("public pipeline defaults to mock collector", () => {
  const selection = selectPublicPipelineCollector({});

  assert.equal(selection.mode, "mock");
  assert.equal(selection.collector.sourceName, "mock-politician-fixture");
});

test("public pipeline rejects unsupported collector mode", () => {
  assert.throws(() => parsePublicPipelineCollectorMode("rss"), /Unsupported PUBLIC_PIPELINE_COLLECTOR/);
});

test("public pipeline default stays on mock even though open_assembly is approved", () => {
  // Human approval (2026-06-13) flipped open_assembly -> approved, but approval does NOT enable real
  // collection: the DEFAULT collector is still mock. Real collection requires explicitly setting
  // PUBLIC_PIPELINE_COLLECTOR=open_assembly (a separate, deliberate step).
  assert.equal(selectPublicPipelineCollector({}).mode, "mock");

  assert.deepEqual(publicPipelineStatus({}), {
    mode: "mock",
    necMode: "off",
    sourceStatus: "mock_only",
    publicDataAllowed: true,
  });
});

test("public pipeline now PERMITS open assembly once the license is human-approved", () => {
  // Previously this threw `open_assembly is pending_review`. After human approval the license gate no
  // longer blocks selection; the real collector is constructed only when explicitly requested.
  const selection = selectPublicPipelineCollector({
    PUBLIC_PIPELINE_COLLECTOR: "open_assembly",
    OPEN_ASSEMBLY_API_KEY: "test-key",
    OPEN_ASSEMBLY_LICENSE_NOTE: "출처: 열린국회정보, 국회의원 인적사항 (공공누리 제1유형, 출처표시), https://open.assembly.go.kr",
  });

  assert.equal(selection.mode, "open_assembly");
  assert.equal(selection.collector.sourceName, "open-assembly-public-profile");

  assert.deepEqual(publicPipelineStatus({ PUBLIC_PIPELINE_COLLECTOR: "open_assembly" }), {
    mode: "open_assembly",
    necMode: "off",
    sourceStatus: "approved",
    publicDataAllowed: true,
  });
});

test("public pipeline still requires an explicit license note when open assembly is selected", () => {
  // Approval does not waive operational guards: the license note env is still mandatory.
  assert.throws(
    () =>
      selectPublicPipelineCollector({
        PUBLIC_PIPELINE_COLLECTOR: "open_assembly",
        OPEN_ASSEMBLY_API_KEY: "test-key",
      }),
    /OPEN_ASSEMBLY_LICENSE_NOTE is required/,
  );
});

test("open assembly profile collector maps only exposable sourced records", async () => {
  const collector = new OpenAssemblyProfileCollector(
    new OpenAssemblyCollector(
      {
        apiKey: "test-key",
        baseUrl: "https://example.invalid/openapi",
        licenseNote: "fixture license",
      },
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            row: [
              { NAAS_CD: "A001", HG_NM: "홍공개", POLY_NM: "테스트정당", ORIG_NM: "서울 테스트구" },
              { POLY_NM: "이름 없는 행" },
            ],
          };
        },
      }),
      () => new Date("2026-06-11T00:00:00.000Z"),
    ),
  );

  const profiles = await collector.collect();

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0]?.politicianId, "open-assembly-A001");
  assert.equal(profiles[0]?.party[0]?.source.licenseNote, "fixture license");
});
