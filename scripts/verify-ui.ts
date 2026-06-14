import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { publicArtifactLinks } from "../src/lib/public-artifacts";
import type { PublicSnapshot } from "../src/lib/types";

const outDir = join(process.cwd(), "out");
const snapshotPath = join(process.cwd(), "public", "snapshots", "latest.json");

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as PublicSnapshot;
  const firstProfileId = snapshot.verified_facts[0]?.politician_id;
  if (!firstProfileId) throw new Error("static UI verification failed: snapshot has no profile id");

  const indexHtml = await readOut("index.html");
  const qaHtml = await readOut("qa.html");
  const detailHtml = await readOut("politicians", `${firstProfileId}.html`);
  const errors = [
    ...verifyIndex(indexHtml),
    ...verifyQa(qaHtml),
    ...verifyDetail(detailHtml),
  ];

  if (errors.length > 0) {
    throw new Error(`static UI verification failed: ${errors.join("; ")}`);
  }

  console.log("static UI verified: index, qa, politician detail");
  console.log(`static UI verified: ${publicArtifactLinks.length} public data links`);
}

function verifyIndex(html: string) {
  const errors: string[] = [];
  for (const link of publicArtifactLinks) {
    if (!html.includes(`href="${link.href}"`)) errors.push(`index is missing ${link.href}`);
    if (!html.includes(link.label)) errors.push(`index is missing ${link.label}`);
  }
  for (const requiredText of [
    "PUBLIC DATA",
    "SEARCH TEMPORARILY UNAVAILABLE",
    "검색 기능은 현재 개발 중이며, 복구되는 대로 제공할 예정입니다.",
  ]) {
    if (!html.includes(requiredText)) errors.push(`index is missing ${requiredText}`);
  }
  if (html.includes("<input") || html.includes("<select")) errors.push("index still exposes stale search controls");
  return errors;
}

function verifyQa(html: string) {
  const errors: string[] = [];
  for (const requiredText of ["RAG / CITATIONS ONLY", "관련 자료 없음", "질의응답 인터페이스를 불러오는 중입니다."]) {
    if (!html.includes(requiredText)) errors.push(`qa is missing ${requiredText}`);
  }
  return errors;
}

function verifyDetail(html: string) {
  const errors: string[] = [];
  for (const requiredText of ["PUBLIC OFFICIAL PROFILE / SNAPSHOT", "DETECTED DIFFERENCES", "출처", "인적사항"]) {
    if (!html.includes(requiredText)) errors.push(`detail is missing ${requiredText}`);
  }
  return errors;
}

async function readOut(...paths: string[]) {
  return readFile(join(outDir, ...paths), "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
