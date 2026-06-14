import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";

let reactAct: typeof import("react").act;

test("home search is gated with an honest interim notice", async () => {
  const { container, root, dom } = await renderHomeSearch();

  try {
    assertIncludes(container, "DATA RELEASED / SEARCH UI PAUSED");
    assertIncludes(container, "공개 데이터 산출물은 배포되어 있습니다.");
    assertIncludes(container, "FACTS");
    assertIncludes(container, "DISCREPANCIES");
    assertIncludes(container, "LATEST JSON");
    assert.equal(container.querySelector("input"), null);
    assert.equal(container.querySelector("select"), null);
    assertDoesNotInclude(container, "김공개");
    assertDoesNotInclude(container, "이투명");
  } finally {
    await cleanup(root, dom);
  }
});

async function renderHomeSearch() {
  const dom = new JSDOM("<!doctype html><html><body><main id=\"root\"></main></body></html>", {
    url: "https://example.invalid/",
  });
  defineDomGlobals(dom);

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  const [{ act, createElement }, { createRoot }, { HomeSearch }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../src/app/home-search"),
  ]);
  reactAct = act;

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(HomeSearch));
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
  assert.ok(container.textContent?.includes(text), `expected rendered text to include ${text}`);
}

function assertDoesNotInclude(container: HTMLElement, text: string) {
  assert.equal(container.textContent?.includes(text), false, `expected rendered text not to include ${text}`);
}
