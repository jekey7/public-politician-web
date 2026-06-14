import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";

let reactAct: typeof import("react").act;

test("qa search renders citation-backed answers", async () => {
  const { container, root, dom } = await renderQaSearch("행정학과");

  try {
    await waitForText(container, "아래 출처에서 질문과 관련된 공개 자료가 확인되었습니다.");
    assertIncludes(container, "열린국회정보 목");
    assertIncludes(container, "EVIDENCE ev-edu-oa");
  } finally {
    await cleanup(root, dom);
  }
});

test("qa search renders the fixed no-material response", async () => {
  const { container, root, dom } = await renderQaSearch("지원하지않는질문");

  try {
    await waitForText(container, "관련 자료 없음");
    assertDoesNotInclude(container, "EVIDENCE ");
  } finally {
    await cleanup(root, dom);
  }
});

async function renderQaSearch(question: string) {
  const dom = new JSDOM("<!doctype html><html><body><main id=\"root\"></main></body></html>", {
    url: `https://example.invalid/qa?q=${encodeURIComponent(question)}`,
  });
  defineDomGlobals(dom);

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  const [{ act, createElement }, { createRoot }, { QaSearch }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../src/app/qa/qa-client"),
  ]);
  reactAct = act;

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QaSearch, { question }));
  });

  return { container, root, dom };
}

function defineDomGlobals(dom: JSDOM) {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "self", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: dom.window.HTMLInputElement });
  Object.defineProperty(globalThis, "Event", { configurable: true, value: dom.window.Event });
}

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await reactAct(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  assertIncludes(container, text);
}

async function cleanup(root: Root, dom: JSDOM) {
  await reactAct(async () => {
    root.unmount();
  });
  dom.window.close();
}

function assertIncludes(container: HTMLElement, text: string) {
  assert.ok(container.textContent?.includes(text), `expected rendered text to include ${text}`);
}

function assertDoesNotInclude(container: HTMLElement, text: string) {
  assert.equal(container.textContent?.includes(text), false, `expected rendered text not to include ${text}`);
}
