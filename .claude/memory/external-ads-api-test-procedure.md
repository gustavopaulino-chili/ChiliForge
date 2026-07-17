---
name: external-ads-api-test-procedure
description: "How to run an external Ads API generation test end-to-end (submit, poll, download to ad-tests)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 91c6a15d-f8e6-486f-8d8d-7aa9746830da
---

Standard way to run an external Ads API generation test on ChiliForge:

1. **Endpoint (LIVE only):** `POST https://forge.chili.pa/api/v1/external/generate-ads.php`. The test server (testforge.chili.pa) rejects the api_key with "Invalid or inactive API key" — the api_key + company + reference posts live on the LIVE DB.
2. **Auth:** `Authorization: Bearer <cf_… api_key>` (api_key also accepted in body). Test key: **NÃO commitar aqui** — guardar no cofre/Drive junto das credenciais de deploy (ver TRABALHANDO-COM-CLAUDE.md). No ambiente local do dono, a chave de teste fica anotada na memória viva (`~/.claude-conta1/.../memory/`), fora do repo.
3. **gemini_api_key:** read from `.env`. ⚠️ The `.env` values are WRAPPED IN DOUBLE QUOTES — strip surrounding quotes before sending (`.replace(/^["']|["']$/g,'')`), otherwise Google returns `API_KEY_INVALID` at the agents-store step. `GEMINI_API_KEY_PRODUCTION` works. NEVER print the key — redact it from all output.
4. **Payload:** `generation_type:"image"`, `phone` identifies the existing company (e.g. Chili Agency = `+5511943239843`), `company`/`campaign` objects, `formats` as preset strings (e.g. `instagram-feed-square`). Generate ONE format per run (cost) — see [[test-ads-one-at-a-time]].
   - ⚠️ **The generation-time hero reference image goes INSIDE the `campaign` object as `campaign.reference_image`** (aliases: `reference_image_url`/`creative_reference`/`inspiration_image`), read by `ext_map_campaign()` in `api/v1/external/generate-ads.php:242` from `$cam`. If you put `reference_image` at the TOP LEVEL of the payload it is SILENTLY IGNORED → no hero ref → the pipeline falls back to Pexels-auto / an invented person, so the output person will NOT match your ref and will vary every run. This exact mistake made jobs 225–233 come out with random people; moving it into `campaign` (job 234) immediately featured the real ref person.
   - A real ref-based image ad costs ~**$0.07** (not ~$0.046): sending a ref triggers the `gemini-3.5-flash` interpret_image planning call (~+$0.025). No-ref ads skip it.
5. **Async flow:** endpoint returns `202 {job_id, status_url}`. Poll `GET /api/v1/external/job-status.php?api_key=…&job_id=…` every ~12s until `status` is `completed`/`failed`. Creatives arrive in `creatives[].image_url` (and `html_url`).
6. **Download:** save each `image_url` into `ad-tests/` (repo root). Label files with an incrementing test number so nothing is overwritten — see [[ads-test-run-counter]].

Reusable scratchpad scripts: `testgen.js` (submit) and `poll.js` (poll + download). Image model / secrets: [[ad-image-model-3.1-flash]].
