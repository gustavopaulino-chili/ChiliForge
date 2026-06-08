// ClickUp integration — shapes mirrored from the PHP endpoints.

export interface ClickUpStatus {
  success: boolean;
  connected: boolean;
  clickup_user_id?: string | null;
  workspace_id?: string | null;
  configured: boolean; // server has CLICKUP_CLIENT_ID set
}

export interface ClickUpSpace {
  id: string;
  name: string;
}

export interface ClickUpFolder {
  id: string;
  name: string;
  list_count: number;
}

export interface ClickUpDoc {
  id: string;
  name: string;
}

export interface ClickUpCompany {
  company: string;
  channels: string[];
  list_ids: string[];
  list_names: string[];
  detected_url: string;
  already_imported: boolean;
}

export type ClickUpListResponse =
  | { success: true; mode: 'spaces'; workspace_id: string; spaces: ClickUpSpace[] }
  | { success: true; mode: 'folders'; space_id: string; workspace_id: string; folders: ClickUpFolder[] }
  | { success: true; mode: 'companies'; space_id: string; folder_id: string; companies: ClickUpCompany[] };

export interface ClickUpImportResultItem {
  company: string;
  status: 'created' | 'updated' | 'skipped' | 'error';
  project_id?: number;
  public_url?: string;
  reason?: string;
}

// v3 — a new company detected in ClickUp (via webhook), pending import.
export interface ClickUpDetection {
  id: number;
  company: string;
  channels: string[];
  list_ids: string[];
  detected_at: string;
}

// Wiki — a client parsed from a ClickUp Doc subpage title "{Company} - {Service} {Region}".
export interface ClickUpWikiCompany {
  company: string;
  services: string[];   // SEO, PPC
  region: string;       // BR | INT | ''
  title: string;        // original subpage title
  doc_id: string;
  page_id: string;
}
