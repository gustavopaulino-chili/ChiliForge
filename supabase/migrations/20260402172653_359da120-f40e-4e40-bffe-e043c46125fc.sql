
DROP POLICY IF EXISTS "Anyone can read prompts" ON public.generated_prompts;
DROP POLICY IF EXISTS "Anyone can insert prompts" ON public.generated_prompts;
DROP POLICY IF EXISTS "Anyone can delete prompts" ON public.generated_prompts;
DROP POLICY IF EXISTS "Users can read own prompts" ON public.generated_prompts;
DROP POLICY IF EXISTS "Users can insert own prompts" ON public.generated_prompts;
DROP POLICY IF EXISTS "Users can delete own prompts" ON public.generated_prompts;

CREATE POLICY "Users can read own prompts" ON public.generated_prompts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own prompts" ON public.generated_prompts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own prompts" ON public.generated_prompts FOR DELETE TO authenticated USING (auth.uid() = user_id);
