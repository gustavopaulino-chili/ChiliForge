
Important current decisions:

- Do not automatically convert image-based ads into HTML.
- Image ads must remain image assets until the user explicitly chooses the existing "Convert to HTML" function.
- Do not break or refactor the existing HTML ad generation flow.
- Do not use deprecated Gemini models such as `gemini-2.0-flash-preview-image-generation`.
- If changing AI providers or prompts, keep image generation separate from text/copy/chat tasks.
- Keep campaign board navigation pointing to `/projects/{companyProjectId}/campaigns/{campaignId}`, not `/ads-editor`.
- Preserve current fixes for image ad saving/loading in campaign folders.

Primary goal:

Implement the future AI-powered improvements. Focus on better campaign setup, copy quality and brand context.

Priority order:

The first implementation task must be the Gemini-powered chatbot campaign setup wizard. Do this before improving prompts, brand book extraction or other AI tasks.

Tasks:

1. Turn the chatbot into a campaign setup wizard.
   - This is the first priority when Gemini quota is available again.
   - Use Gemini for the conversational interpretation and campaign setup recommendations.
   - The assistant should guide non-marketing users through campaign setup.
   - It should ask concise questions about product/service, objective, audience, offer, platforms, tone, and constraints.
   - It should produce suggested form updates, but must not silently overwrite the form.
   - Add an explicit "Apply to campaign" confirmation before changing form state.
   - Prefer integrating with the existing global chat UI only if it can access the ad creative draft safely. Otherwise create a campaign-specific assistant component for `/ad-creatives`.

2. Add real brand book/style guide analysis.
   - The current UI may accept brand book files, but verify whether extraction and store sync are truly implemented.
   - Implement upload and AI extraction if missing.
   - Extract colors, fonts, brand voice, logo guidance, visual style, forbidden usage, and key rules.
   - Save extracted data in `brandBookExtractedData` and/or the company knowledge store.
   - Show an editable extraction summary before applying it to the form.

Acceptance criteria:

- The user can complete campaign setup through the assistant and apply suggestions to the form.
- Brand book upload either performs real extraction or clearly states what is saved and what is pending.
- Campaign board and editor navigation are not regressed.
- `npm run build` passes.

Implementation style:

- Make small, testable changes.
- Keep existing patterns and naming.
- Avoid broad refactors.
- Do not touch unrelated user changes.
- After implementation, run `npm run build` and report any backend functions that need deployment.
