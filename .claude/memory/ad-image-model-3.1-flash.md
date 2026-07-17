---
name: ad-image-model-3-1-flash
description: ChiliForge ad-image generation runs on gemini-3.1-flash-image (set via Supabase secret GEMINI_IMAGE_MODELS)
metadata: 
  node_type: memory
  type: project
  originSessionId: 5c4d42c8-a744-490c-aaf2-1efec4349d29
---

As of 2026-06-25 the ad-image generation model is **gemini-3.1-flash-image**, configured via the Supabase secret `GEMINI_IMAGE_MODELS` (read at edge-function boot in `agents-ads/index.ts`; the code keeps `gemini-2.5-flash-image` as a hardcoded fallback in the list).

**Why:** It is cleaner than the old `gemini-2.5-flash-image` (no spurious burned-in text/logo) while costing less than `gemini-3-pro-image`. Confirmed real cost ~$0.10/ad (input $0.50/1M, images $60/1M per Google pricing) vs ~$0.04 for 2.5 and ~$0.13–0.16 for 3-pro.

**How to apply:** To change the image model, `npx supabase secrets set GEMINI_IMAGE_MODELS=<model>` then redeploy `agents-ads` (boot-time read). Text/placement uses `gemini-3-pro-preview` (the `pickCalmTextZone` step). Per-model prices live in `GEMINI_PRICING` + `GEMINI_IMAGE_OUT_PER_1M`. Test changes with [[test-ads-one-at-a-time]].
