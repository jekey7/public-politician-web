import { readFile } from "node:fs/promises";
import { join } from "node:path";

const cssPath = join(process.cwd(), "src", "app", "globals.css");

// Tokens defined by DESIGN.md (Apple-style design language). Each must be present
// as a CSS custom property so component rules can reference it instead of inlining.
const requiredTokens: Record<string, string> = {
  "--primary": "#0066cc",
  "--primary-focus": "#0071e3",
  "--primary-on-dark": "#2997ff",
  "--canvas": "#ffffff",
  "--canvas-parchment": "#f5f5f7",
  "--surface-pearl": "#fafafc",
  "--surface-tile-1": "#272729",
  "--surface-tile-2": "#2a2a2c",
  "--surface-tile-3": "#252527",
  "--surface-black": "#000000",
  "--ink": "#1d1d1f",
  "--on-dark": "#ffffff",
  "--body-muted": "#cccccc",
  "--ink-muted-80": "#333333",
  "--ink-muted-48": "#7a7a7a",
  "--divider-soft": "#f0f0f0",
  "--hairline": "#e0e0e0",
};

const allowedColors = new Set([...Object.values(requiredTokens)]);

// DESIGN.md radius scale: 5 / 8 / 11 / 18 px + the 9999px pill. Plus 0/2px for hard
// edges and 1px hairline offsets that never read as a corner.
const allowedRadii = new Set(["0px", "5px", "8px", "11px", "18px", "9999px"]);

// "Apple uses exactly one drop-shadow, applied to product imagery." The single
// product shadow is the only box-shadow permitted in the system.
const productShadow = "rgba(0, 0, 0, 0.22) 3px 5px 30px 0";
const allowedBoxShadows = new Set([productShadow, "var(--product-shadow)"]);

async function main() {
  const css = await readFile(cssPath, "utf8");
  const errors = [
    ...verifyRequiredTokens(css),
    ...verifyCanvas(css),
    ...verifyNoGradients(css),
    ...verifyColorPalette(css),
    ...verifyRadiusScale(css),
    ...verifyShadowUse(css),
    ...verifyRequiredBlocks(css),
  ];

  if (errors.length > 0) {
    throw new Error(`design verification failed: ${errors.join("; ")}`);
  }

  console.log("design verified: tokens, palette, radius scale, shadows, and key component rules");
}

function verifyRequiredTokens(css: string) {
  const errors: string[] = [];
  for (const [token, value] of Object.entries(requiredTokens)) {
    if (!new RegExp(`${escapeRegExp(token)}:\\s*${escapeRegExp(value)};`, "i").test(css)) {
      errors.push(`missing design token ${token}: ${value}`);
    }
  }
  return errors;
}

function verifyCanvas(css: string) {
  const errors: string[] = [];
  const bodyBlock = getBlock(css, "html,\nbody");
  // Light-dominant: the default page canvas is parchment, ink text, SF Pro stack.
  if (!bodyBlock.includes("background: var(--canvas-parchment);")) {
    errors.push("html/body must use parchment canvas background");
  }
  if (!bodyBlock.includes("color: var(--ink);")) errors.push("html/body must use ink text color");
  if (!bodyBlock.includes("font-family: var(--font-text);")) {
    errors.push("html/body must use the SF Pro Text stack");
  }
  return errors;
}

function verifyNoGradients(css: string) {
  return /\bgradient\s*\(/i.test(css) ? ["gradients are not allowed by DESIGN.md"] : [];
}

function verifyColorPalette(css: string) {
  const errors: string[] = [];
  // Strip the documented product-shadow rgba so its components don't read as raw hex.
  const scrubbed = css.replaceAll(productShadow, "");
  const colors = Array.from(scrubbed.matchAll(/#[0-9a-fA-F]{3,8}\b/g)).map((match) => match[0].toLowerCase());
  for (const color of colors) {
    if (!allowedColors.has(color)) errors.push(`unexpected raw color ${color}`);
  }
  return Array.from(new Set(errors));
}

function verifyRadiusScale(css: string) {
  const errors: string[] = [];
  const radii = Array.from(css.matchAll(/border-radius:\s*([^;]+);/g)).map((match) => match[1]?.trim() ?? "");
  for (const radius of radii) {
    if (!allowedRadii.has(radius)) errors.push(`unexpected border-radius ${radius}`);
  }
  return Array.from(new Set(errors));
}

function verifyShadowUse(css: string) {
  const errors: string[] = [];
  const shadows = Array.from(css.matchAll(/box-shadow:\s*([^;]+);/g)).map((match) => match[1]?.trim() ?? "");
  for (const shadow of shadows) {
    if (!allowedBoxShadows.has(shadow)) errors.push(`unexpected box-shadow ${shadow}`);
  }
  return Array.from(new Set(errors));
}

function verifyRequiredBlocks(css: string) {
  const errors: string[] = [];

  // Single accent: every interactive element is Action Blue.
  expectIncludes(errors, getBlock(css, "a"), "color: var(--primary);", "links must use Action Blue");
  expectIncludes(errors, getBlock(css, ".primary-button"), "background: var(--primary);", "primary button must use Action Blue fill");
  expectIncludes(errors, getBlock(css, ".primary-button"), "border-radius: 9999px;", "primary button must use the full pill radius");
  expectIncludes(errors, getBlock(css, ".primary-button:active"), "transform: scale(0.95);", "buttons must use the scale(0.95) press micro-interaction");

  // Global nav is the one place pure black appears.
  expectIncludes(errors, getBlock(css, ".site-header"), "background: var(--surface-black);", "global nav must be true black");

  // Emphasis comes from surface alternation onto dark tiles, not a second color.
  expectIncludes(errors, getBlock(css, ".accent-card"), "background: var(--surface-tile-1);", "accent card must alternate to a dark tile surface");
  expectIncludes(errors, getBlock(css, ".warning-card"), "background: var(--surface-tile-2);", "warning card must alternate to a dark tile surface");

  // The single drop-shadow is reserved for a resting figure (the discrepancy tile).
  expectIncludes(errors, getBlock(css, ".discrepancy-tile"), "box-shadow: var(--product-shadow);", "discrepancy tile must carry the single product shadow");

  // Utility cards: flat, hairline-bordered, 18px radius.
  expectIncludes(errors, getBlock(css, ".result-card"), "border-radius: 18px;", "result cards must use the 18px utility-card radius");
  expectIncludes(errors, getBlock(css, ".result-card"), "border: 1px solid var(--hairline);", "result cards must use a hairline border");

  // Body type system: SF Pro Text at 17px with the signature negative tracking.
  const bodyBlock = getBlock(css, "html,\nbody");
  expectIncludes(errors, bodyBlock, "font-size: 17px;", "body copy must run at 17px");
  expectIncludes(errors, bodyBlock, "letter-spacing: -0.374px;", "body copy must carry the Apple-tight tracking");

  return errors;
}

function expectIncludes(errors: string[], block: string, expected: string, message: string) {
  if (!block.includes(expected)) errors.push(message);
}

function getBlock(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const bodyStart = css.indexOf("{", start);
  const bodyEnd = css.indexOf("}", bodyStart);
  return css.slice(bodyStart + 1, bodyEnd).trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
