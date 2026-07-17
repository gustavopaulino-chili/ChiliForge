---
name: test-ads-one-at-a-time
description: "When testing the ad-generation pipeline, generate only ONE ad per test"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5c4d42c8-a744-490c-aaf2-1efec4349d29
---

When testing the ChiliForge ad-generation pipeline (generate-ads.php → agents-ads compose), generate **only ONE ad per test run**, not batches of 3.

**Why:** The user pays per generation (image model cost) and wants to keep test spend minimal while iterating. Each ad also takes ~60–100s, so one is faster to review.

**How to apply:** POST a single job to `generate-ads.php` with `"formats":["instagram-feed-square"]`, poll job-status, download the one banner, and Read it. Don't fire 3 jobs to compare. See [[ad-image-model-3.1-flash]].
