---
name: gemini-testing-key-free-tier
description: GEMINI_API_KEY_TESTING is on Google free tier — image generation quota-exhausts (429); PRODUCTION is paid
metadata: 
  node_type: memory
  type: project
  originSessionId: 91c6a15d-f8e6-486f-8d8d-7aa9746830da
---

The `.env` Gemini keys are on different Google billing tiers:

- **GEMINI_API_KEY_PRODUCTION**: paid/standard tier (`serviceTier: "standard"`). Image models (gemini-2.5-flash-image, gemini-3.1-flash-image, gemini-3-pro-image, imagen-4.0) all return 200. Works fine.
- **GEMINI_API_KEY_TESTING**: **FREE TIER** (no billing on its Google project). Text (gemini-2.5-flash) works, but image models return **429 RESOURCE_EXHAUSTED** with quota IDs ending in `-FreeTier` (GenerateRequestsPerMinute/PerDay...-FreeTier for gemini-3.1-flash-image). Free-tier image caps are tiny → exhausts almost immediately, resets per-minute/per-day.

**Why "esgotou crédito" despite having balance:** free tier ignores account balance — the quota is a rate limit tied to the tier, not money. Any credit (e.g. R$400) is likely on the PRODUCTION project, not the TESTING project. Fix: enable billing on the TESTING key's Google project (link the billing account) to move it off free tier, OR use the PRODUCTION key for image gen.

**App impact:** admin accounts use PRODUCTION (works); non-admin/testing accounts use TESTING (free tier → image gen 429). The external Ads API uses whatever `gemini_api_key` the caller passes. Related: [[ad-image-model-3.1-flash]].

Note: `.env` key values are wrapped in double quotes — strip them when reading (see [[external-ads-api-test-procedure]]).
