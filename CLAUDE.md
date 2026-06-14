# CLAUDE.md

Operating charter for agents developing the Korean National Assembly member information platform.

This document is an **open operating charter**. It does not pin down the deliverables or scope of any specific MVP. Instead, it defines the **principles** and **ways of working** that remain unchanged no matter how far the project expands. When a new idea or feature outside the planned scope is proposed, it is handled within the operating model of this document — as long as it honors the principles in Chapter 0.

The single source of truth for product planning is `DOCUMENT.md`. However, `DOCUMENT.md` is a **snapshot** of the scope at the current point in time, whereas this document is the **higher-order rule** that applies regardless of time. A new idea going beyond the scope of `DOCUMENT.md` is not blocked. The only thing blocked is a violation of the Chapter 0 principles.

---

## 0. Invariants

No matter how the project expands, the following do not change. This is the identity of the service. New features and ideas may be added freely **as long as they satisfy** these principles, and are **rejected** — however attractive — if they **violate** them.

1. **AI does not generate facts.** The LLM does only the following kinds of work: entity matching, inconsistency classification, and citation-grounded responses (RAG). It does not manufacture new facts through summarization, narration, evaluation, or inference.
   — *Decision criterion when adding a new AI feature: "Does this feature create a fact that did not previously exist?" If so, reject.*
2. **Data without a source is not exposed.** Every fact displayed is accompanied by source metadata (`source_url`, `source_org`, `fetched_at`, etc.).
3. **If we don't know, we say we don't know.** When there is no evidence to cite, do not guess — respond with "No relevant data."
4. **Inconsistencies are surfaced, not merged.** When values differ across sources, do not pick or combine them; present all sources together. Judgment is left to the user.
5. **Data of different natures is not mixed.** Separate "facts that require verification" from "external reference content." (Currently: cross-verified data / news feed. This separation principle applies even if new data types arise.)
6. **Others' content is not rehosted.** External originals and images are only linked, embedded, or referenced.
7. **Only the public information of public figures is published.** Private information is not handled.
8. **Objectivity is proof, not assertion.** Keep code, data, sources, and the verification process in a publishable state. (Open-source premise: code under MIT/Apache 2.0, data under CC BY or other compatible licenses.)

> When in doubt, do not proceed — surface the decision and let a human judge.
> Principles are not relaxed by assumptions.

---

## 1. How Expansion Ideas Are Handled (Open Intake)

This project is not closed. Ideas outside the planned scope may enter at any time, and are welcome. When a new idea or feature is proposed, it passes through the following gates.

1. **Principle fit** — Does it violate the Chapter 0 invariants? If so, reject and record the reason. If not, it passes (expansion is allowed by default).
2. **Classification** — Decide where the idea belongs: new data type / new screen / new AI use / new data source / operations & deployment improvement, etc. If it fits nowhere, create a new category.
3. **Impact scope** — Record the impact on the existing data model and interfaces.
4. **Incorporation** — Ideas that pass are put on the work loop (Chapter 2) and implemented incrementally. If needed, propose reflecting it into `DOCUMENT.md` as new scope (this document does not need to be modified).

> Principle: **Expansion is allowed by default; only principle violations are blocked.** Scope is treated as something that can grow.

---

## 2. Agent Team (max 3)

| Agent | Role | Responsibilities |
| --- | --- | --- |
| **Architect** | Design | Structure/interface design, recording decision rationale (ADR), task decomposition, impact analysis of expansion ideas |
| **Implementer** | Implementation | Writing per the design/plan, incorporating review feedback |
| **Reviewer** | Review | Verifying Chapter 0 principle compliance, checking correctness/edge cases, issuing fix instructions |

Keep the roles separate. The same agent does not pass its own output. The Reviewer treats **Chapter 0 principle compliance** as the top priority for any task.

---

## 3. Work Loop

Every task repeats the following. Do not try to finish something big in one shot; grow it incrementally.

```
Design (Architect) → Plan (Architect→Implementer) → Implement (Implementer) → Review (Reviewer) → Fix (Implementer)
```

- If a serious principle violation is found, passing is prohibited. Re-review after fixing.
- At the end of each iteration, the Reviewer summarizes **what is confirmed / what remains / recommendation for the next iteration**.
- This loop applies equally to the MVP and to any expansion beyond it.

---

## 4. Working Guidelines (time-independent)

The following is not a list of deliverables but **work habits that apply no matter what is built**.

- **Store sources coupled** — Always store fact values bound to their source metadata. Never store values alone.
- **Preserve multiple sources** — Maintain a structure that can preserve differing source values for the same item (so inconsistencies can be represented).
- **Represent review status** — Keep the trust level of data (e.g., verified / under review) expressible.
- **Mock first** — When real data or API keys are unavailable, build the skeleton with interfaces + mocks and leave integration points as `TODO`.
- **State assumptions** — Do not arbitrarily fill ambiguous points; mark them as `ASSUMPTION` and then proceed (principles are the exception).
- **Separate secrets** — Do not hardcode keys/tokens; separate them into environment variables.
- **Small units** — One change/PR does one thing.
- **Stay publishable** — Surface license-incompatible dependencies before introducing them.
- **Hand-off ready** — Leave decision rationale so others can take over.

---

## 5. Current Technical Foundation (extensible)

> This section is not fixed but a current choice. If a better choice is proposed, it can be replaced within the Chapter 0 principles.

- **Frontend:** Next.js (React-based), static generation first. Premise of nonprofit / free tier / minimized server cost.
- **AI:** LLM (entity matching / inconsistency classification) + RAG (citation responses).
- **Data:** Public API collection + review, source metadata tracking, periodic snapshot (CSV/JSON) releases.
- **Sources (current):** Open Assembly Information API, Public Data Portal, Constitutional Council (헌정회), National Election Commission, news search APIs / RSS. Adding new sources goes through the Chapter 1 gate.

---

## 6. Review Perspective (Reviewer)

Not fixed to a specific checklist. No matter what is built, the Reviewer looks through the following **questions**.

- Does this change avoid creating facts that did not exist?
- Does every exposed fact have a source attached?
- Is it handled as "unknown" when there is no evidence?
- Are inconsistencies surfaced rather than merged?
- Is the separation of data natures maintained?
- Is others' content not rehosted?
- Is the publishable (license/source) state maintained?
- If it is an expansion idea, did it pass the Chapter 1 gate?

When a new feature type arises, **add** matching questions to this perspective (do not shrink it).

---

## 7. Commands

> Update this section after the project setup is finalized. The following is a skeleton.

```bash
npm install      # dependencies
npm run dev      # development server
npm run build    # static build
npm test         # tests
npm run lint     # lint
```

Before finishing work, run at least the tests and lint, and include the results in the review.
