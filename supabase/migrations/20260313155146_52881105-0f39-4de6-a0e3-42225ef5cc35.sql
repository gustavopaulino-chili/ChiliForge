CREATE TABLE public.generated_prompts (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(6), 'hex'),
  prompt_text TEXT NOT NULL,
  business_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert prompts"
ON public.generated_prompts
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anyone can read prompts"
ON public.generated_prompts
FOR SELECT
TO anon, authenticated
USING (true);