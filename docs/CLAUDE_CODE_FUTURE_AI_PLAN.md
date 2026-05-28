# Claude Code Future AI Plan Prompt

Use this prompt later in Claude Code when AI/Gemini quota is available again.

---

You are working in the ChiliForge project. Before editing, inspect the current codebase and preserve existing behavior unless a task explicitly requires changing it. The app has React/Vite frontend, PHP API endpoints, Supabase Edge Functions, campaign boards, ad creative generation, image ads, HTML ads, global/company knowledge stores, and campaign memory.

Important current decisions:

- Do not automatically convert image-based ads into HTML.
- Image ads must remain image assets until the user explicitly chooses the existing "Convert to HTML" function.
- Do not break or refactor the existing HTML ad generation flow.
- Do not use deprecated Gemini models such as `gemini-2.0-flash-preview-image-generation`.
- If changing AI providers or prompts, keep image generation separate from text/copy/chat tasks.
- Keep campaign board navigation pointing to `/projects/{companyProjectId}/campaigns/{campaignId}`, not `/ads-editor`.
- Preserve current fixes for image ad saving/loading in campaign folders.

Primary goal:

Implement the future AI-powered improvements that were deferred while quota was unavailable. Focus on better campaign setup, copy quality, brand context, and generation consistency.

Priority order:

The first implementation task must be the Gemini-powered chatbot campaign setup wizard. Do this before improving prompts, brand book extraction, memory, or other AI tasks.

Tasks:

1. Turn the chatbot into a campaign setup wizard.
   - This is the first priority when Gemini quota is available again.
   - Use Gemini for the conversational interpretation and campaign setup recommendations.
   - The assistant should guide non-marketing users through campaign setup.
   - It should ask concise questions about product/service, objective, audience, offer, platforms, tone, and constraints.
   - It should produce suggested form updates, but must not silently overwrite the form.
   - Add an explicit "Apply to campaign" confirmation before changing form state.
   - Prefer integrating with the existing global chat UI only if it can access the ad creative draft safely. Otherwise create a campaign-specific assistant component for `/ad-creatives`.

2. Improve AI copy generation and approval.
   - Strengthen the copy generation prompt/schema for ad copy.
   - Generate main headline, subheadline, CTA, and A/B variants.
   - Align copy with objective, funnel stage, offer, urgency, tone, audience pains/desires, forbidden words, and brand voice.
   - Keep the current copy approval step: users must be able to review/edit copy before visual generation.
   - Add validation for max lengths, CTA clarity, forbidden words, and objective/funnel mismatch.

3. Add real brand book/style guide analysis.
   - The current UI may accept brand book files, but verify whether extraction and store sync are truly implemented.
   - Implement upload and AI extraction if missing.
   - Extract colors, fonts, brand voice, logo guidance, visual style, forbidden usage, and key rules.
   - Save extracted data in `brandBookExtractedData` and/or the company knowledge store.
   - Show an editable extraction summary before applying it to the form.

4. Improve objective-based recommendations.
   - Use campaign objective and funnel stage to recommend formats, CTAs, urgency, tone, and creative strategy.
   - The recommendation can combine deterministic local rules plus AI explanation.
   - Do not force recommendations; provide "Apply recommended" controls.
   - Make recommendations visible in the form and in the review step.

5. Reconfigure memory/system context for consistency.
   - Review global ads guidelines, company store usage, campaign memory, approved examples, and feedback learning.
   - Improve the hierarchy:
     1. explicit campaign facts,
     2. approved user copy,
     3. company brand store / brand book,
     4. campaign memory and good examples,
     5. global ads guidelines.
   - Make conflicts explicit in prompts.
   - Ensure prompts avoid generic, weak, or vague copy.

6. Improve quota/provider resilience.
   - If AI quota is unavailable, show a friendly error and keep local/manual workflows available.
   - Avoid raw provider errors in the main UX.
   - Consider adding provider abstraction only if it fits the existing backend cleanly.

Acceptance criteria:

- The user can complete campaign setup through the assistant and apply suggestions to the form.
- The user can review/approve/edit AI copy before visual generation.
- Brand book upload either performs real extraction or clearly states what is saved and what is pending.
- Objective/funnel recommendations are visible, useful, and optional.
- Image ads remain images unless the user explicitly converts them.
- HTML ads continue working as before.
- Campaign board and editor navigation are not regressed.
- `npm run build` passes.

Suggested files to inspect first:

- `src/pages/AdCreatives.tsx`
- `src/pages/CampaignScreen.tsx`
- `src/components/GlobalChatButton.tsx`
- `src/components/ad-generator/StepAdCopyAI.tsx`
- `src/components/ad-generator/StepAdImport.tsx`
- `src/components/ad-generator/StepAdObjective.tsx`
- `src/components/ad-generator/StepAdPlatform.tsx`
- `src/components/ad-generator/StepAdReview.tsx`
- `src/types/adCreativeForm.ts`
- `src/services/api.ts`
- `api/v1/agents/*.php`
- `supabase/functions/agents-ads/index.ts`
- `guidelines/`
- `database.sql`

Implementation style:

- Make small, testable changes.
- Keep existing patterns and naming.
- Avoid broad refactors.
- Do not touch unrelated user changes.
- After implementation, run `npm run build` and report any backend functions that need deployment.
