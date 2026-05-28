const API = "/api";
const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const normalizeAccountType = (value: unknown): "admin" | "user" =>
  value === "admin" ? "admin" : "user";

const getStoredAccountType = (): "admin" | "user" => {
  try {
    const storedUser = localStorage.getItem("user");
    if (!storedUser) return "user";

    const parsedUser = JSON.parse(storedUser);
    return normalizeAccountType(parsedUser?.accountType);
  } catch {
    return "user";
  }
};

type InvokeAiOptions = {
  accountType?: "admin" | "user";
};

const readJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const contentType = response.headers.get("content-type") || "";
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(
      contentType.includes("text/html") || text.trim().startsWith("<")
        ? `Server returned HTML instead of JSON (${response.status}). ${snippet}`
        : `Server returned invalid JSON (${response.status}). ${snippet}`,
    );
  }
};

const postApi = async <T>(path: string, payload: unknown): Promise<T> => {
  const response = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await readJson(response);
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as T;
};

const invokeAiFunction = async <T>(name: string, payload: unknown, options?: InvokeAiOptions): Promise<T> => {
  const accountType = options?.accountType || getStoredAccountType();
  const enrichedPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), accountType }
    : payload;

  const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(enrichedPayload),
  });

  const text = await response.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok || data?.error) {
    const baseMessage = data?.details || data?.error || `Request failed with status ${response.status}`;
    const retryAfterSeconds = Number(data?.retryAfterSeconds);
    const retryHint = response.status === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? ` Try again in about ${Math.ceil(retryAfterSeconds)}s.`
      : "";
    throw new Error(`${baseMessage}${retryHint}`);
  }

  return data as T;
};

export const login = (email: string, pwd: string) =>
  fetch(`${API}/login.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pwd }),
  }).then(res => res.json());

export const register = (email: string, pwd: string) =>
  fetch(`${API}/register.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pwd }),
  }).then(res => res.json());

export const getProjects = (user_id: number, user_email?: string) => {
  const params = new URLSearchParams({ user_id: String(user_id) });
  if (user_email && user_email.trim()) {
    params.set('user_email', user_email.trim());
  }

  return fetch(`${API}/getProjects.php?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  }).then(res => res.json());
};

export const getProjectById = async (projectId: number, userId: number, userEmail?: string) => {
  const params = new URLSearchParams({
    user_id: String(userId),
    id: String(projectId),
  });
  if (userEmail?.trim()) {
    params.set('user_email', userEmail.trim());
  }

  const response = await fetch(`${API}/getProjects.php?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch project: ${response.status}`);
  }

  const data = await response.json();
  // When fetching by ID, getProjects returns an array with one item
  return (Array.isArray(data) && data.length > 0 ? data[0] : null) as ({
    id: number;
    user_id?: number;
    name?: string;
    public_url?: string;
    project_public_url?: string;
    lp_public_url?: string;
    ad_public_url?: string;
    folder_path?: string;
    form_data?: any;
    generated_html?: string;
    has_generated_html?: boolean;
    current_step?: number;
    currentStep?: number;
    company_form_data?: any;
    context?: string;
    project_type?: string;
  } | null);
};

export const getProjectEditorContent = async (projectId: number, userId: number) => {
  const params = new URLSearchParams({
    project_id: String(projectId),
    user_id: String(userId),
  });

  const response = await fetch(`${API}/getProjectEditorContent.php?${params.toString()}`);
  const data = await readJson(response);
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as {
    success: boolean;
    html: string;
    source: 'database' | 'published-files';
    project: {
      id: number;
      name: string;
      public_url?: string;
      folder_path?: string;
    };
  };
};

export const updateCompanyProject = (payload: {
  id: number;
  user_id: number;
  name: string;
  company_form_data: any;
  context: string;
}) => postApi<{ success: boolean; id: number }>('updateCompanyProject.php', payload);

export const moveProjectToCompany = (payload: {
  project_id: number;
  user_id: number;
  company_project_id: number;
}) => postApi<{ success: boolean; id: number; company_project_id: number; public_url?: string; folder_path?: string }>('moveProjectToCompany.php', payload);

export const createProject = (data: any) =>
  fetch(`${API}/createProject.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(res => res.json());

export const deleteProject = (id: number) =>
  fetch(`${API}/deleteProject.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).then(res => res.json());

export const updateProjectContent = (payload: { id: number; user_id: number; generated_html: string }) =>
  fetch(`${API}/updateProjectContent.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }
    return data;
  });

export const getAdCreative = async (creativeId: number, userId: number) => {
  const params = new URLSearchParams({
    id: String(creativeId),
    user_id: String(userId),
  });

  const response = await fetch(`${API}/getAdCreative.php?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
  return data.creative as {
    id: number;
    project_id: number;
    campaign_id: number;
    user_id?: number;
    name: string;
    public_url?: string;
    html: string;
    platform?: string;
    format?: string;
    label?: string;
    width?: number;
    height?: number;
    form_data?: {
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      textColor?: string;
      backgroundColor?: string;
    } | null;
    project_type?: string;
  };
};

export const getAdCreatives = async (projectId: number, userId: number) => {
  const params = new URLSearchParams({
    project_id: String(projectId),
    user_id: String(userId),
  });

  const response = await fetch(`${API}/getAdCreatives.php?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
  return (Array.isArray(data.creatives) ? data.creatives : []) as Array<{
    id: number;
    creative_id: number;
    project_id: number;
    campaign_id: number;
    name: string;
    generated_html?: string;
    public_url?: string;
    url?: string;
    image_url?: string;
    is_image_mode?: boolean;
    platform?: string;
    format?: string;
    label?: string;
    width?: number;
    height?: number;
    sort_order?: number;
    created_at?: string;
    updated_at?: string;
  }>;
};

export const updateAdCreativeContent = (payload: { id: number; user_id: number; html: string }) =>
  fetch(`${API}/updateAdCreativeContent.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }
    return data;
  });

export const updateAdCampaignBoard = (payload: { project_id: number; user_id: number; html: string }) =>
  fetch(`${API}/updateAdCampaignBoard.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }
    return data;
  });

export const deleteAdCreative = (payload: { id: number; user_id: number }) =>
  fetch(`${API}/deleteAdCreative.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }
    return data;
  });

export const updateProjectStep = (payload: { id: number; user_id: number; current_step: number; project_type?: string }) =>
  fetch(`${API}/updateProjectStep.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }
    return data;
  });

export const updateProjectFormState = (payload: { id: number; user_id: number; current_step: number; form_data: unknown; project_type?: string }) =>
  fetch(`${API}/updateProjectFormState.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }
    return data;
  });

export type ProjectAsset = {
  name: string;
  url: string;
  size: number;
  modifiedAt: number;
};

export const getProjectAssets = async (projectId: number, userId: number) => {
  const params = new URLSearchParams({
    project_id: String(projectId),
    user_id: String(userId),
  });

  const response = await fetch(`${API}/getProjectAssets.php?${params.toString()}`, {
    method: "GET",
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; assets: ProjectAsset[]; assetsPublicUrl?: string };
};

export const uploadProjectAssets = async (projectId: number, userId: number, files: File[]) => {
  const formData = new FormData();
  formData.append("project_id", String(projectId));
  formData.append("user_id", String(userId));
  files.forEach((file) => formData.append("files[]", file));

  const response = await fetch(`${API}/uploadProjectAsset.php`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; uploaded: ProjectAsset[]; skipped?: Array<{ name?: string; url?: string; reason: string }> };
};

export const uploadProjectAssetsFromUrls = async (
  projectId: number,
  userId: number,
  sourceUrls: string[],
  sourceNames?: string[],
  options?: { overwriteExisting?: boolean },
) => {
  const formData = new FormData();
  formData.append("project_id", String(projectId));
  formData.append("user_id", String(userId));
  if (options?.overwriteExisting) {
    formData.append("replace_existing", "1");
  }

  sourceUrls.forEach((url) => formData.append("source_urls[]", url));
  (sourceNames || []).forEach((name) => formData.append("source_names[]", name));

  const response = await fetch(`${API}/uploadProjectAsset.php`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; uploaded: ProjectAsset[]; skipped?: Array<{ url: string; reason: string }> };
};

export const deleteProjectAssetFile = async (projectId: number, userId: number, fileName: string) => {
  const response = await fetch(`${API}/deleteProjectAsset.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
      file_name: fileName,
    }),
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; deleted: string };
};

export const downloadProjectZip = async (projectId: number, userId: number, fallbackName = "project") => {
  const params = new URLSearchParams({
    project_id: String(projectId),
    user_id: String(userId),
  });

  const response = await fetch(`${API}/downloadProjectZip.php?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    let errorMessage = `Failed to download project zip (status ${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.details) errorMessage = payload.details;
      else if (payload?.error) errorMessage = payload.error;
    } catch {
      // Keep default message when response is not JSON.
    }
    throw new Error(errorMessage);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = `${fallbackName || "project"}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
};

export const generatePreset = (description: string) =>
  invokeAiFunction<{ preset: string; sections: Array<{ name: string; description: string; required: boolean }> }>("generate-preset", { description }, { accountType: "user" });

export const generateSections = (description: string) =>
  invokeAiFunction<{ preset: string; sections: Array<{ name: string; description: string; required: boolean }> }>("generate-preset", { description }, { accountType: "user" });

export const parseSpreadsheet = (sheetData: string, context?: string) =>
  invokeAiFunction<{ extracted: Record<string, unknown> }>("parse-spreadsheet", { sheetData, context });

export const scrapeWebsite = async (url: string, debug = false, context?: string) => {
  const accountType = getStoredAccountType();

  try {
    return await invokeAiFunction<{ extracted: Record<string, unknown>; cached?: boolean; stale?: boolean; debug?: Record<string, unknown> }>(
      "scrape-website",
      { url, debug, context },
      { accountType },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const shouldFallbackToPhp = /rate limit exceeded|status 429|status 503|status 502|transport error|unavailable|timed out|failed to fetch|not recognizable html|gateway/i.test(message);

    if (!shouldFallbackToPhp) {
      throw error;
    }

    return await postApi<{ extracted: Record<string, unknown>; cached?: boolean; stale?: boolean; fallback?: boolean; debug?: Record<string, unknown> }>(
      "scrapeWebsite.php",
      {
        url,
        accountType,
      },
    );
  }
};

export const searchImages = (query: string, count = 3) =>
  invokeAiFunction<{ images: Array<{ url: string; alt?: string }> }>("search-images", { query, count });

export const generateImages = (payload: Record<string, unknown>) =>
  invokeAiFunction<{ imageUrl: string; fallback?: boolean; reason?: string; provider?: string; model?: string }>("generate-images", payload);

export const generateLanding = async (payload: {
  prompt: string;
  businessName: string;
  mandatorySections?: Array<{ name: string; kind: string; required: boolean; description: string }>;
  formData?: {
    landingPreset?: string;
    generationObjective?: string;
    sessionsObjectiveContext?: string;
    theme: { style: string; primary: string; secondary: string; accent: string; background: string; text: string; headingFont: string; bodyFont: string };
    images: { logo: string; hero: string; sections: string[]; about: string; team: string; products: string[] };
    imageContexts?: {
      heroImage1?: string;
      heroImage2?: string;
      sectionImage1?: string;
      sectionImage2?: string;
      sectionImage3?: string;
      aboutImage?: string;
      teamImage?: string;
      brandImage?: string;
    };
    services: string[];
    differentiators: string[];
    contact: { email: string; phone: string; whatsapp: string };
    location?: { city: string; country: string };
    language: string;
    conversionGoal: string;
    guarantee: string;
    urgencyLevel?: string;
    countdownTimer?: boolean;
    brandPersonality?: string;
    toneOfVoice?: string;
    useAiImages?: boolean;
    socialLinks?: { facebook?: string; instagram?: string; twitter?: string; linkedin?: string; youtube?: string };
    socialProofConfig?: { socialProof?: boolean; testimonials?: boolean; trustBadges?: boolean };
    sourceWebsite?: string;
    designNotes?: string;
    downloadFiles?: Array<{ name: string; label?: string; context?: string; url: string; mime?: string }>;
  };
}) => {
  const accountType = getStoredAccountType();
  const invoke = () =>
    invokeAiFunction<{ html: string; css: string; js: string; assets: string[]; slug: string; url?: string; fileName?: string; htmlLength?: number }>("generate-landing", payload);

  try {
    return await invoke();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (accountType === "user" && /\b546\b/i.test(message)) {
      // Testing key path may intermittently hit upstream gateway 546; retry once.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return await invoke();
    }
    if (!/rate limit exceeded/i.test(message)) {
      throw error;
    }

    const retryMatch = message.match(/about\s+(\d+)s/i);
    const retrySeconds = retryMatch ? Number(retryMatch[1]) : 8;
    const waitMs = Math.min(20000, Math.max(3000, retrySeconds * 1000));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return await invoke();
  }
};

export const generateAdCreatives = async (payload: {
  prompt: string;
  businessName: string;
  adData: Record<string, unknown>;
}) => {
  const invoke = () => invokeAiFunction<{
    html: string;
    css: string;
    js: string;
    assets: string[];
    slug: string;
    creativeCount?: number;
    formats?: Array<{ platform: string; format: string; label: string; width: number; height: number }>;
  }>("generate-ad-creatives", payload);

  try {
    return await invoke();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/status\s*546|gateway|timed out|unavailable/i.test(message)) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return await invoke();
    }
    throw error;
  }
};

export const analyzeAdBrief = (description: string, currentData?: Record<string, unknown>) =>
  invokeAiFunction<{ extracted: Record<string, unknown> }>("analyze-ad-brief", { description, currentData });

export const getProjectFiles = async (projectId: number, userId: number) => {
  const params = new URLSearchParams({
    project_id: String(projectId),
    user_id: String(userId),
  });

  const response = await fetch(`${API}/getProjectFiles.php?${params.toString()}`, {
    method: "GET",
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; files: ProjectAsset[]; filesPublicUrl?: string };
};

export const uploadProjectFiles = async (projectId: number, userId: number, files: File[]) => {
  const formData = new FormData();
  formData.append("project_id", String(projectId));
  formData.append("user_id", String(userId));
  files.forEach((file) => formData.append("files[]", file));

  const response = await fetch(`${API}/uploadProjectFiles.php`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; uploaded: ProjectAsset[] };
};

export const deleteProjectFile = async (projectId: number, userId: number, fileName: string) => {
  const response = await fetch(`${API}/deleteProjectFile.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
      file_name: fileName,
    }),
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as { success: boolean; deleted: string };
};

// ---------------------------------------------------------------------------
// Agents — File Search Store-backed LP and Ads generation
// ---------------------------------------------------------------------------

const AGENTS_API = `${API}/v1/agents`;

async function agentsPost<T>(endpoint: string, payload: unknown): Promise<T> {
  const response = await fetch(`${AGENTS_API}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `${endpoint} failed with status ${response.status}`);
  }
  return data as T;
}

export type AgentLpResult = {
  success: boolean;
  html: string;
  slug: string;
  assets: string[];
  agentVersion?: number;
  usedStores?: string[];
  groundingMetadata?: unknown;
};

export type AgentAdsResult = {
  success: boolean;
  html: string;
  assets: string[];
  slug: string;
  creativeCount: number;
  formats: Array<{ platform: string; format: string; label: string; width: number; height: number }>;
  creativePlan?: string;
  agentVersion?: number;
  usedStores?: string[];
  groundingMetadata?: unknown;
};

export type PreparedAgentAdsRequest = {
  success: boolean;
  edgePayload: Record<string, unknown> & {
    accountType?: "admin" | "user";
    campaignData?: Record<string, unknown>;
  };
  campaignId?: number | null;
  campaignMemoryStore?: string | null;
};

export type AgentAdsPlanResult = {
  creativePlan: string;
  formats: AgentAdsResult["formats"];
  usedStores?: string[];
  groundingMetadata?: unknown;
};

export const prepareAdsViaAgentPayload = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id?: number;
  form_data: Record<string, unknown>;
}): Promise<PreparedAgentAdsRequest> =>
  agentsPost("prepare-generate-ads.php", payload);

export const prepareAdsFromCampaignPayload = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id: number;
  form_overrides?: Record<string, unknown>;
}): Promise<PreparedAgentAdsRequest> =>
  agentsPost("prepare-generate-ads-from-campaign.php", payload);

export const planAdsViaAgent = (
  edgePayload: PreparedAgentAdsRequest["edgePayload"],
): Promise<AgentAdsPlanResult> =>
  invokeAiFunction<AgentAdsPlanResult>(
    "agents-ads",
    { ...edgePayload, mode: "plan" },
    { accountType: edgePayload.accountType || getStoredAccountType() },
  );

export const interpretBatchesViaAgent = (
  edgePayload: PreparedAgentAdsRequest["edgePayload"],
  allFormats: AgentAdsResult["formats"],
): Promise<{ batchSpecs: Array<{ label: string; spec: string }>; usedStores?: string[] }> =>
  invokeAiFunction<{ batchSpecs: Array<{ label: string; spec: string }>; usedStores?: string[] }>(
    "agents-ads",
    { ...edgePayload, mode: "interpret", batchFormats: allFormats },
    { accountType: edgePayload.accountType || getStoredAccountType() },
  );

export const renderAdsBatchViaAgent = (
  edgePayload: PreparedAgentAdsRequest["edgePayload"],
  batchFormats: AgentAdsResult["formats"],
  creativePlan: string,
  batchIndex: number,
  totalBatches: number,
  mode: "render" | "unified" = "unified",
): Promise<Omit<AgentAdsResult, "success">> =>
  invokeAiFunction<Omit<AgentAdsResult, "success">>(
    "agents-ads",
    {
      ...edgePayload,
      mode,
      creativePlan,
      batchFormats,
      batchIndex,
      totalBatches,
    },
    { accountType: edgePayload.accountType || getStoredAccountType() },
  );

export type ConvertImageToHtmlParams = {
  imageBase64: string;
  mimeType: string;
  format: { platform: string; format: string; label: string; width: number; height: number };
  campaignData?: Record<string, unknown>;
  creativePlan?: string;
};

export const convertImageAdToHtml = (
  edgePayload: Record<string, unknown>,
  params: ConvertImageToHtmlParams,
): Promise<{ mode: "image_to_html"; html: string }> =>
  invokeAiFunction<{ mode: "image_to_html"; html: string }>(
    "agents-ads",
    {
      ...edgePayload,
      mode: "image_to_html",
      imageBase64: params.imageBase64,
      mimeType: params.mimeType,
      format: params.format,
      creativePlan: params.creativePlan || "",
      ...(params.campaignData ? { campaignData: params.campaignData } : {}),
    },
  );

export const recordCampaignCreativePlan = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id: number;
  form_data: Record<string, unknown>;
  creative_plan: string;
  source: string;
}): Promise<{ success: boolean }> =>
  agentsPost("record-campaign-generation.php", payload);

// ---------------------------------------------------------------------------
// Async generation job tracking (A+B: async job + batch persistence)
// ---------------------------------------------------------------------------

export type GenerationJobBatch = {
  id: number;
  batch_index: number;
  status: "queued" | "running" | "completed" | "failed";
  label: string;
  formats: Array<{ platform?: string; format?: string; label?: string; width?: number; height?: number; enabled?: boolean }>;
  error: string | null;
  attempts: number;
  saved_count: number;
};

export type GenerationJob = {
  id: number;
  user_id: number;
  company_project_id: number;
  campaign_id: number | null;
  project_id: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  creative_plan: string | null;
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const createGenerationJob = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id?: number;
  project_id?: number;
  batches: Array<{ label: string; formats: GenerationJobBatch["formats"] }>;
  creative_plan?: string;
}): Promise<{ success: boolean; job_id: number; batches: GenerationJobBatch[] }> =>
  agentsPost("create-generation-job.php", payload);

export const updateGenerationJob = (payload: {
  job_id: number;
  user_id: number;
  action: "save_batch" | "fail_batch" | "retry_batch" | "complete" | "cancel";
  batch_index?: number;
  saved_count?: number;
  error?: string;
}): Promise<{ success: boolean }> =>
  agentsPost("update-generation-job.php", payload);

export const getGenerationJob = (payload: {
  user_id: number;
  job_id?: number;
  campaign_id?: number;
}): Promise<{ job: GenerationJob | null; batches: GenerationJobBatch[] }> =>
  agentsPost("get-generation-job.php", payload);

const getEnabledAgentFormats = (edgePayload: PreparedAgentAdsRequest["edgePayload"]): AgentAdsResult["formats"] => {
  const campaignData = edgePayload.campaignData || {};
  const selected = Array.isArray(campaignData.selectedFormats) ? campaignData.selectedFormats : [];
  return selected
    .filter((format: any) => format && format.enabled !== false && format.width && format.height)
    .map((format: any) => ({
      platform: String(format.platform || "banner"),
      format: String(format.format || "ad"),
      label: String(format.label || `${format.width}x${format.height}`),
      width: Number(format.width || 1080),
      height: Number(format.height || 1080),
    }));
};

const extractDocumentPart = (html: string, tagName: "style" | "body") => {
  if (tagName === "style") {
    return Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
      .map((match) => match[1])
      .join("\n");
  }
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
};

const combineAgentBatchHtml = (htmlList: string[]) => {
  const styles = htmlList.map((html) => extractDocumentPart(html, "style")).filter(Boolean).join("\n");
  const bodies = htmlList.map((html) => extractDocumentPart(html, "body")).filter(Boolean).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box}body{margin:0;padding:0}${styles}</style></head><body>${bodies}</body></html>`;
};

const renderAllAgentBatches = async (
  edgePayload: PreparedAgentAdsRequest["edgePayload"],
  creativePlan: string,
) => {
  const formats = getEnabledAgentFormats(edgePayload);
  const batches = formats.map((format) => [format]);
  const results: Array<Omit<AgentAdsResult, "success">> = [];

  for (let i = 0; i < batches.length; i++) {
    try {
      results.push(await renderAdsBatchViaAgent(edgePayload, batches[i], creativePlan, i, batches.length));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/\b(504|546)\b|gateway|timed out|unavailable/i.test(msg)) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        results.push(await renderAdsBatchViaAgent(edgePayload, batches[i], creativePlan, i, batches.length));
      } else {
        throw err;
      }
    }
  }

  return {
    html: combineAgentBatchHtml(results.map((result) => result.html).filter(Boolean)),
    assets: Array.from(new Set(results.flatMap((result) => result.assets || []))),
    slug: results[0]?.slug || "ad-creatives",
    creativeCount: results.reduce((sum, result) => sum + Number(result.creativeCount || 0), 0),
    formats,
    usedStores: results[0]?.usedStores,
    groundingMetadata: results.map((result) => result.groundingMetadata).filter(Boolean),
  };
};

export const generateLandingViaAgent = (payload: {
  user_id: number;
  company_project_id: number;
  objective?: string;
  conversion_goal?: string;
  hero_layout?: string;
  cta_label?: string;
  cta_href?: string;
  offer_text?: string;
  urgency_text?: string;
  design_notes?: string;
  language?: string;
  target_url?: string;
  sections?: string[];
  additional_images?: string[];
  custom_slug?: string;
  form_data?: Record<string, unknown>;
}): Promise<AgentLpResult> =>
  agentsPost<AgentLpResult>("generate-landing.php", payload);

export const generateAdsViaAgent = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id?: number;
  form_data: Record<string, unknown>;
}): Promise<AgentAdsResult> => {
  return prepareAdsViaAgentPayload(payload).then(async (prepared) => {
    const plan = await planAdsViaAgent(prepared.edgePayload);
    const creativePlan = plan.creativePlan || "";
    const edgeResult = await renderAllAgentBatches(prepared.edgePayload, creativePlan);
    if (creativePlan.trim() && prepared.campaignId) {
      void agentsPost("record-campaign-generation.php", {
        user_id: payload.user_id,
        company_project_id: payload.company_project_id,
        campaign_id: prepared.campaignId,
        form_data: prepared.edgePayload.campaignData || payload.form_data,
        creative_plan: creativePlan,
        source: "form_generation",
      }).catch((err) => {
        console.warn("[form-generation] failed to record creative plan", err);
      });
    }

    return {
      success: true,
      ...edgeResult,
      creativePlan,
      usedStores: plan.usedStores || edgeResult.usedStores,
      groundingMetadata: [plan.groundingMetadata, edgeResult.groundingMetadata].filter(Boolean),
    };
  });
};

type TrackedProgressEvent =
  | { type: "plan" }
  | { type: "batch_start"; batchIndex: number; totalBatches: number; label: string }
  | { type: "batch_done";  batchIndex: number; totalBatches: number; label: string }
  | { type: "batch_fail";  batchIndex: number; totalBatches: number; label: string; error: string };

export const generateAdsViaAgentTracked = (
  payload: { user_id: number; company_project_id: number; campaign_id?: number; form_data: Record<string, unknown> },
  onProgress: (event: TrackedProgressEvent) => void,
): Promise<AgentAdsResult> => {
  return prepareAdsViaAgentPayload(payload).then(async (prepared) => {
    const formats = getEnabledAgentFormats(prepared.edgePayload);
    const batches = formats.map((format) => [format]);

    // 1. Interpret — queries stores once, writes per-format design specs
    let batchSpecs: Array<{ label: string; spec: string }> = [];
    onProgress({ type: "plan" });
    try {
      const interpretation = await interpretBatchesViaAgent(prepared.edgePayload, formats);
      batchSpecs = interpretation.batchSpecs || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/\b(504|546)\b|gateway|timed out|unavailable/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 4000));
        const interpretation = await interpretBatchesViaAgent(prepared.edgePayload, formats);
        batchSpecs = interpretation.batchSpecs || [];
      } else throw err;
    }

    const jobResult = await createGenerationJob({
      user_id: payload.user_id,
      company_project_id: payload.company_project_id,
      campaign_id: payload.campaign_id,
      batches: batches.map((b, i) => ({ label: b[0]?.label || `Batch ${i + 1}`, formats: b })),
      creative_plan: batchSpecs.map((s) => `[${s.label}]\n${s.spec}`).join("\n\n"),
    });
    const jobId = jobResult.job_id;

    const results: Array<Omit<AgentAdsResult, "success">> = [];

    // 2. Render each batch with its specific spec (no file search in render calls)
    for (let i = 0; i < batches.length; i++) {
      const label = batches[i][0]?.label || `Batch ${i + 1}`;
      const spec = batchSpecs.find((s) => s.label === label)?.spec || batchSpecs[i]?.spec || "";
      onProgress({ type: "batch_start", batchIndex: i, totalBatches: batches.length, label });
      try {
        let result: Omit<AgentAdsResult, "success">;
        try {
          result = await renderAdsBatchViaAgent(prepared.edgePayload, batches[i], spec, i, batches.length, "render");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (/\b(504|546)\b|gateway|timed out|unavailable/i.test(msg)) {
            await new Promise((r) => setTimeout(r, 4000));
            result = await renderAdsBatchViaAgent(prepared.edgePayload, batches[i], spec, i, batches.length, "render");
          } else throw err;
        }
        results.push(result);
        void updateGenerationJob({ job_id: jobId, user_id: payload.user_id, action: "save_batch", batch_index: i, saved_count: 1 }).catch(() => {});
        onProgress({ type: "batch_done", batchIndex: i, totalBatches: batches.length, label });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        void updateGenerationJob({ job_id: jobId, user_id: payload.user_id, action: "fail_batch", batch_index: i, error: errMsg }).catch(() => {});
        onProgress({ type: "batch_fail", batchIndex: i, totalBatches: batches.length, label, error: errMsg });
        void updateGenerationJob({ job_id: jobId, user_id: payload.user_id, action: "complete" }).catch(() => {});
        throw err;
      }
    }

    void updateGenerationJob({ job_id: jobId, user_id: payload.user_id, action: "complete" }).catch(() => {});

    return {
      success: true,
      html: combineAgentBatchHtml(results.map((r) => r.html).filter(Boolean)),
      assets: Array.from(new Set(results.flatMap((r) => r.assets || []))),
      slug: results[0]?.slug || "ad-creatives",
      creativeCount: results.reduce((sum, r) => sum + Number(r.creativeCount || 0), 0),
      formats,
      creativePlan: batchSpecs.map((s) => `[${s.label}]\n${s.spec}`).join("\n\n"),
      usedStores: results[0]?.usedStores,
      groundingMetadata: results.map((r) => r.groundingMetadata).filter(Boolean),
    };
  });
};

export const learnFromAdFeedback = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id: number;
  bad_ad_ids: number[];
  feedback?: string;
  metrics?: Record<string, unknown>;
}): Promise<{ success: boolean; learnings: string; storeName: string; adCount: number }> =>
  agentsPost("learn-from-feedback.php", payload);

export const syncCompanyKnowledge = (payload: {
  user_id: number;
  company_project_id: number;
}): Promise<{ success: boolean; storeName: string; refreshed: boolean }> =>
  agentsPost("sync-company-knowledge.php", payload);

export const uploadCompanyFile = (formData: FormData): Promise<{
  success: boolean;
  fileId: number;
  displayName: string;
  storeName: string;
  fileUri: string | null;
  documentName?: string | null;
}> => {
  return fetch(`${API}/v1/agents/upload-company-file.php`, {
    method: "POST",
    body: formData,
  }).then((r) => r.json());
};

export const listCompanyFiles = (payload: {
  user_id: number;
  company_project_id: number;
}): Promise<{
  success: boolean;
  files: Array<{
    id: number;
    display_name: string;
    mime_type: string;
    file_size_bytes: number | null;
    created_at: string;
  }>;
}> => agentsPost("list-company-files.php", payload);

export const deleteCompanyFile = (payload: {
  user_id: number;
  company_project_id: number;
  file_id: number;
}): Promise<{ success: boolean }> =>
  agentsPost("delete-company-file.php", payload);

export const markGoodExamples = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id: number;
  ad_ids: number[];
}): Promise<{ success: boolean; storeName: string; uploadedCount: number }> =>
  agentsPost("mark-good-example.php", payload);

export const removeCampaignExample = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id: number;
  example_id: number;
}): Promise<{ success: boolean; deletedRecord: boolean; deletedDocument: boolean }> =>
  agentsPost("remove-campaign-example.php", payload);

export const syncGlobalStore = (formData: FormData): Promise<{
  success: boolean;
  storeName: string;
  fileUri: string | null;
  documentName?: string | null;
  storedFile?: string | null;
}> =>
  fetch(`${API}/v1/agents/sync-global-store.php`, {
    method: "POST",
    body: formData,
  }).then(async (response) => {
    const data = await readJson(response);
    if (!response.ok || data?.error) {
      throw new Error(data?.error || `Request failed with status ${response.status}`);
    }
    return data;
  });

export const getCreativesHtml = (
  creativeIds: number[],
  userId: number,
): Promise<{ id: number; label: string; platform: string; format: string; width: number; height: number; html: string }[]> =>
  fetch(`${API}/getCreativesHtml.php?user_id=${userId}&creative_ids=${creativeIds.join(",")}`)
    .then(async (r) => {
      const data = await readJson(r);
      if (!r.ok || data?.error) throw new Error(data?.error || `HTTP ${r.status}`);
      return data.creatives ?? [];
    });

export const sendCreativeHtmlToGlobalStore = (
  userId: number,
  html: string,
  label: string,
): Promise<{ success: boolean }> => {
  const fd = new FormData();
  fd.append("user_id", String(userId));
  fd.append("store_type", "ads_reference");
  fd.append("display_name", label);
  fd.append("text", html);
  return syncGlobalStore(fd);
};

export const getGeminiKey = (userId: number): Promise<{ gemini_api_key: string | null; generate_as_image: boolean }> =>
  postApi("getGeminiKey.php", { user_id: userId });

export const saveGeminiKey = (
  userId: number,
  geminiApiKey: string,
  generateAsImage?: boolean,
): Promise<{ success: boolean }> =>
  postApi("saveGeminiKey.php", {
    user_id: userId,
    gemini_api_key: geminiApiKey,
    ...(generateAsImage !== undefined ? { generate_as_image: generateAsImage ? 1 : 0 } : {}),
  });

export type AdImageResult = {
  imageUrl: string;
  platform: string;
  format: string;
  label: string;
  width: number;
  height: number;
};

export const generateAdImages = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id?: number;
  form_data: Record<string, unknown>;
}): Promise<{ success: boolean; mode: "image"; images: AdImageResult[] }> =>
  agentsPost("generate-ads.php", {
    ...payload,
    form_data: { ...payload.form_data, generate_as_image: true },
  });

export type AdCopyResult = {
  mainHeadline: string;
  subheadline:  string;
  ctaText:      string;
  bodyText?:    string;
  abVariants?:  Array<{ label: string; headline: string; cta: string }>;
};

export const generateAdCopy = async (payload: {
  user_id:            number;
  company_project_id: number;
  form_data:          Record<string, unknown>;
}): Promise<{ success: boolean; mode: "copy"; copy: AdCopyResult }> => {
  const prepared = await agentsPost<{ success: boolean; edgePayload: Record<string, unknown> }>(
    "generate-copy.php", payload,
  );
  return invokeAiFunction<{ success: boolean; mode: "copy"; copy: AdCopyResult }>(
    "agents-ads",
    { ...prepared.edgePayload, mode: "copy" },
    { accountType: (prepared.edgePayload.accountType as "admin" | "user") || getStoredAccountType() },
  );
};

export type GlobalStoreFile = {
  id: number;
  store_name: string;
  document_name: string | null;
  display_name: string;
  original_name: string | null;
  mime_type: string;
  file_size_bytes: number | null;
  storage_path: string;
  created_at: string;
};

export const listGlobalStoreFiles = (payload: {
  user_id: number;
  store_type: "lp" | "ads" | "ads_reference";
}): Promise<{ success: boolean; files: GlobalStoreFile[] }> =>
  agentsPost("list-global-store-files.php", payload);

export const deleteGlobalStoreFile = (payload: {
  user_id: number;
  store_type: "lp" | "ads" | "ads_reference";
  file_id: number;
}): Promise<{ success: boolean; deletedDocument: boolean; deletedRecord: boolean }> =>
  agentsPost("delete-global-store-file.php", payload);

export type CampaignPlan = {
  date: string;
  plan: string;
  formats: string[];
  source?: string;
};

export type CampaignExampleCreative = {
  id: number;
  creative_id: number;
  gemini_document_name?: string | null;
  created_at: string;
  name: string;
  url?: string;
  public_url?: string;
  image_url?: string;
  platform?: string;
  format?: string;
  label?: string;
  width?: number;
  height?: number;
};

export type CampaignData = {
  success: boolean;
  id: number;
  name: string;
  form_data: Record<string, unknown>;
  company_form_data?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  creative_plans: CampaignPlan[];
  example_creatives: CampaignExampleCreative[];
  gemini_good_examples_store: string | null;
  gemini_memory_store: string | null;
  project_id: number;
  company_project_id: number;
};

export const getCampaign = (
  campaignId: number,
  userId: number
): Promise<CampaignData> =>
  fetch(`${API}/getCampaign.php?campaign_id=${campaignId}&user_id=${userId}`)
    .then(async (r) => {
      const data = await readJson(r);
      if (!r.ok || data?.error) throw new Error(data?.error || `HTTP ${r.status}`);
      return data;
    });

export const generateFromCampaign = (payload: {
  user_id: number;
  company_project_id: number;
  campaign_id: number;
  form_overrides?: Record<string, unknown>;
}): Promise<AgentAdsResult> => {
  return prepareAdsFromCampaignPayload(payload)
    .then(async (prepared) => {
      const plan = await planAdsViaAgent(prepared.edgePayload);
      const creativePlan = plan.creativePlan || "";
      const edgeResult = await renderAllAgentBatches(prepared.edgePayload, creativePlan);
      if (creativePlan.trim()) {
        void agentsPost("record-campaign-generation.php", {
          user_id: payload.user_id,
          company_project_id: payload.company_project_id,
          campaign_id: payload.campaign_id,
          form_data: prepared.edgePayload.campaignData || {},
          creative_plan: creativePlan,
          source: "campaign_direct_edge",
        }).catch((error) => {
          console.warn("[campaign-generation] failed to record creative plan", error);
        });
      }

      return {
        success: true,
        ...edgeResult,
        creativePlan,
        usedStores: plan.usedStores || edgeResult.usedStores,
        groundingMetadata: [plan.groundingMetadata, edgeResult.groundingMetadata].filter(Boolean),
      };
    });
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type CampaignChatResponse =
  | { type: "text"; message: string; usedStores?: string[] }
  | { type: "generate"; message: string; formOverrides: Record<string, unknown> };

export const campaignChat = (payload: {
  user_id: number;
  campaign_id: number;
  message: string;
  history: ChatMessage[];
}): Promise<CampaignChatResponse> =>
  agentsPost("campaign-chat.php", payload);

export type GlobalChatResponse = { type: "text"; message: string; usedStores?: string[] };

export const globalChat = (payload: {
  user_id: number;
  message: string;
  history: ChatMessage[];
}): Promise<GlobalChatResponse> =>
  agentsPost("global-chat.php", payload);
