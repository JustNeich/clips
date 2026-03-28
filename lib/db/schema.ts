export const APP_DB_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  stage2_examples_corpus_json TEXT,
  stage2_hard_constraints_json TEXT,
  stage2_prompt_config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_codex_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  codex_session_id TEXT,
  codex_home_path TEXT,
  login_status_text TEXT,
  device_auth_status TEXT,
  device_auth_output TEXT,
  device_auth_login_url TEXT,
  device_auth_user_code TEXT,
  connected_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  description_prompt TEXT NOT NULL,
  examples_json TEXT NOT NULL,
  stage2_worker_profile_id TEXT,
  stage2_examples_config_json TEXT,
  stage2_hard_constraints_json TEXT,
  stage2_prompt_config_json TEXT,
  stage2_style_profile_json TEXT,
  template_id TEXT NOT NULL,
  avatar_asset_id TEXT,
  default_background_asset_id TEXT,
  default_music_asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_access (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_role TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_publish_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  encrypted_token_json TEXT,
  google_account_email TEXT,
  selected_youtube_channel_id TEXT,
  selected_youtube_channel_title TEXT,
  selected_youtube_channel_custom_url TEXT,
  available_channels_json TEXT,
  scopes_json TEXT,
  connected_by_user_id TEXT,
  connected_at TEXT,
  last_verified_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (connected_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channel_publish_settings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  first_slot_local_time TEXT NOT NULL,
  daily_slot_count INTEGER NOT NULL,
  slot_interval_minutes INTEGER NOT NULL,
  auto_queue_enabled INTEGER NOT NULL DEFAULT 1,
  upload_lead_minutes INTEGER NOT NULL DEFAULT 120,
  notify_subscribers_default INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channel_youtube_oauth_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage2_runs (
  run_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  creator_user_id TEXT,
  channel_id TEXT,
  chat_id TEXT,
  source_url TEXT,
  user_instruction TEXT,
  mode TEXT,
  status TEXT NOT NULL,
  request_json TEXT,
  snapshot_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  FOREIGN KEY (chat_id) REFERENCES chat_threads(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS source_jobs (
  job_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  creator_user_id TEXT,
  channel_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_editorial_feedback_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT,
  chat_id TEXT,
  stage2_run_id TEXT,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'option',
  note_mode TEXT NOT NULL DEFAULT 'soft_preference',
  note TEXT,
  option_snapshot_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (chat_id) REFERENCES chat_threads(id) ON DELETE SET NULL,
  FOREIGN KEY (stage2_run_id) REFERENCES stage2_runs(run_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channel_style_discovery_runs (
  run_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  creator_user_id TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  request_fingerprint TEXT,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stage3_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  dedupe_key TEXT,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  recoverable INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage3_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES stage3_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage3_job_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES stage3_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS render_exports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  stage3_job_id TEXT NOT NULL UNIQUE,
  artifact_file_name TEXT NOT NULL,
  artifact_file_path TEXT NOT NULL,
  artifact_mime_type TEXT NOT NULL,
  artifact_size_bytes INTEGER NOT NULL,
  render_title TEXT,
  source_url TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (stage3_job_id) REFERENCES stage3_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_publications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  render_export_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  upload_ready_at TEXT NOT NULL,
  slot_date TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  notify_subscribers INTEGER NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 0,
  title_manual INTEGER NOT NULL DEFAULT 0,
  description_manual INTEGER NOT NULL DEFAULT 0,
  tags_manual INTEGER NOT NULL DEFAULT 0,
  schedule_manual INTEGER NOT NULL DEFAULT 0,
  youtube_video_id TEXT,
  youtube_video_url TEXT,
  published_at TEXT,
  canceled_at TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (render_export_id) REFERENCES render_exports(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_publication_events (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES channel_publications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage3_workers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  platform TEXT NOT NULL,
  hostname TEXT,
  app_version TEXT,
  capabilities_json TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage3_worker_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  worker_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES stage3_workers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_channel_access_channel
  ON channel_access(channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_access_user
  ON channel_access(user_id);

CREATE INDEX IF NOT EXISTS idx_channel_publish_integrations_channel
  ON channel_publish_integrations(channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_publish_settings_channel
  ON channel_publish_settings(channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_youtube_oauth_states_expires
  ON channel_youtube_oauth_states(expires_at);

CREATE INDEX IF NOT EXISTS idx_channel_editorial_feedback_channel
  ON channel_editorial_feedback_events(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_editorial_feedback_workspace
  ON channel_editorial_feedback_events(workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_drafts_thread_user
  ON chat_drafts(thread_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_drafts_user
  ON chat_drafts(user_id);

CREATE INDEX IF NOT EXISTS idx_channels_workspace
  ON channels(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_channel
  ON chat_threads(channel_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_events_thread
  ON chat_events(thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_jobs_status
  ON stage3_jobs(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_jobs_workspace
  ON stage3_jobs(workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stage3_jobs_kind_dedupe
  ON stage3_jobs(kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stage2_runs_chat_created
  ON stage2_runs(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage2_runs_status_created
  ON stage2_runs(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_job_events_job
  ON stage3_job_events(job_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_job_artifacts_job
  ON stage3_job_artifacts(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_render_exports_chat_created
  ON render_exports(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_publications_channel_scheduled
  ON channel_publications(channel_id, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS idx_channel_publications_status_upload_ready
  ON channel_publications(status, upload_ready_at ASC);

CREATE INDEX IF NOT EXISTS idx_channel_publications_chat_updated
  ON channel_publications(chat_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_publication_events_publication
  ON channel_publication_events(publication_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_workers_user
  ON stage3_workers(workspace_id, user_id, updated_at DESC);
`;
