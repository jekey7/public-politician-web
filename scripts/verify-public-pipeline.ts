import {
  assertSourceApprovedForPublicPipeline,
  publicPipelineStatus,
  selectPublicPipelineCollector,
} from "../src/lib/public-pipeline";
import { sourceLicensePolicies } from "../src/lib/source-license";

function main() {
  // 1. The real safety guarantee: the DEFAULT collector is mock. Human approval of open_assembly
  //    (2026-06-13) does NOT change this — real collection requires an explicit env opt-in.
  const defaultSelection = selectPublicPipelineCollector({});
  if (defaultSelection.mode !== "mock") {
    throw new Error(`default public pipeline collector must be mock, got ${defaultSelection.mode}`);
  }
  const defaultStatus = publicPipelineStatus({});
  if (defaultStatus.mode !== "mock" || defaultStatus.sourceStatus !== "mock_only") {
    throw new Error(`default public pipeline status must be mock_only, got ${JSON.stringify(defaultStatus)}`);
  }

  // 2. open_assembly is now human-approved: status reports approved + allowed, and selection is PERMITTED.
  const openAssemblyStatus = publicPipelineStatus({ PUBLIC_PIPELINE_COLLECTOR: "open_assembly" });
  if (openAssemblyStatus.sourceStatus !== "approved" || !openAssemblyStatus.publicDataAllowed) {
    throw new Error(`open_assembly must report approved + allowed, got ${JSON.stringify(openAssemblyStatus)}`);
  }
  assertOpenAssemblyNowPermitted();

  // 3. The gate is still live for the OTHER sources: a still-pending source stays blocked.
  assertPendingSourceStillBlocked();

  console.log(
    "public pipeline verified: default stays mock; open_assembly human-approved (permitted); other sources still gated",
  );
}

function assertOpenAssemblyNowPermitted() {
  // Previously threw `open_assembly is pending_review`. After human approval, selection succeeds.
  const selection = selectPublicPipelineCollector({
    PUBLIC_PIPELINE_COLLECTOR: "open_assembly",
    OPEN_ASSEMBLY_API_KEY: "fixture-key",
    OPEN_ASSEMBLY_LICENSE_NOTE: "출처: 열린국회정보, 국회의원 인적사항 (공공누리 제1유형, 출처표시), https://open.assembly.go.kr",
  });
  if (selection.mode !== "open_assembly") {
    throw new Error(`approved open_assembly selection must succeed, got mode ${selection.mode}`);
  }
}

function assertPendingSourceStillBlocked() {
  // The license gate must still PASS the human-approved source.
  try {
    assertSourceApprovedForPublicPipeline("open_assembly");
  } catch {
    throw new Error("approved open_assembly must pass assertSourceApprovedForPublicPipeline");
  }

  // nec is now human-approved too (2026-06-13, dataset 15000864) — license gate must PASS it.
  if (sourceLicensePolicies.nec.status !== "approved") {
    throw new Error(`nec must be approved (human 2026-06-13); got ${sourceLicensePolicies.nec.status}`);
  }

  // ...and the remaining sources must stay pending_review (only the two human-approved ones flipped).
  const stillPending = ["public_data_portal", "rokps", "news_search", "rss", "manual_review"] as const;
  for (const kind of stillPending) {
    if (sourceLicensePolicies[kind].status !== "pending_review") {
      throw new Error(`${kind} must stay pending_review; got ${sourceLicensePolicies[kind].status}`);
    }
  }
}

main();
