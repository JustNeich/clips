export const CHANNEL_PUBLICATIONS_PORTFOLIO_OWNERSHIP_FENCE_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS channel_publications_portfolio_ownership_fence
BEFORE INSERT ON channel_publications
WHEN EXISTS (
  SELECT 1 FROM production_channel_ownership ownership
  WHERE ownership.workspace_id = NEW.workspace_id
    AND ownership.channel_id = NEW.channel_id
    AND ownership.status IN ('active', 'releasing')
    AND (
      ownership.status = 'releasing'
      OR NOT EXISTS (
        SELECT 1
        FROM render_exports re
        JOIN production_items pi ON pi.stage3_job_id = re.stage3_job_id
        JOIN production_run_channels prc ON prc.id = pi.run_channel_id
        JOIN production_runs pr ON pr.id = pi.run_id
        WHERE re.id = NEW.render_export_id
          AND pi.workspace_id = NEW.workspace_id
          AND pi.channel_id = NEW.channel_id
          AND pr.mode = 'live'
          AND prc.profile_id = ownership.profile_id
          AND prc.profile_version = ownership.profile_version
          AND prc.profile_hash = ownership.profile_hash
          AND pi.state IN ('final_approved', 'upload_outcome_unknown')
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_channel_ownership_fence');
END;
`;

export const APP_DB_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  default_template_id TEXT,
  stage2_examples_corpus_json TEXT,
  stage2_hard_constraints_json TEXT,
  stage2_prompt_config_json TEXT,
  workspace_codex_model_config_json TEXT,
  stage2_caption_provider_json TEXT,
  stage3_execution_target TEXT,
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

CREATE TABLE IF NOT EXISTS workspace_anthropic_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  encrypted_api_key_json TEXT,
  api_key_hint TEXT,
  last_error TEXT,
  connected_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_openrouter_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  encrypted_api_key_json TEXT,
  api_key_hint TEXT,
  last_error TEXT,
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
  stage2_source_overlay_config_json TEXT,
  template_id TEXT NOT NULL,
  avatar_asset_id TEXT,
  default_background_asset_id TEXT,
  default_music_asset_id TEXT,
  default_clip_duration_sec INTEGER NOT NULL DEFAULT 6,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  layout_family TEXT NOT NULL,
  content_json TEXT NOT NULL,
  template_config_json TEXT NOT NULL,
  shadow_layers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
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
  oauth_client_key TEXT,
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
  notify_subscribers_default INTEGER NOT NULL DEFAULT 0,
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
  oauth_client_key TEXT,
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

CREATE TABLE IF NOT EXISTS source_decompositions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  frames_dir TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
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
  channel_id TEXT,
  chat_id TEXT,
  correlation_id TEXT,
  stage TEXT,
  status TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mcp_access_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_machine_credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  secret_hint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  rotates_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS copscopes_source_categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  exhausted_at TEXT,
  UNIQUE (workspace_id, channel_id, slug),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS copscopes_source_reels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  shortcode TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  view_count INTEGER,
  views_label TEXT,
  posted_at TEXT,
  category_id TEXT,
  category_slug TEXT NOT NULL,
  secondary_tags_json TEXT NOT NULL DEFAULT '[]',
  quality_score REAL,
  crop_confidence REAL,
  crop_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available',
  consumed_chat_id TEXT,
  consumed_stage2_run_id TEXT,
  consumed_stage3_job_id TEXT,
  last_error TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (workspace_id, channel_id, canonical_url),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES copscopes_source_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS copscopes_daily_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  category_id TEXT,
  category_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  limit_count INTEGER NOT NULL,
  attempt_budget INTEGER NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  reviewed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES copscopes_source_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS copscopes_daily_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_reel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  chat_id TEXT,
  stage2_run_id TEXT,
  stage3_job_id TEXT,
  publication_id TEXT,
  error_message TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES copscopes_daily_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (source_reel_id) REFERENCES copscopes_source_reels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS production_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'shadow', 'active', 'retired')),
  profile_hash TEXT NOT NULL,
  expected_youtube_channel_id TEXT NOT NULL,
  expected_destination_title TEXT NOT NULL DEFAULT '',
  template_id TEXT NOT NULL,
  template_snapshot_sha256 TEXT NOT NULL,
  publish_policy_id TEXT NOT NULL,
  quality_policy_id TEXT NOT NULL,
  model_route_manifest_id TEXT NOT NULL,
  model_route_manifest_sha256 TEXT NOT NULL,
  target_per_logical_day INTEGER NOT NULL,
  ready_buffer_min INTEGER NOT NULL,
  ready_buffer_cap INTEGER NOT NULL,
  candidate_attempt_budget INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by_user_id TEXT,
  approval_scope TEXT CHECK (approval_scope IS NULL OR approval_scope IN ('shadow', 'live')),
  approval_binding_sha256 TEXT,
  UNIQUE (channel_id, version),
  UNIQUE (workspace_id, profile_hash),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_kings_source_policy_approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_sha256 TEXT NOT NULL,
  source_designations_sha256 TEXT NOT NULL,
  approval_json TEXT NOT NULL,
  approval_sha256 TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_authorization_evidence_sha256 TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  revocation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, policy_version, policy_sha256, source_designations_sha256),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS production_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  portfolio_profile_hash TEXT NOT NULL,
  logical_date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('simulation', 'shadow', 'live')),
  status TEXT NOT NULL CHECK (status IN ('created', 'preflight', 'ready', 'running', 'waiting_public', 'cancel_requested', 'completed', 'blocked', 'canceled', 'failed')),
  target_per_channel INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  request_idempotency_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (workspace_id, portfolio_profile_hash, logical_date, mode),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS production_run_channels (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  profile_hash TEXT NOT NULL,
  expected_youtube_channel_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'preflight', 'ready', 'running', 'waiting_public', 'cancel_requested', 'completed', 'blocked', 'canceled', 'failed')),
  target_count INTEGER NOT NULL,
  public_verified_count INTEGER NOT NULL DEFAULT 0,
  next_slot_at TEXT,
  blocker_code TEXT,
  blocker_message TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, channel_id),
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES production_profiles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS channel_source_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  content_sha256 TEXT,
  event_fingerprint TEXT,
  category_key TEXT NOT NULL,
  rights_status TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'reserved', 'consumed', 'quarantined', 'rejected')),
  qualification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (qualification_status IN ('discovered', 'pending', 'qualified', 'rejected', 'quarantined')),
  qualification_evidence_sha256 TEXT,
  evidence_json TEXT NOT NULL,
  reserved_item_id TEXT,
  reserved_at TEXT,
  consumed_at TEXT,
  quarantined_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, channel_id, canonical_url),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS production_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_channel_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  item_slot INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'source_ingested', 'source_qualified', 'brief_ready', 'preview_ready', 'preview_approved', 'final_rendered', 'final_approved', 'publication_scheduled', 'public_verified', 'rework', 'replaced', 'quarantined', 'policy_blocked', 'upload_outcome_unknown', 'cancel_requested', 'canceled', 'failed')),
  resume_state TEXT CHECK (resume_state IS NULL OR resume_state IN ('source_qualified', 'brief_ready', 'preview_ready')),
  source_candidate_id TEXT,
  source_sha256 TEXT,
  preview_sha256 TEXT,
  template_sha256 TEXT,
  settings_sha256 TEXT,
  final_artifact_sha256 TEXT,
  chat_id TEXT,
  stage2_run_id TEXT,
  stage3_job_id TEXT,
  publication_id TEXT,
  expected_youtube_channel_id TEXT NOT NULL,
  youtube_video_id TEXT,
  upload_session_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempt_budget INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, channel_id, item_slot, generation),
  UNIQUE (publication_id),
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (run_channel_id) REFERENCES production_run_channels(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (source_candidate_id) REFERENCES channel_source_candidates(id) ON DELETE SET NULL,
  FOREIGN KEY (chat_id) REFERENCES chat_threads(id) ON DELETE SET NULL,
  FOREIGN KEY (stage2_run_id) REFERENCES stage2_runs(run_id) ON DELETE SET NULL,
  FOREIGN KEY (stage3_job_id) REFERENCES stage3_jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS production_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  channel_id TEXT,
  production_item_id TEXT,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS production_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  production_item_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  dead_letter_code TEXT,
  projected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS production_daemon_runtime (
  scope_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  daemon_id TEXT NOT NULL,
  config_sha256 TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  dispatch_owner TEXT,
  dispatch_token TEXT,
  dispatch_expires_at TEXT,
  dispatch_heartbeat_at TEXT,
  heartbeat_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('standby', 'running', 'blocked', 'error', 'stopping', 'stopped')),
  logical_date TEXT,
  active_run_ids_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, daemon_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS production_channel_ownership (
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  daemon_id TEXT NOT NULL,
  config_sha256 TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  profile_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'releasing', 'released')),
  fence_token TEXT,
  activated_at TEXT NOT NULL,
  release_requested_at TEXT,
  released_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES production_profiles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS agent_attempts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  production_item_id TEXT NOT NULL,
  stage3_job_id TEXT,
  role TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  model TEXT NOT NULL,
  reasoning_level TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  quality_binding_sha256 TEXT,
  output_hash TEXT,
  artifact_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'timed_out')),
  outcome TEXT,
  verdict TEXT,
  error_code TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_output_tokens INTEGER,
  cost_micros INTEGER,
  cost_unit TEXT CHECK (cost_unit IS NULL OR cost_unit IN ('usd', 'codex_credits')),
  duration_ms INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (production_item_id, role, attempt_no),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE,
  FOREIGN KEY (stage3_job_id) REFERENCES stage3_jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quality_verdicts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  production_item_id TEXT NOT NULL,
  gate_type TEXT NOT NULL CHECK (gate_type IN ('source', 'preview', 'final')),
  judge_kind TEXT NOT NULL CHECK (judge_kind IN ('deterministic', 'semantic', 'vision')),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
  attempt_no INTEGER NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  source_sha256 TEXT,
  preview_sha256 TEXT,
  template_sha256 TEXT,
  settings_sha256 TEXT,
  agent_attempt_id TEXT,
  evidence_sha256 TEXT,
  evidence_artifact_path TEXT,
  defects_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (production_item_id, gate_type, judge_kind, artifact_sha256, attempt_no),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_attempt_id) REFERENCES agent_attempts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public_verifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  production_item_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  expected_youtube_channel_id TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  clips_status TEXT NOT NULL,
  clips_matches INTEGER NOT NULL,
  rss_seen INTEGER NOT NULL,
  shorts_http_status INTEGER,
  page_playable INTEGER NOT NULL,
  page_canonical_video_id TEXT,
  page_channel_id TEXT,
  verified INTEGER NOT NULL,
  failure_code TEXT,
  evidence_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  UNIQUE (production_item_id, attempt_no),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage3_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_target TEXT NOT NULL DEFAULT 'local',
  assigned_worker_id TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  dedupe_key TEXT,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  recoverable INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempt_limit INTEGER NOT NULL DEFAULT 3,
  attempt_group TEXT,
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

CREATE TABLE IF NOT EXISTS production_semantic_input_reservations (
  reservation_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (reservation_id, storage_key)
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
  schedule_mode TEXT NOT NULL DEFAULT 'slot',
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
  remote_deleted_at TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  upload_session_url TEXT,
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

CREATE INDEX IF NOT EXISTS idx_channel_access_user_active
  ON channel_access(user_id, revoked_at, channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_publish_integrations_channel
  ON channel_publish_integrations(channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_publish_settings_channel
  ON channel_publish_settings(channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_youtube_oauth_states_expires
  ON channel_youtube_oauth_states(expires_at);

CREATE INDEX IF NOT EXISTS idx_source_decompositions_chat
  ON source_decompositions(workspace_id, chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_editorial_feedback_channel
  ON channel_editorial_feedback_events(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_editorial_feedback_workspace
  ON channel_editorial_feedback_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_created
  ON audit_log(workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_drafts_thread_user
  ON chat_drafts(thread_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_drafts_user
  ON chat_drafts(user_id);

CREATE INDEX IF NOT EXISTS idx_channels_workspace
  ON channels(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_assets_channel_kind
  ON channel_assets(channel_id, kind);

CREATE INDEX IF NOT EXISTS idx_workspace_templates_workspace_active_updated
  ON workspace_templates(workspace_id, archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_channel
  ON chat_threads(channel_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_workspace
  ON chat_threads(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_events_thread
  ON chat_events(thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_jobs_status
  ON stage3_jobs(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_jobs_workspace
  ON stage3_jobs(workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stage3_jobs_kind_target_dedupe
  ON stage3_jobs(kind, execution_target, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stage2_runs_chat_created
  ON stage2_runs(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage2_runs_status_created
  ON stage2_runs(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_job_events_job
  ON stage3_job_events(job_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stage3_job_artifacts_job
  ON stage3_job_artifacts(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_semantic_input_reservations_key
  ON production_semantic_input_reservations(storage_key, expires_at);

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

CREATE INDEX IF NOT EXISTS idx_copscopes_categories_channel_status
  ON copscopes_source_categories(workspace_id, channel_id, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_copscopes_reels_channel_category_status
  ON copscopes_source_reels(workspace_id, channel_id, category_slug, status, imported_at ASC);

CREATE INDEX IF NOT EXISTS idx_copscopes_reels_shortcode
  ON copscopes_source_reels(workspace_id, channel_id, shortcode);

CREATE INDEX IF NOT EXISTS idx_copscopes_daily_runs_channel_created
  ON copscopes_daily_runs(workspace_id, channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_copscopes_daily_run_items_run
  ON copscopes_daily_run_items(run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_production_profiles_channel_status
  ON production_profiles(workspace_id, channel_id, status, version DESC);

CREATE INDEX IF NOT EXISTS idx_project_kings_source_policy_approvals_current
  ON project_kings_source_policy_approvals(
    workspace_id,
    policy_version,
    policy_sha256,
    source_designations_sha256,
    status
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_runs_request_idempotency
  ON production_runs(workspace_id, request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_runs_status_updated
  ON production_runs(workspace_id, status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_production_run_channels_run
  ON production_run_channels(run_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_source_candidates_buffer
  ON channel_source_candidates(workspace_id, channel_id, status, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_source_candidates_content
  ON channel_source_candidates(workspace_id, channel_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_source_candidates_event
  ON channel_source_candidates(workspace_id, channel_id, event_fingerprint)
  WHERE event_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_items_run_state
  ON production_items(run_id, channel_id, state, item_slot, generation DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_items_one_current_generation
  ON production_items(run_id, channel_id, item_slot)
  WHERE state NOT IN ('replaced', 'quarantined', 'failed');

CREATE INDEX IF NOT EXISTS idx_production_items_lease
  ON production_items(state, lease_expires_at, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_production_events_run_created
  ON production_events(run_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_production_events_item_created
  ON production_events(production_item_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_production_outbox_claim
  ON production_outbox(status, available_at ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_production_daemon_runtime_lease
  ON production_daemon_runtime(lease_expires_at, heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_production_channel_ownership_status
  ON production_channel_ownership(workspace_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_agent_attempts_run_item
  ON agent_attempts(run_id, production_item_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_quality_verdicts_item_gate_hash
  ON quality_verdicts(production_item_id, gate_type, artifact_sha256, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_verifications_item_checked
  ON public_verifications(production_item_id, checked_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_verifications_one_success
  ON public_verifications(production_item_id)
  WHERE verified = 1;

CREATE TRIGGER IF NOT EXISTS production_events_no_update
BEFORE UPDATE ON production_events
BEGIN
  SELECT RAISE(ABORT, 'production_events_append_only');
END;

CREATE TRIGGER IF NOT EXISTS production_events_no_delete
BEFORE DELETE ON production_events
BEGIN
  SELECT RAISE(ABORT, 'production_events_append_only');
END;

${CHANNEL_PUBLICATIONS_PORTFOLIO_OWNERSHIP_FENCE_TRIGGER_SQL}

CREATE TRIGGER IF NOT EXISTS production_outbox_portfolio_stop_fence
BEFORE INSERT ON production_outbox
WHEN EXISTS (
  SELECT 1 FROM production_channel_ownership ownership
  WHERE ownership.workspace_id = NEW.workspace_id
    AND ownership.channel_id = NEW.channel_id
    AND ownership.status = 'releasing'
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_channel_ownership_releasing');
END;
`;
