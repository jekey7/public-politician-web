import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const outDir = join(process.cwd(), "out");

interface PageTarget {
  label: string;
  path: string[];
}

const pages: PageTarget[] = [
  { label: "home", path: ["index.html"] },
  { label: "qa", path: ["qa.html"] },
  { label: "politician mock-001", path: ["politicians", "mock-001.html"] },
  { label: "politician mock-002", path: ["politicians", "mock-002.html"] },
];

async function main() {
  const errors = (await Promise.all(pages.map(verifyPage))).flat();

  if (errors.length > 0) {
    throw new Error(`accessibility verification failed: ${errors.join("; ")}`);
  }

  console.log(`accessibility verified: ${pages.length} static pages`);
}

async function verifyPage(page: PageTarget) {
  const html = await readFile(join(outDir, ...page.path), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const errors: string[] = [];

  if (document.documentElement.lang !== "ko") errors.push(`${page.label} html lang must be ko`);
  if (!document.title.trim()) errors.push(`${page.label} title is missing`);
  if (document.querySelectorAll("main").length !== 1) errors.push(`${page.label} must contain exactly one main landmark`);
  if (document.querySelectorAll("h1").length !== 1) errors.push(`${page.label} must contain exactly one h1`);

  verifyNamedNavs(document, page.label, errors);
  verifyControls(document, page.label, errors);
  verifyLinks(document, page.label, errors);
  verifyButtons(document, page.label, errors);
  verifyImages(document, page.label, errors);

  dom.window.close();
  return errors;
}

function verifyNamedNavs(document: Document, pageLabel: string, errors: string[]) {
  document.querySelectorAll("nav").forEach((nav, index) => {
    if (!accessibleName(nav)) errors.push(`${pageLabel} nav ${index + 1} needs an accessible name`);
  });
}

function verifyControls(document: Document, pageLabel: string, errors: string[]) {
  document.querySelectorAll("input, select, textarea").forEach((control, index) => {
    if (!accessibleName(control)) errors.push(`${pageLabel} form control ${index + 1} needs an accessible name`);
  });
}

function verifyLinks(document: Document, pageLabel: string, errors: string[]) {
  document.querySelectorAll("a").forEach((link, index) => {
    const name = accessibleName(link);
    if (!name) errors.push(`${pageLabel} link ${index + 1} needs link text or aria-label`);
    if (link.getAttribute("target") === "_blank") {
      const relValues = (link.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean);
      if (!relValues.includes("noreferrer")) {
        errors.push(`${pageLabel} external link "${name || index + 1}" needs rel="noreferrer"`);
      }
    }
  });
}

function verifyButtons(document: Document, pageLabel: string, errors: string[]) {
  document.querySelectorAll("button").forEach((button, index) => {
    if (!accessibleName(button)) errors.push(`${pageLabel} button ${index + 1} needs button text or aria-label`);
  });
}

function verifyImages(document: Document, pageLabel: string, errors: string[]) {
  document.querySelectorAll("img").forEach((image, index) => {
    if (!image.hasAttribute("alt")) errors.push(`${pageLabel} image ${index + 1} needs alt text`);
  });
}

function accessibleName(element: Element) {
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = element.getAttribute("aria-labelledby")?.trim();
  if (ariaLabelledBy) {
    const labelledByText = ariaLabelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (labelledByText) return labelledByText;
  }

  if (isFormControl(element)) {
    const id = element.getAttribute("id");
    if (id) {
      const explicitLabel = element.ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`)?.textContent?.trim();
      if (explicitLabel) return explicitLabel;
    }

    const wrappingLabel = element.closest("label")?.textContent?.trim();
    if (wrappingLabel) return wrappingLabel;
  }

  return element.textContent?.trim() ?? "";
}

function isFormControl(element: Element) {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
}

function cssEscape(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
