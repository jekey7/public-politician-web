import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { PoliticianSummary } from "../src/lib/politician-summary";

let reactAct: typeof import("react").act;

const SAMPLE_POLITICIANS: PoliticianSummary[] = [
  { politicianId: "p1", displayName: "김공개", party: "민주당", district: "서울 종로구", discrepancyCount: 2 },
  { politicianId: "p2", displayName: "이투명", party: "국민의힘", district: "경기 수원갑", discrepancyCount: 0 },
];

test("home search renders politician list with filter controls", async () => {
  const { container, root, dom } = await renderHomeSearch(SAMPLE_POLITICIANS);

  try {
    assert.ok(container.querySelector("input"), "검색 input이 있어야 합니다");
    assert.ok(container.querySelector("select"), "정당 select가 있어야 합니다");
    assertIncludes(container, "김공개");
    assertIncludes(container, "이투명");
    assertIncludes(container, "민주당");
    assertIncludes(container, "국민의힘");
    assertIncludes(container, "2 불일치");
    assertIncludes(container, "2명");
  } finally {
    await cleanup(root, dom);
  }
});

test("home search filters by query", async () => {
  const { container, root, dom } = await renderHomeSearch(SAMPLE_POLITICIANS);

  try {
    const input = container.querySelector("input") as HTMLInputElement;
    assert.ok(input);
    await setInputValue(input, dom, "김공개");
    assertIncludes(container, "김공개");
    assertDoesNotInclude(container, "이투명");
  } finally {
    await cleanup(root, dom);
  }
});

async function renderHomeSearch(politicians: PoliticianSummary[]) {
  const dom = new JSDOM("<!doctype html><html><body><main id=\"root\"></main></body></html>", {
    url: "https://example.invalid/",
  });
  defineDomGlobals(dom);

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  const [{ act, createElement }, { createRoot }, { HomeSearchClient }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../src/app/home-search"),
  ]);
  reactAct = act;

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(HomeSearchClient, { politicians }));
  });

  return { container, root, dom };
}

async function setInputValue(input: HTMLInputElement, dom: JSDOM, value: string) {
  await reactAct(async () => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
    nativeInputValueSetter?.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

function defineDomGlobals(dom: JSDOM) {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "self", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: dom.window.HTMLInputElement });
  Object.defineProperty(globalThis, "HTMLSelectElement", { configurable: true, value: dom.window.HTMLSelectElement });
  Object.defineProperty(globalThis, "Event", { configurable: true, value: dom.window.Event });

  dom.window.requestIdleCallback ??= ((callback: IdleRequestCallback) => {
    const startedAt = Date.now();
    return dom.window.setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - startedAt)),
      });
    }, 0);
  }) as typeof dom.window.requestIdleCallback;
  dom.window.cancelIdleCallback ??= ((handle: number) => dom.window.clearTimeout(handle)) as typeof dom.window.cancelIdleCallback;
  dom.window.IntersectionObserver ??= class {
    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
    unobserve() {}
  } as typeof dom.window.IntersectionObserver;
}

async function cleanup(root: Root, dom: JSDOM) {
  await reactAct(async () => {
    root.unmount();
  });
  dom.window.close();
}

function assertIncludes(container: HTMLElement, text: string) {
  assert.ok(container.textContent?.includes(text), `expected rendered text to include "${text}"`);
}

function assertDoesNotInclude(container: HTMLElement, text: string) {
  assert.equal(container.textContent?.includes(text), false, `expected rendered text not to include "${text}"`);
}
