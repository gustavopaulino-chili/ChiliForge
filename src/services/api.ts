const API = "/api";
const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const normalizeAccountType = (value: unknown): "admin" | "testing" =>
  value === "admin" ? "admin" : "testing";

const getStoredAccountType = (): "admin" | "testing" => {
  try {
    const storedUser = localStorage.getItem("user");
    if (!storedUser) return "testing";

    const parsedUser = JSON.parse(storedUser);
    return normalizeAccountType(parsedUser?.accountType);
  } catch {
    return "testing";
  }
};

type InvokeAiOptions = {
  accountType?: "admin" | "testing";
};

const readJson = async (response: Response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
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

export const getProjectById = async (projectId: number, userId: number) => {
  const params = new URLSearchParams({
    user_id: String(userId),
    id: String(projectId),
  });

  const response = await fetch(`${API}/getProjects.php?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch project: ${response.status}`);
  }

  const data = await response.json();
  // When fetching by ID, getProjects returns an array with one item
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
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

export const updateProjectStep = (payload: { id: number; user_id: number; current_step: number }) =>
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

export const updateProjectFormState = (payload: { id: number; user_id: number; current_step: number; form_data: unknown }) =>
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
) => {
  const formData = new FormData();
  formData.append("project_id", String(projectId));
  formData.append("user_id", String(userId));

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
  invokeAiFunction<{ preset: string; sections: Array<{ name: string; description: string; required: boolean }> }>("generate-preset", { description }, { accountType: "testing" });

export const generateSections = (description: string) =>
  invokeAiFunction<{ preset: string; sections: Array<{ name: string; description: string; required: boolean }> }>("generate-preset", { description }, { accountType: "testing" });

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
    if (accountType === "testing" && /status\s*546/i.test(message)) {
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