---
name: brief-full-only-for-company-calls
description: Full brandVisualBrief is only for company-assets storage; in ad GENERATION the brief is capped so ref images/brand posts drive the visual
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f9001cf2-3c7d-485b-895f-611426c9d29e
---

User's explicit design intent for ChiliForge ad generation (2026-07-03):

- The **complete** 300-400 word `brandVisualBrief` belongs ONLY to the **company calls**
  (`company-assets.php` → agents-ads `brand_visual` mode) — it's the company's stored brand
  knowledge. Keep it uncapped there (commit 1e37bc1 removed the 2000-char cap for this).
- In the **ad GENERATION** (agents-ads `compose`), the brief must be **short/capped like before
  banner261**, so the **reference images + brand posts drive the visual**, NOT the brief text.

**Why:** the uncapped brief injected into the image prompt dominated and drowned out the ref
images → every ad looked the same ("sem variação") and ignored the reference posts ("nem teve
influência dos posts de ref"). Capping restores the banner261 behaviour where the ref IMAGES
lead.

**How to apply:** In `agents-ads/index.ts` compose, `visualBrief` (read from
`campaignData.brandVisualBrief`, ~line 3331) is capped via `GEN_VISUAL_BRIEF_CAP = 2000` before
it enters `buildBackgroundPrompt`. Do NOT remove this cap thinking "the brief got truncated" —
it is intentional; the full brief lives on the company store. Related: the compose prompt also
must never tell the image model to draw the logo/brand-name (that caused invented "placeholder"
logos). See [[ad-image-model-3.1-flash]] and [[test-ads-one-at-a-time]].
