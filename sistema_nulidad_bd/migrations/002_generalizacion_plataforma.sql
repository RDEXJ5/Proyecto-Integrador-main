-- Migración 002: generalización de la plataforma jurídica y preparación para MinIO.
-- Motor objetivo: MySQL 8.4+ / InnoDB / utf8mb4.
--
-- Propiedades de esta migración:
--   * Es aditiva: no elimina tablas, columnas ni registros existentes.
--   * Conserva los binarios históricos almacenados en MySQL.
--   * Introduce catálogos y asignaciones para materias jurídicas generales.
--   * Agrega políticas por versión, origen de carga y almacenamiento de objetos.
--   * Las nuevas tablas probatorias también bloquean DELETE.

USE juzgado_nulidad_documental;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version_code VARCHAR(40) PRIMARY KEY,
  description VARCHAR(500) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- La API nueva utilizará concesiones con estado para poder revocar sin borrar.
CREATE TABLE IF NOT EXISTS user_role_grants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(30) NOT NULL,
  grant_status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  granted_by_user_id BIGINT UNSIGNED NULL,
  grant_reason VARCHAR(1000) NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  revoked_by_user_id BIGINT UNSIGNED NULL,
  revocation_reason VARCHAR(1000) NULL,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN grant_status = 'active' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_user_role_grant_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_role_grant_role FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT fk_user_role_grant_granter FOREIGN KEY (granted_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_user_role_grant_revoker FOREIGN KEY (revoked_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_active_user_role_grant UNIQUE (user_id, role_code, active_slot),
  INDEX idx_user_role_grants_role (role_code, grant_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permission_grants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(30) NOT NULL,
  permission_code VARCHAR(60) NOT NULL,
  grant_status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  granted_by_user_id BIGINT UNSIGNED NULL,
  grant_reason VARCHAR(1000) NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  revoked_by_user_id BIGINT UNSIGNED NULL,
  revocation_reason VARCHAR(1000) NULL,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN grant_status = 'active' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_role_permission_grant_role FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT fk_role_permission_grant_permission FOREIGN KEY (permission_code) REFERENCES permissions(code),
  CONSTRAINT fk_role_permission_grant_granter FOREIGN KEY (granted_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_role_permission_grant_revoker FOREIGN KEY (revoked_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_active_role_permission_grant UNIQUE (role_code, permission_code, active_slot),
  INDEX idx_role_permission_grants_permission (permission_code, grant_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_status_changes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  previous_status VARCHAR(30) NOT NULL,
  new_status VARCHAR(30) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_status_change_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_status_change_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
  INDEX idx_user_status_changes_user (user_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS legal_areas (
  code VARCHAR(30) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_types (
  code VARCHAR(50) PRIMARY KEY,
  legal_area_code VARCHAR(30) NOT NULL,
  label VARCHAR(160) NOT NULL,
  description VARCHAR(700) NOT NULL,
  default_confidentiality ENUM('internal', 'confidential', 'restricted') NOT NULL DEFAULT 'confidential',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_type_legal_area FOREIGN KEY (legal_area_code) REFERENCES legal_areas(code),
  INDEX idx_case_types_area (legal_area_code, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS organizational_units (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  unit_type ENUM(
    'court', 'chamber', 'tribunal', 'prosecutor_office',
    'public_defense', 'expert_unit', 'administrative'
  ) NOT NULL,
  parent_unit_id BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deactivated_at TIMESTAMP NULL,
  CONSTRAINT fk_organizational_unit_parent FOREIGN KEY (parent_unit_id) REFERENCES organizational_units(id),
  INDEX idx_organizational_units_type (unit_type, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_unit_memberships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  organizational_unit_id BIGINT UNSIGNED NOT NULL,
  membership_type ENUM('member', 'supervisor', 'auditor') NOT NULL DEFAULT 'member',
  membership_status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  membership_reason VARCHAR(1000) NOT NULL,
  granted_by_user_id BIGINT UNSIGNED NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  revoked_by_user_id BIGINT UNSIGNED NULL,
  revocation_reason VARCHAR(1000) NULL,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN membership_status = 'active' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_unit_membership_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_unit_membership_unit FOREIGN KEY (organizational_unit_id) REFERENCES organizational_units(id),
  CONSTRAINT fk_unit_membership_granter FOREIGN KEY (granted_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_unit_membership_revoker FOREIGN KEY (revoked_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_active_unit_membership UNIQUE (
    user_id, organizational_unit_id, membership_type, active_slot
  ),
  INDEX idx_unit_memberships_unit (organizational_unit_id, membership_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_profiles (
  case_id BIGINT UNSIGNED PRIMARY KEY,
  case_type_code VARCHAR(50) NOT NULL,
  organizational_unit_id BIGINT UNSIGNED NOT NULL,
  external_reference VARCHAR(100) NULL,
  jurisdiction VARCHAR(160) NULL,
  confidentiality_level ENUM('internal', 'confidential', 'restricted') NOT NULL DEFAULT 'confidential',
  lifecycle_status ENUM('draft', 'active', 'paused', 'closed', 'annulled', 'archived') NOT NULL DEFAULT 'active',
  visibility_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
  current_stage_code VARCHAR(64) NULL,
  status_reason VARCHAR(1000) NOT NULL,
  status_changed_by_user_id BIGINT UNSIGNED NOT NULL,
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden_at TIMESTAMP NULL,
  hidden_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_profile_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_profile_type FOREIGN KEY (case_type_code) REFERENCES case_types(code),
  CONSTRAINT fk_case_profile_unit FOREIGN KEY (organizational_unit_id) REFERENCES organizational_units(id),
  CONSTRAINT fk_case_profile_status_actor FOREIGN KEY (status_changed_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_profile_hidden_actor FOREIGN KEY (hidden_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_case_profile_hidden CHECK (
    visibility_status = 'visible'
    OR (hidden_at IS NOT NULL AND hidden_by_user_id IS NOT NULL)
  ),
  INDEX idx_case_profiles_type (case_type_code, lifecycle_status),
  INDEX idx_case_profiles_unit (organizational_unit_id, lifecycle_status),
  INDEX idx_case_profiles_visibility (visibility_status, lifecycle_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_profile_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  previous_lifecycle_status VARCHAR(30) NULL,
  new_lifecycle_status VARCHAR(30) NOT NULL,
  previous_visibility_status VARCHAR(30) NULL,
  new_visibility_status VARCHAR(30) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_profile_history_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_profile_history_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
  INDEX idx_case_profile_history_case (case_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_assignment_types (
  code VARCHAR(40) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  related_role_code VARCHAR(30) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_assignment_type_role FOREIGN KEY (related_role_code) REFERENCES roles(code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  assignment_type_code VARCHAR(40) NOT NULL,
  assignment_scope ENUM('full', 'documental', 'procedural', 'review', 'audit') NOT NULL DEFAULT 'full',
  assignment_status ENUM('active', 'completed', 'revoked') NOT NULL DEFAULT 'active',
  assignment_reason VARCHAR(1000) NOT NULL,
  assigned_by_user_id BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  ended_by_user_id BIGINT UNSIGNED NULL,
  ending_reason VARCHAR(1000) NULL,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN assignment_status = 'active' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_case_assignment_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_assignment_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_case_assignment_type FOREIGN KEY (assignment_type_code) REFERENCES case_assignment_types(code),
  CONSTRAINT fk_case_assignment_assigner FOREIGN KEY (assigned_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_assignment_ender FOREIGN KEY (ended_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_case_assignment_end CHECK (
    assignment_status = 'active'
    OR (ended_at IS NOT NULL AND ended_by_user_id IS NOT NULL AND ending_reason IS NOT NULL)
  ),
  CONSTRAINT uq_active_case_assignment UNIQUE (case_id, user_id, assignment_type_code, active_slot),
  INDEX idx_case_assignments_user (user_id, assignment_status),
  INDEX idx_case_assignments_case (case_id, assignment_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_participant_role_types (
  code VARCHAR(40) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_participant_roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  participant_role_code VARCHAR(40) NOT NULL,
  participation_status ENUM('active', 'withdrawn', 'inactive') NOT NULL DEFAULT 'active',
  added_by_user_id BIGINT UNSIGNED NOT NULL,
  participation_reason VARCHAR(1000) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  ended_by_user_id BIGINT UNSIGNED NULL,
  ending_reason VARCHAR(1000) NULL,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN participation_status = 'active' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_case_participant_role_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_participant_role_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_case_participant_role_type FOREIGN KEY (participant_role_code) REFERENCES case_participant_role_types(code),
  CONSTRAINT fk_case_participant_role_adder FOREIGN KEY (added_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_participant_role_ender FOREIGN KEY (ended_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_active_case_participant_role UNIQUE (case_id, user_id, participant_role_code, active_slot),
  INDEX idx_case_participant_roles_user (user_id, participation_status),
  INDEX idx_case_participant_roles_case (case_id, participation_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_stage_definitions (
  case_type_code VARCHAR(50) NOT NULL,
  stage_code VARCHAR(64) NOT NULL,
  label VARCHAR(140) NOT NULL,
  sequence_number INT UNSIGNED NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (case_type_code, stage_code),
  CONSTRAINT fk_stage_definition_case_type FOREIGN KEY (case_type_code) REFERENCES case_types(code),
  CONSTRAINT uq_stage_definition_sequence UNIQUE (case_type_code, sequence_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_stage_transitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  previous_stage_code VARCHAR(64) NULL,
  new_stage_code VARCHAR(64) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_stage_transition_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_stage_transition_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
  INDEX idx_case_stage_transitions_case (case_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_deadlines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  stage_code VARCHAR(64) NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(1000) NULL,
  due_at TIMESTAMP NOT NULL,
  assigned_user_id BIGINT UNSIGNED NULL,
  deadline_status ENUM('pending', 'completed', 'overdue', 'cancelled') NOT NULL DEFAULT 'pending',
  status_reason VARCHAR(1000) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_deadline_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_deadline_assignee FOREIGN KEY (assigned_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_deadline_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_case_deadlines_due (deadline_status, due_at),
  INDEX idx_case_deadlines_case (case_id, deadline_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_type_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_code VARCHAR(100) NOT NULL UNIQUE,
  document_type_code VARCHAR(64) NOT NULL,
  case_type_code VARCHAR(50) NULL,
  stage_code VARCHAR(64) NULL,
  embedded_signature_policy ENUM('none', 'optional', 'required', 'conditional') NOT NULL DEFAULT 'none',
  platform_signature_policy ENUM('none', 'optional', 'required', 'conditional') NOT NULL DEFAULT 'none',
  minimum_platform_signatures INT UNSIGNED NOT NULL DEFAULT 0,
  signer_match_policy ENUM('any', 'all') NOT NULL DEFAULT 'any',
  requires_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  authorization_role_code VARCHAR(30) NULL,
  requires_certification BOOLEAN NOT NULL DEFAULT FALSE,
  certification_role_code VARCHAR(30) NULL,
  analyzer_policy ENUM('skip', 'on_demand', 'automatic') NOT NULL DEFAULT 'skip',
  priority INT NOT NULL DEFAULT 100,
  effective_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to TIMESTAMP NULL,
  rule_status ENUM('active', 'superseded', 'inactive') NOT NULL DEFAULT 'active',
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  case_type_scope VARCHAR(50) GENERATED ALWAYS AS (COALESCE(case_type_code, '*')) STORED,
  stage_scope VARCHAR(64) GENERATED ALWAYS AS (COALESCE(stage_code, '*')) STORED,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN rule_status = 'active' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_document_rule_type FOREIGN KEY (document_type_code) REFERENCES document_types(code),
  CONSTRAINT fk_document_rule_case_type FOREIGN KEY (case_type_code) REFERENCES case_types(code),
  CONSTRAINT fk_document_rule_authorization_role FOREIGN KEY (authorization_role_code) REFERENCES roles(code),
  CONSTRAINT fk_document_rule_certification_role FOREIGN KEY (certification_role_code) REFERENCES roles(code),
  CONSTRAINT fk_document_rule_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_document_rule_platform_count CHECK (
    (platform_signature_policy = 'none' AND minimum_platform_signatures = 0)
    OR (platform_signature_policy <> 'none' AND minimum_platform_signatures > 0)
  ),
  CONSTRAINT chk_document_rule_authorization_role CHECK (
    requires_authorization = FALSE OR authorization_role_code IS NOT NULL
  ),
  CONSTRAINT chk_document_rule_certification_role CHECK (
    requires_certification = FALSE OR certification_role_code IS NOT NULL
  ),
  CONSTRAINT uq_active_document_rule UNIQUE (
    document_type_code, case_type_scope, stage_scope, priority, active_slot
  ),
  INDEX idx_document_rules_resolution (
    document_type_code, case_type_code, stage_code, rule_status, priority
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_rule_signer_roles (
  document_type_rule_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(30) NOT NULL,
  minimum_signatures INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (document_type_rule_id, role_code),
  CONSTRAINT fk_document_rule_signer_rule FOREIGN KEY (document_type_rule_id) REFERENCES document_type_rules(id),
  CONSTRAINT fk_document_rule_signer_role FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT chk_document_rule_signer_minimum CHECK (minimum_signatures > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_version_policies (
  document_version_id BIGINT UNSIGNED PRIMARY KEY,
  document_type_rule_id BIGINT UNSIGNED NULL,
  document_type_code VARCHAR(64) NOT NULL,
  embedded_signature_policy ENUM('none', 'optional', 'required', 'conditional') NOT NULL,
  platform_signature_policy ENUM('none', 'optional', 'required', 'conditional') NOT NULL,
  minimum_platform_signatures INT UNSIGNED NOT NULL DEFAULT 0,
  signer_match_policy ENUM('any', 'all') NOT NULL DEFAULT 'any',
  requires_authorization BOOLEAN NOT NULL,
  authorization_role_code VARCHAR(30) NULL,
  requires_certification BOOLEAN NOT NULL,
  certification_role_code VARCHAR(30) NULL,
  analyzer_policy ENUM('skip', 'on_demand', 'automatic') NOT NULL,
  policy_snapshot JSON NOT NULL,
  snapshotted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_version_policy_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_version_policy_rule FOREIGN KEY (document_type_rule_id) REFERENCES document_type_rules(id),
  CONSTRAINT fk_version_policy_type FOREIGN KEY (document_type_code) REFERENCES document_types(code),
  CONSTRAINT fk_version_policy_authorization_role FOREIGN KEY (authorization_role_code) REFERENCES roles(code),
  CONSTRAINT fk_version_policy_certification_role FOREIGN KEY (certification_role_code) REFERENCES roles(code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_version_metadata (
  document_version_id BIGINT UNSIGNED PRIMARY KEY,
  upload_source ENUM('web_file', 'mobile_file', 'mobile_camera', 'legacy_database') NOT NULL,
  client_channel ENUM('web', 'mobile', 'api', 'system') NOT NULL,
  source_device JSON NULL,
  upload_ip_address VARCHAR(45) NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_version_metadata_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS storage_objects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  object_role ENUM('original', 'preview', 'ocr_output', 'analysis_output', 'signed_derivative') NOT NULL,
  storage_provider ENUM('minio', 's3', 'legacy_database') NOT NULL,
  bucket_name VARCHAR(120) NULL,
  object_key VARCHAR(700) NOT NULL,
  provider_version_id VARCHAR(300) NULL,
  legacy_binary_object_id BIGINT UNSIGNED NULL,
  original_filename VARCHAR(255) NOT NULL,
  detected_mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  storage_status ENUM('quarantine', 'validating', 'available', 'rejected', 'archived') NOT NULL,
  storage_tier ENUM('active', 'deep_archive') NOT NULL DEFAULT 'active',
  compression_algorithm VARCHAR(50) NULL,
  encryption_algorithm VARCHAR(80) NOT NULL,
  retention_mode ENUM('none', 'governance', 'compliance', 'legal_hold') NOT NULL DEFAULT 'none',
  retain_until TIMESTAMP NULL,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_at TIMESTAMP NULL,
  provider_version_key VARCHAR(300) GENERATED ALWAYS AS (
    COALESCE(provider_version_id, 'current')
  ) STORED,
  CONSTRAINT fk_storage_object_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_storage_object_legacy_binary FOREIGN KEY (legacy_binary_object_id) REFERENCES document_binary_objects(id),
  CONSTRAINT fk_storage_object_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_storage_object_size CHECK (size_bytes > 0),
  CONSTRAINT chk_storage_object_location CHECK (
    (storage_provider = 'legacy_database' AND legacy_binary_object_id IS NOT NULL)
    OR (storage_provider <> 'legacy_database' AND bucket_name IS NOT NULL)
  ),
  CONSTRAINT uq_storage_object_version UNIQUE (
    document_version_id, object_role, storage_provider, provider_version_key
  ),
  INDEX idx_storage_objects_hash (sha256),
  INDEX idx_storage_objects_status (storage_status, storage_tier)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_analysis_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  analysis_type ENUM('malware_scan', 'ocr', 'signature_detection', 'classification', 'signature_validation') NOT NULL,
  provider_code VARCHAR(80) NOT NULL,
  job_status ENUM('queued', 'running', 'succeeded', 'failed', 'manual_review', 'cancelled') NOT NULL DEFAULT 'queued',
  attempt_number INT UNSIGNED NOT NULL DEFAULT 1,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  error_code VARCHAR(100) NULL,
  error_message VARCHAR(1000) NULL,
  CONSTRAINT fk_analysis_job_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_analysis_job_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_analysis_job_attempt UNIQUE (document_version_id, analysis_type, provider_code, attempt_number),
  INDEX idx_analysis_jobs_status (job_status, requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_analysis_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_analysis_job_id BIGINT UNSIGNED NOT NULL,
  result_code VARCHAR(80) NOT NULL,
  confidence_score DECIMAL(6,5) NULL,
  findings JSON NOT NULL,
  analyzer_name VARCHAR(120) NOT NULL,
  analyzer_version VARCHAR(80) NOT NULL,
  input_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_analysis_result_job FOREIGN KEY (document_analysis_job_id) REFERENCES document_analysis_jobs(id),
  CONSTRAINT chk_analysis_confidence CHECK (
    confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)
  ),
  INDEX idx_analysis_results_job (document_analysis_job_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_observations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  observation_type ENUM('comment', 'correction_required', 'clarification_required', 'legal_review') NOT NULL,
  body VARCHAR(3000) NOT NULL,
  observation_status ENUM('open', 'responded', 'resolved', 'withdrawn') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  resolved_by_user_id BIGINT UNSIGNED NULL,
  resolution_note VARCHAR(2000) NULL,
  CONSTRAINT fk_document_observation_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_document_observation_author FOREIGN KEY (author_user_id) REFERENCES users(id),
  CONSTRAINT fk_document_observation_resolver FOREIGN KEY (resolved_by_user_id) REFERENCES users(id),
  INDEX idx_document_observations_status (document_version_id, observation_status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(40) NOT NULL,
  outcome ENUM('noted', 'approved', 'rejected', 'returned') NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  actor_role_code VARCHAR(30) NOT NULL,
  note VARCHAR(2000) NULL,
  source_table VARCHAR(80) NULL,
  source_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_key VARCHAR(180) GENERATED ALWAYS AS (
    CASE
      WHEN source_table IS NULL OR source_id IS NULL THEN NULL
      ELSE CONCAT(source_table, ':', source_id)
    END
  ) STORED,
  CONSTRAINT fk_document_action_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_document_action_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_document_action_role FOREIGN KEY (actor_role_code) REFERENCES roles(code),
  CONSTRAINT uq_document_action_source UNIQUE (source_key),
  INDEX idx_document_actions_version (document_version_id, action_code, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_signature_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  signer_user_id BIGINT UNSIGNED NULL,
  signer_role_code VARCHAR(30) NULL,
  signature_kind ENUM('platform_digital', 'pdf_digital', 'electronic_external', 'visual_detected') NOT NULL,
  algorithm VARCHAR(80) NULL,
  public_certificate TEXT NULL,
  signature_value TEXT NULL,
  signed_digest CHAR(64) NOT NULL,
  verification_status ENUM('pending', 'valid', 'invalid', 'manual_review', 'not_applicable') NOT NULL DEFAULT 'pending',
  verification_details JSON NULL,
  signed_at TIMESTAMP NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_table VARCHAR(80) NULL,
  source_id BIGINT UNSIGNED NULL,
  source_key VARCHAR(180) GENERATED ALWAYS AS (
    CASE
      WHEN source_table IS NULL OR source_id IS NULL THEN NULL
      ELSE CONCAT(source_table, ':', source_id)
    END
  ) STORED,
  CONSTRAINT fk_signature_record_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_signature_record_signer FOREIGN KEY (signer_user_id) REFERENCES users(id),
  CONSTRAINT fk_signature_record_role FOREIGN KEY (signer_role_code) REFERENCES roles(code),
  CONSTRAINT uq_signature_record_source UNIQUE (source_key),
  INDEX idx_signature_records_version (document_version_id, verification_status, recorded_at)
) ENGINE=InnoDB;

-- Las versiones futuras podrán residir solo en MinIO. Los registros históricos
-- conservan su binary_object_id y siguen protegidos por los triggers originales.
ALTER TABLE document_versions
  MODIFY COLUMN binary_object_id BIGINT UNSIGNED NULL;

INSERT INTO roles (code, label, channel, description) VALUES
  ('prosecutor', 'Fiscal', 'web', 'Aporta documentos y da seguimiento a los asuntos donde fue asignado.'),
  ('defender', 'Defensor', 'web', 'Aporta documentos y da seguimiento a la defensa asignada.'),
  ('expert', 'Perito', 'web', 'Carga dictámenes y atiende observaciones de los expedientes designados.'),
  ('secretary', 'Secretario', 'web', 'Opera expedientes, asignaciones, etapas y plazos.'),
  ('coordinator', 'Coordinador', 'web', 'Supervisa la gestión procesal dentro de su unidad.'),
  ('auditor', 'Auditor', 'web', 'Consulta trazabilidad y evidencia histórica en modo de solo lectura.')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), channel = VALUES(channel), description = VALUES(description);

INSERT INTO permissions (code, description) VALUES
  ('workspace.contribution.access', 'Acceder al espacio de carga y seguimiento.'),
  ('workspace.review.access', 'Acceder al espacio de revisión y decisión.'),
  ('workspace.process.access', 'Acceder al espacio de gestión procesal.'),
  ('workspace.audit.access', 'Acceder al espacio de auditoría.'),
  ('workspace.administration.access', 'Acceder al espacio de administración técnica.'),
  ('case.read.unit', 'Consultar expedientes autorizados dentro de una unidad organizativa.'),
  ('case.read.audit', 'Consultar metadatos históricos de expedientes para auditoría.'),
  ('case.create', 'Crear un expediente sin eliminar ni sobrescribir otro.'),
  ('case.classify', 'Clasificar un expediente por materia, tipo y confidencialidad.'),
  ('case.assign', 'Asignar responsables a un expediente.'),
  ('case.stage.manage', 'Registrar transiciones de etapa procesal.'),
  ('case.deadline.manage', 'Crear, completar o cancelar plazos conservando historial.'),
  ('case.participant.manage', 'Registrar o inactivar participantes sin eliminarlos.'),
  ('case.visibility.manage', 'Ocultar o reactivar lógicamente un expediente.'),
  ('document.read.assigned', 'Consultar metadatos documentales de expedientes asignados.'),
  ('document.upload', 'Cargar un archivo existente y registrar su tipo y origen.'),
  ('document.observation.create', 'Emitir observaciones sobre una versión documental.'),
  ('document.observation.respond', 'Responder observaciones sobre documentos aportados.'),
  ('document.observation.resolve', 'Resolver una observación de forma auditable.'),
  ('document.review', 'Registrar la revisión de una versión documental.'),
  ('document.certify', 'Certificar una versión documental cuando su política lo requiera.'),
  ('decision.issue', 'Emitir una decisión dentro de un expediente asignado.'),
  ('audit.report', 'Generar reportes a partir de eventos históricos.'),
  ('user.manage', 'Crear, suspender y reactivar cuentas sin eliminarlas.'),
  ('role.manage', 'Otorgar o revocar roles y permisos conservando historial.'),
  ('catalog.manage', 'Gestionar catálogos mediante activación y desactivación lógica.'),
  ('configuration.manage', 'Gestionar configuración técnica de la plataforma.'),
  ('system.health.read', 'Consultar salud de API, base de datos y almacenamiento.'),
  ('storage.object.create', 'Registrar objetos documentales en almacenamiento privado.'),
  ('storage.object.read', 'Consultar objetos documentales tras autorización por recurso.'),
  ('analysis.request', 'Solicitar OCR, clasificación o análisis de firmas.'),
  ('analysis.read', 'Consultar resultados de análisis autorizados.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Los grants heredados se conservan como revocados para mantener el rastro, pero
-- la API general utilizará exclusivamente concesiones activas de esta tabla.
INSERT INTO role_permission_grants (
  role_code, permission_code, grant_status, grant_reason,
  revoked_at, revocation_reason
)
SELECT
  legacy.role_code,
  legacy.permission_code,
  'revoked',
  'Concesión heredada de role_permissions durante la migración 002.',
  CURRENT_TIMESTAMP,
  'Reemplazada por la matriz funcional de espacios de trabajo.'
FROM role_permissions legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permission_grants existing
  WHERE existing.role_code = legacy.role_code
    AND existing.permission_code = legacy.permission_code
    AND existing.grant_status = 'revoked'
    AND existing.grant_reason LIKE 'Concesión heredada%'
);

INSERT INTO user_role_grants (
  user_id, role_code, grant_status, granted_by_user_id, grant_reason, granted_at
)
SELECT
  legacy.user_id,
  legacy.role_code,
  'active',
  legacy.assigned_by_user_id,
  'Rol activo migrado desde user_roles por la migración 002.',
  legacy.assigned_at
FROM user_roles legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM user_role_grants existing
  WHERE existing.user_id = legacy.user_id
    AND existing.role_code = legacy.role_code
    AND existing.grant_status = 'active'
);

-- Matriz de permisos activa por espacio de trabajo.
INSERT IGNORE INTO role_permission_grants (
  role_code, permission_code, grant_status, grant_reason
)
SELECT grants.role_code, grants.permission_code, 'active', 'Matriz funcional aprobada en migración 002.'
FROM (
  SELECT 'lawyer' role_code, 'workspace.contribution.access' permission_code UNION ALL
  SELECT 'lawyer', 'case.read.assigned' UNION ALL
  SELECT 'lawyer', 'document.read.assigned' UNION ALL
  SELECT 'lawyer', 'document.upload' UNION ALL
  SELECT 'lawyer', 'document.version.create' UNION ALL
  SELECT 'lawyer', 'document.observation.respond' UNION ALL
  SELECT 'prosecutor', 'workspace.contribution.access' UNION ALL
  SELECT 'prosecutor', 'case.read.assigned' UNION ALL
  SELECT 'prosecutor', 'document.read.assigned' UNION ALL
  SELECT 'prosecutor', 'document.upload' UNION ALL
  SELECT 'prosecutor', 'document.version.create' UNION ALL
  SELECT 'prosecutor', 'document.observation.respond' UNION ALL
  SELECT 'defender', 'workspace.contribution.access' UNION ALL
  SELECT 'defender', 'case.read.assigned' UNION ALL
  SELECT 'defender', 'document.read.assigned' UNION ALL
  SELECT 'defender', 'document.upload' UNION ALL
  SELECT 'defender', 'document.version.create' UNION ALL
  SELECT 'defender', 'document.observation.respond' UNION ALL
  SELECT 'expert', 'workspace.contribution.access' UNION ALL
  SELECT 'expert', 'case.read.assigned' UNION ALL
  SELECT 'expert', 'document.read.assigned' UNION ALL
  SELECT 'expert', 'document.upload' UNION ALL
  SELECT 'expert', 'document.version.create' UNION ALL
  SELECT 'expert', 'document.observation.respond' UNION ALL
  SELECT 'judge', 'workspace.review.access' UNION ALL
  SELECT 'judge', 'case.read.assigned' UNION ALL
  SELECT 'judge', 'document.read.assigned' UNION ALL
  SELECT 'judge', 'document.content.read.web' UNION ALL
  SELECT 'judge', 'document.download.web' UNION ALL
  SELECT 'judge', 'document.review' UNION ALL
  SELECT 'judge', 'document.observation.create' UNION ALL
  SELECT 'judge', 'decision.issue' UNION ALL
  SELECT 'judge', 'document.sign' UNION ALL
  SELECT 'notary', 'workspace.review.access' UNION ALL
  SELECT 'notary', 'case.read.assigned' UNION ALL
  SELECT 'notary', 'document.read.assigned' UNION ALL
  SELECT 'notary', 'document.content.read.web' UNION ALL
  SELECT 'notary', 'document.download.web' UNION ALL
  SELECT 'notary', 'document.review' UNION ALL
  SELECT 'notary', 'document.observation.create' UNION ALL
  SELECT 'notary', 'document.authorize' UNION ALL
  SELECT 'notary', 'document.certify' UNION ALL
  SELECT 'secretary', 'workspace.process.access' UNION ALL
  SELECT 'secretary', 'case.read.unit' UNION ALL
  SELECT 'secretary', 'case.create' UNION ALL
  SELECT 'secretary', 'case.classify' UNION ALL
  SELECT 'secretary', 'case.assign' UNION ALL
  SELECT 'secretary', 'case.stage.manage' UNION ALL
  SELECT 'secretary', 'case.deadline.manage' UNION ALL
  SELECT 'secretary', 'case.participant.manage' UNION ALL
  SELECT 'secretary', 'document.read.assigned' UNION ALL
  SELECT 'coordinator', 'workspace.process.access' UNION ALL
  SELECT 'coordinator', 'case.read.unit' UNION ALL
  SELECT 'coordinator', 'case.create' UNION ALL
  SELECT 'coordinator', 'case.classify' UNION ALL
  SELECT 'coordinator', 'case.assign' UNION ALL
  SELECT 'coordinator', 'case.stage.manage' UNION ALL
  SELECT 'coordinator', 'case.deadline.manage' UNION ALL
  SELECT 'coordinator', 'case.participant.manage' UNION ALL
  SELECT 'coordinator', 'case.visibility.manage' UNION ALL
  SELECT 'coordinator', 'document.read.assigned' UNION ALL
  SELECT 'auditor', 'workspace.audit.access' UNION ALL
  SELECT 'auditor', 'case.read.audit' UNION ALL
  SELECT 'auditor', 'audit.read' UNION ALL
  SELECT 'auditor', 'audit.report' UNION ALL
  SELECT 'auditor', 'analysis.read' UNION ALL
  SELECT 'party', 'case.read.assigned' UNION ALL
  SELECT 'party', 'document.read.assigned' UNION ALL
  SELECT 'party', 'document.upload' UNION ALL
  SELECT 'party', 'document.version.create' UNION ALL
  SELECT 'witness', 'case.read.assigned' UNION ALL
  SELECT 'witness', 'document.read.assigned' UNION ALL
  SELECT 'witness', 'document.upload' UNION ALL
  SELECT 'witness', 'document.version.create' UNION ALL
  SELECT 'admin', 'workspace.administration.access' UNION ALL
  SELECT 'admin', 'user.manage' UNION ALL
  SELECT 'admin', 'role.manage' UNION ALL
  SELECT 'admin', 'catalog.manage' UNION ALL
  SELECT 'admin', 'configuration.manage' UNION ALL
  SELECT 'admin', 'system.health.read'
) grants;

INSERT INTO legal_areas (code, label, description) VALUES
  ('family', 'Familiar', 'Asuntos familiares, matrimoniales y de estado civil.'),
  ('criminal', 'Penal', 'Investigación, acusación, defensa y resolución de asuntos penales.'),
  ('civil', 'Civil', 'Controversias civiles y obligaciones entre particulares.'),
  ('commercial', 'Mercantil', 'Controversias y procedimientos de naturaleza mercantil.'),
  ('labor', 'Laboral', 'Conflictos y procedimientos en materia de trabajo.'),
  ('administrative', 'Administrativa', 'Procedimientos y controversias administrativas.'),
  ('constitutional', 'Constitucional', 'Control constitucional y protección de derechos.'),
  ('other', 'Otra', 'Materia configurable no incluida en los catálogos iniciales.')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description), is_active = TRUE;

INSERT INTO case_types (
  code, legal_area_code, label, description, default_confidentiality
) VALUES
  ('matrimonial_nullity', 'family', 'Nulidad matrimonial', 'Procedimiento de nulidad matrimonial.', 'restricted'),
  ('family_proceeding', 'family', 'Procedimiento familiar', 'Asunto general de materia familiar.', 'restricted'),
  ('criminal_proceeding', 'criminal', 'Procedimiento penal', 'Asunto general de materia penal.', 'restricted'),
  ('civil_proceeding', 'civil', 'Procedimiento civil', 'Asunto general de materia civil.', 'confidential'),
  ('commercial_proceeding', 'commercial', 'Procedimiento mercantil', 'Asunto general de materia mercantil.', 'confidential'),
  ('labor_proceeding', 'labor', 'Procedimiento laboral', 'Asunto general de materia laboral.', 'confidential'),
  ('administrative_proceeding', 'administrative', 'Procedimiento administrativo', 'Asunto general de materia administrativa.', 'confidential'),
  ('constitutional_proceeding', 'constitutional', 'Procedimiento constitucional', 'Asunto general de materia constitucional.', 'restricted'),
  ('other_proceeding', 'other', 'Otro procedimiento', 'Tipo configurable para asuntos no catalogados.', 'confidential')
ON DUPLICATE KEY UPDATE
  legal_area_code = VALUES(legal_area_code),
  label = VALUES(label),
  description = VALUES(description),
  default_confidentiality = VALUES(default_confidentiality),
  is_active = TRUE;

INSERT INTO organizational_units (code, name, unit_type)
VALUES ('legacy_court', 'Unidad jurisdiccional migrada', 'court')
ON DUPLICATE KEY UPDATE name = VALUES(name), unit_type = VALUES(unit_type), is_active = TRUE;

INSERT INTO case_assignment_types (code, label, description, related_role_code) VALUES
  ('lawyer', 'Abogado responsable', 'Representación jurídica asignada.', 'lawyer'),
  ('prosecutor', 'Fiscal asignado', 'Intervención fiscal asignada.', 'prosecutor'),
  ('defender', 'Defensor asignado', 'Defensa jurídica asignada.', 'defender'),
  ('expert', 'Perito designado', 'Intervención pericial acotada al asunto.', 'expert'),
  ('judge', 'Juez asignado', 'Responsable de revisión y decisión judicial.', 'judge'),
  ('notary', 'Notario asignado', 'Responsable de autorización y certificación documental.', 'notary'),
  ('secretary', 'Secretario responsable', 'Operación procesal del expediente.', 'secretary'),
  ('coordinator', 'Coordinador responsable', 'Supervisión procesal de la unidad.', 'coordinator')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description),
  related_role_code = VALUES(related_role_code), is_active = TRUE;

INSERT INTO case_participant_role_types (code, label, description) VALUES
  ('petitioner', 'Promovente', 'Persona que promueve el asunto.'),
  ('respondent', 'Parte demandada', 'Persona frente a quien se promueve el asunto.'),
  ('witness', 'Testigo', 'Persona que aporta testimonio.'),
  ('victim', 'Víctima', 'Persona reconocida como víctima u ofendida.'),
  ('defendant', 'Imputado o acusado', 'Persona sujeta al procedimiento penal.'),
  ('complainant', 'Denunciante o querellante', 'Persona que presenta denuncia o querella.'),
  ('interested_party', 'Tercero interesado', 'Persona con interés jurídico reconocido.'),
  ('legal_representative', 'Representante legal', 'Representante de una parte o entidad.')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description), is_active = TRUE;

INSERT INTO case_stage_definitions (
  case_type_code, stage_code, label, sequence_number, is_terminal
)
SELECT case_type.code, stages.stage_code, stages.label, stages.sequence_number, stages.is_terminal
FROM case_types case_type
CROSS JOIN (
  SELECT 'intake' stage_code, 'Recepción y clasificación' label, 10 sequence_number, FALSE is_terminal
  UNION ALL SELECT 'filing', 'Presentación y admisión', 20, FALSE
  UNION ALL SELECT 'evidence', 'Integración y pruebas', 30, FALSE
  UNION ALL SELECT 'hearing', 'Audiencia o revisión', 40, FALSE
  UNION ALL SELECT 'decision', 'Decisión o resolución', 50, FALSE
  UNION ALL SELECT 'closed', 'Concluido', 60, TRUE
) stages
WHERE TRUE
ON DUPLICATE KEY UPDATE
  label = VALUES(label), sequence_number = VALUES(sequence_number),
  is_terminal = VALUES(is_terminal), is_active = TRUE;

INSERT INTO case_profiles (
  case_id, case_type_code, organizational_unit_id, confidentiality_level,
  lifecycle_status, visibility_status, current_stage_code,
  status_reason, status_changed_by_user_id, status_changed_at
)
SELECT
  case_record.id,
  'matrimonial_nullity',
  unit_record.id,
  'restricted',
  CASE case_record.status
    WHEN 'active' THEN 'active'
    WHEN 'paused' THEN 'paused'
    WHEN 'closed' THEN 'closed'
    WHEN 'annulled' THEN 'annulled'
    ELSE 'active'
  END,
  'visible',
  'intake',
  'Perfil general creado para conservar el expediente existente durante la migración 002.',
  case_record.created_by_user_id,
  case_record.updated_at
FROM cases case_record
JOIN organizational_units unit_record ON unit_record.code = 'legacy_court'
WHERE NOT EXISTS (
  SELECT 1 FROM case_profiles existing WHERE existing.case_id = case_record.id
);

INSERT INTO case_profile_status_history (
  case_id, previous_lifecycle_status, new_lifecycle_status,
  previous_visibility_status, new_visibility_status,
  reason, changed_by_user_id, changed_at
)
SELECT
  profile.case_id,
  NULL,
  profile.lifecycle_status,
  NULL,
  profile.visibility_status,
  'Estado inicial registrado por la migración 002.',
  profile.status_changed_by_user_id,
  profile.status_changed_at
FROM case_profiles profile
WHERE NOT EXISTS (
  SELECT 1
  FROM case_profile_status_history history
  WHERE history.case_id = profile.case_id
    AND history.previous_lifecycle_status IS NULL
    AND history.reason = 'Estado inicial registrado por la migración 002.'
);

INSERT INTO case_stage_transitions (
  case_id, previous_stage_code, new_stage_code,
  reason, changed_by_user_id, changed_at
)
SELECT
  profile.case_id,
  NULL,
  profile.current_stage_code,
  'Etapa inicial registrada por la migración 002.',
  profile.status_changed_by_user_id,
  profile.status_changed_at
FROM case_profiles profile
WHERE profile.current_stage_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM case_stage_transitions transition_record
    WHERE transition_record.case_id = profile.case_id
      AND transition_record.previous_stage_code IS NULL
      AND transition_record.reason = 'Etapa inicial registrada por la migración 002.'
  );

INSERT IGNORE INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason, assigned_by_user_id, assigned_at
)
SELECT
  case_record.id,
  case_record.lawyer_user_id,
  'lawyer',
  'full',
  'active',
  'Asignación de abogado migrada desde cases.lawyer_user_id.',
  case_record.created_by_user_id,
  case_record.opened_at
FROM cases case_record;

INSERT IGNORE INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason, assigned_by_user_id, assigned_at
)
SELECT
  case_record.id,
  case_record.judge_user_id,
  'judge',
  'review',
  'active',
  'Asignación de juez migrada desde cases.judge_user_id.',
  case_record.created_by_user_id,
  case_record.opened_at
FROM cases case_record
WHERE case_record.judge_user_id IS NOT NULL;

-- El modelo anterior concedía acceso notarial global. Las asignaciones explícitas
-- conservan ese acceso para expedientes históricos sin perpetuarlo para casos nuevos.
INSERT IGNORE INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason, assigned_by_user_id, assigned_at
)
SELECT
  case_record.id,
  role_assignment.user_id,
  'notary',
  'review',
  'active',
  'Acceso notarial histórico convertido en asignación explícita por la migración 002.',
  case_record.created_by_user_id,
  case_record.opened_at
FROM cases case_record
JOIN user_roles role_assignment ON role_assignment.role_code = 'notary';

INSERT IGNORE INTO case_participant_roles (
  case_id, user_id, participant_role_code, participation_status,
  added_by_user_id, participation_reason, joined_at
)
SELECT
  legacy.case_id,
  legacy.user_id,
  legacy.participation_kind,
  'active',
  case_record.created_by_user_id,
  'Participación migrada desde case_participants.',
  legacy.joined_at
FROM case_participants legacy
JOIN cases case_record ON case_record.id = legacy.case_id;

INSERT INTO document_types (
  code, label, description, owner_scope,
  requires_notarial_authorization, requires_judicial_signature,
  default_sensitive
) VALUES
  ('initial_filing', 'Escrito inicial', 'Promoción o escrito que inicia una actuación.', 'case', FALSE, FALSE, TRUE),
  ('answer_filing', 'Contestación', 'Escrito de contestación o respuesta procesal.', 'case', FALSE, FALSE, TRUE),
  ('evidence', 'Medio de prueba', 'Documento o archivo ofrecido como prueba.', 'case', FALSE, FALSE, TRUE),
  ('expert_report', 'Dictamen pericial', 'Dictamen elaborado por un perito asignado.', 'case', FALSE, FALSE, TRUE),
  ('judicial_resolution', 'Resolución judicial', 'Resolución que puede requerir firma judicial y certificación.', 'case', FALSE, FALSE, TRUE),
  ('procedural_order', 'Acuerdo procesal', 'Acuerdo o determinación de trámite.', 'case', FALSE, FALSE, TRUE),
  ('hearing_record', 'Acta de audiencia', 'Registro documental de una audiencia.', 'case', FALSE, FALSE, TRUE),
  ('notification', 'Notificación', 'Constancia o documento de notificación.', 'case', FALSE, FALSE, TRUE),
  ('official_request', 'Oficio', 'Comunicación oficial emitida dentro del expediente.', 'case', FALSE, FALSE, TRUE),
  ('certified_copy', 'Copia certificada', 'Copia que requiere certificación cuando la regla lo determine.', 'case', FALSE, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description),
  owner_scope = VALUES(owner_scope), default_sensitive = VALUES(default_sensitive),
  is_active = TRUE;

-- Regla general inicial para cada tipo legado. La detección de firmas queda
-- desactivada en identificaciones y comprobantes que no la necesitan.
INSERT INTO document_type_rules (
  rule_code, document_type_code,
  embedded_signature_policy, platform_signature_policy,
  minimum_platform_signatures,
  requires_authorization, authorization_role_code,
  requires_certification, certification_role_code,
  analyzer_policy, priority, rule_status
)
SELECT
  CONCAT('legacy_', document_type.code, '_v1'),
  document_type.code,
  CASE
    WHEN document_type.code = 'judgment' THEN 'required'
    WHEN document_type.code = 'libel' THEN 'conditional'
    ELSE 'none'
  END,
  CASE WHEN document_type.requires_judicial_signature THEN 'required' ELSE 'none' END,
  CASE WHEN document_type.requires_judicial_signature THEN 1 ELSE 0 END,
  document_type.requires_notarial_authorization,
  CASE WHEN document_type.requires_notarial_authorization THEN 'notary' ELSE NULL END,
  document_type.code = 'judgment',
  CASE WHEN document_type.code = 'judgment' THEN 'notary' ELSE NULL END,
  CASE
    WHEN document_type.code IN ('judgment', 'libel') THEN 'automatic'
    ELSE 'skip'
  END,
  100,
  'active'
FROM document_types document_type
WHERE document_type.code NOT IN (
  'initial_filing', 'answer_filing', 'evidence', 'expert_report',
  'judicial_resolution', 'procedural_order', 'hearing_record',
  'notification', 'official_request', 'certified_copy'
)
ON DUPLICATE KEY UPDATE rule_code = VALUES(rule_code);

INSERT INTO document_type_rules (
  rule_code, document_type_code,
  embedded_signature_policy, platform_signature_policy,
  minimum_platform_signatures, signer_match_policy,
  requires_authorization, authorization_role_code,
  requires_certification, certification_role_code,
  analyzer_policy, priority, rule_status
) VALUES
  ('initial_filing_v1', 'initial_filing', 'optional', 'conditional', 1, 'any', FALSE, NULL, FALSE, NULL, 'on_demand', 100, 'active'),
  ('answer_filing_v1', 'answer_filing', 'optional', 'conditional', 1, 'any', FALSE, NULL, FALSE, NULL, 'on_demand', 100, 'active'),
  ('evidence_v1', 'evidence', 'none', 'none', 0, 'any', FALSE, NULL, FALSE, NULL, 'skip', 100, 'active'),
  ('expert_report_v1', 'expert_report', 'optional', 'required', 1, 'any', FALSE, NULL, FALSE, NULL, 'automatic', 100, 'active'),
  ('judicial_resolution_v1', 'judicial_resolution', 'required', 'required', 1, 'any', TRUE, 'notary', TRUE, 'notary', 'automatic', 100, 'active'),
  ('procedural_order_v1', 'procedural_order', 'optional', 'conditional', 1, 'any', FALSE, NULL, FALSE, NULL, 'on_demand', 100, 'active'),
  ('hearing_record_v1', 'hearing_record', 'optional', 'conditional', 1, 'any', FALSE, NULL, FALSE, NULL, 'on_demand', 100, 'active'),
  ('notification_v1', 'notification', 'none', 'none', 0, 'any', FALSE, NULL, FALSE, NULL, 'skip', 100, 'active'),
  ('official_request_v1', 'official_request', 'optional', 'conditional', 1, 'any', FALSE, NULL, FALSE, NULL, 'on_demand', 100, 'active'),
  ('certified_copy_v1', 'certified_copy', 'none', 'none', 0, 'any', FALSE, NULL, TRUE, 'notary', 'skip', 100, 'active')
ON DUPLICATE KEY UPDATE rule_code = VALUES(rule_code);

INSERT IGNORE INTO document_rule_signer_roles (
  document_type_rule_id, role_code, minimum_signatures
)
SELECT rule_record.id, signer.role_code, 1
FROM document_type_rules rule_record
JOIN (
  SELECT 'legacy_judgment_v1' rule_code, 'judge' role_code
  UNION ALL SELECT 'initial_filing_v1', 'lawyer'
  UNION ALL SELECT 'initial_filing_v1', 'prosecutor'
  UNION ALL SELECT 'initial_filing_v1', 'defender'
  UNION ALL SELECT 'answer_filing_v1', 'lawyer'
  UNION ALL SELECT 'answer_filing_v1', 'prosecutor'
  UNION ALL SELECT 'answer_filing_v1', 'defender'
  UNION ALL SELECT 'expert_report_v1', 'expert'
  UNION ALL SELECT 'judicial_resolution_v1', 'judge'
  UNION ALL SELECT 'procedural_order_v1', 'judge'
  UNION ALL SELECT 'procedural_order_v1', 'secretary'
  UNION ALL SELECT 'hearing_record_v1', 'judge'
  UNION ALL SELECT 'hearing_record_v1', 'secretary'
  UNION ALL SELECT 'official_request_v1', 'judge'
  UNION ALL SELECT 'official_request_v1', 'secretary'
) signer ON signer.rule_code = rule_record.rule_code;

INSERT INTO document_version_policies (
  document_version_id, document_type_rule_id, document_type_code,
  embedded_signature_policy, platform_signature_policy,
  minimum_platform_signatures, signer_match_policy,
  requires_authorization, authorization_role_code,
  requires_certification, certification_role_code,
  analyzer_policy, policy_snapshot, snapshotted_at
)
SELECT
  version_record.id,
  rule_record.id,
  document_record.document_type_code,
  rule_record.embedded_signature_policy,
  rule_record.platform_signature_policy,
  rule_record.minimum_platform_signatures,
  rule_record.signer_match_policy,
  rule_record.requires_authorization,
  rule_record.authorization_role_code,
  rule_record.requires_certification,
  rule_record.certification_role_code,
  rule_record.analyzer_policy,
  JSON_OBJECT(
    'migration', '002',
    'ruleCode', rule_record.rule_code,
    'documentType', document_record.document_type_code,
    'embeddedSignaturePolicy', rule_record.embedded_signature_policy,
    'platformSignaturePolicy', rule_record.platform_signature_policy,
    'requiresAuthorization', rule_record.requires_authorization,
    'requiresCertification', rule_record.requires_certification,
    'analyzerPolicy', rule_record.analyzer_policy
  ),
  version_record.created_at
FROM document_versions version_record
JOIN documents document_record ON document_record.id = version_record.document_id
JOIN document_type_rules rule_record
  ON rule_record.rule_code = CONCAT('legacy_', document_record.document_type_code, '_v1')
WHERE NOT EXISTS (
  SELECT 1 FROM document_version_policies existing
  WHERE existing.document_version_id = version_record.id
);

INSERT INTO document_version_metadata (
  document_version_id, upload_source, client_channel,
  source_device, confirmed_at
)
SELECT
  version_record.id,
  'legacy_database',
  'system',
  JSON_OBJECT('migration', '002', 'legacyBinaryObjectId', version_record.binary_object_id),
  version_record.created_at
FROM document_versions version_record
WHERE NOT EXISTS (
  SELECT 1 FROM document_version_metadata existing
  WHERE existing.document_version_id = version_record.id
);

INSERT INTO storage_objects (
  document_version_id, object_role, storage_provider,
  bucket_name, object_key, provider_version_id,
  legacy_binary_object_id, original_filename, detected_mime_type,
  size_bytes, sha256, storage_status, storage_tier,
  compression_algorithm, encryption_algorithm,
  retention_mode, legal_hold,
  created_by_user_id, created_at, available_at
)
SELECT
  version_record.id,
  'original',
  'legacy_database',
  NULL,
  CONCAT('document_binary_objects/', binary_record.id),
  CONCAT('legacy-', binary_record.id),
  binary_record.id,
  version_record.original_name,
  version_record.content_type,
  binary_record.original_size_bytes,
  binary_record.sha256,
  'available',
  binary_record.storage_tier,
  binary_record.compression_algorithm,
  binary_record.encryption_algorithm,
  'legal_hold',
  TRUE,
  version_record.uploaded_by_user_id,
  binary_record.stored_at,
  binary_record.stored_at
FROM document_versions version_record
JOIN document_binary_objects binary_record
  ON binary_record.id = version_record.binary_object_id
WHERE NOT EXISTS (
  SELECT 1
  FROM storage_objects existing
  WHERE existing.document_version_id = version_record.id
    AND existing.object_role = 'original'
    AND existing.storage_provider = 'legacy_database'
);

INSERT INTO document_actions (
  document_version_id, action_code, outcome,
  actor_user_id, actor_role_code, note,
  source_table, source_id, created_at
)
SELECT
  authorization_record.document_version_id,
  'authorize',
  CASE authorization_record.decision
    WHEN 'authorized' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
  END,
  authorization_record.notary_user_id,
  'notary',
  authorization_record.note,
  'document_authorizations',
  authorization_record.id,
  authorization_record.created_at
FROM document_authorizations authorization_record
WHERE NOT EXISTS (
  SELECT 1 FROM document_actions existing
  WHERE existing.source_key = CONCAT('document_authorizations:', authorization_record.id)
);

INSERT INTO document_signature_records (
  document_version_id, signer_user_id, signer_role_code,
  signature_kind, algorithm, public_certificate,
  signature_value, signed_digest, verification_status,
  verification_details, signed_at, recorded_at,
  source_table, source_id
)
SELECT
  signature_record.document_version_id,
  signature_record.judge_user_id,
  'judge',
  'platform_digital',
  signature_record.algorithm,
  signature_record.public_key,
  signature_record.signature_value,
  signature_record.signed_digest,
  'valid',
  JSON_OBJECT('migration', '002', 'legacyValidation', TRUE),
  signature_record.signed_at,
  signature_record.signed_at,
  'document_signatures',
  signature_record.id
FROM document_signatures signature_record
WHERE NOT EXISTS (
  SELECT 1 FROM document_signature_records existing
  WHERE existing.source_key = CONCAT('document_signatures:', signature_record.id)
);

DELIMITER //

DROP TRIGGER IF EXISTS validate_case_profile_state_change//
CREATE TRIGGER validate_case_profile_state_change
BEFORE UPDATE ON case_profiles
FOR EACH ROW
BEGIN
  IF OLD.lifecycle_status <> NEW.lifecycle_status
     OR OLD.visibility_status <> NEW.visibility_status THEN
    IF NEW.status_changed_by_user_id IS NULL
       OR NEW.status_reason IS NULL
       OR CHAR_LENGTH(TRIM(NEW.status_reason)) = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Case state changes require actor and reason';
    END IF;
    SET NEW.status_changed_at = CURRENT_TIMESTAMP;
  END IF;

  IF NEW.visibility_status = 'hidden'
     AND (NEW.hidden_at IS NULL OR NEW.hidden_by_user_id IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Hidden cases require hidden_at and hidden_by_user_id';
  END IF;
END//

DROP TRIGGER IF EXISTS record_case_profile_state_change//
CREATE TRIGGER record_case_profile_state_change
AFTER UPDATE ON case_profiles
FOR EACH ROW
BEGIN
  IF OLD.lifecycle_status <> NEW.lifecycle_status
     OR OLD.visibility_status <> NEW.visibility_status THEN
    INSERT INTO case_profile_status_history (
      case_id, previous_lifecycle_status, new_lifecycle_status,
      previous_visibility_status, new_visibility_status,
      reason, changed_by_user_id, changed_at
    ) VALUES (
      NEW.case_id, OLD.lifecycle_status, NEW.lifecycle_status,
      OLD.visibility_status, NEW.visibility_status,
      NEW.status_reason, NEW.status_changed_by_user_id, NEW.status_changed_at
    );
  END IF;
END//

DROP TRIGGER IF EXISTS protect_user_role_grant_identity//
CREATE TRIGGER protect_user_role_grant_identity
BEFORE UPDATE ON user_role_grants
FOR EACH ROW
BEGIN
  IF OLD.user_id <> NEW.user_id OR OLD.role_code <> NEW.role_code
     OR OLD.granted_at <> NEW.granted_at
     OR NOT (OLD.granted_by_user_id <=> NEW.granted_by_user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User role grant identity is immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_role_permission_grant_identity//
CREATE TRIGGER protect_role_permission_grant_identity
BEFORE UPDATE ON role_permission_grants
FOR EACH ROW
BEGIN
  IF OLD.role_code <> NEW.role_code OR OLD.permission_code <> NEW.permission_code
     OR OLD.granted_at <> NEW.granted_at
     OR NOT (OLD.granted_by_user_id <=> NEW.granted_by_user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Role permission grant identity is immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_case_assignment_identity//
CREATE TRIGGER protect_case_assignment_identity
BEFORE UPDATE ON case_assignments
FOR EACH ROW
BEGIN
  IF OLD.case_id <> NEW.case_id OR OLD.user_id <> NEW.user_id
     OR OLD.assignment_type_code <> NEW.assignment_type_code
     OR OLD.assignment_scope <> NEW.assignment_scope
     OR OLD.assigned_by_user_id <> NEW.assigned_by_user_id
     OR OLD.assigned_at <> NEW.assigned_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case assignment identity is immutable';
  END IF;
  IF OLD.assignment_status <> 'active' AND OLD.assignment_status <> NEW.assignment_status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ended case assignments cannot be reactivated';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_unit_membership_identity//
CREATE TRIGGER protect_unit_membership_identity
BEFORE UPDATE ON user_unit_memberships
FOR EACH ROW
BEGIN
  IF OLD.user_id <> NEW.user_id
     OR OLD.organizational_unit_id <> NEW.organizational_unit_id
     OR OLD.membership_type <> NEW.membership_type
     OR OLD.granted_by_user_id <> NEW.granted_by_user_id
     OR OLD.granted_at <> NEW.granted_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unit membership identity is immutable';
  END IF;
  IF OLD.membership_status <> 'active'
     AND OLD.membership_status <> NEW.membership_status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Revoked unit membership cannot be reactivated';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_participant_role_identity//
CREATE TRIGGER protect_participant_role_identity
BEFORE UPDATE ON case_participant_roles
FOR EACH ROW
BEGIN
  IF OLD.case_id <> NEW.case_id OR OLD.user_id <> NEW.user_id
     OR OLD.participant_role_code <> NEW.participant_role_code
     OR OLD.added_by_user_id <> NEW.added_by_user_id
     OR OLD.joined_at <> NEW.joined_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case participant identity is immutable';
  END IF;
  IF OLD.participation_status <> 'active'
     AND OLD.participation_status <> NEW.participation_status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ended participation cannot be reactivated';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_deadline_identity//
CREATE TRIGGER protect_deadline_identity
BEFORE UPDATE ON case_deadlines
FOR EACH ROW
BEGIN
  IF OLD.case_id <> NEW.case_id
     OR NOT (OLD.stage_code <=> NEW.stage_code)
     OR OLD.title <> NEW.title
     OR OLD.due_at <> NEW.due_at
     OR OLD.created_by_user_id <> NEW.created_by_user_id
     OR OLD.created_at <> NEW.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deadline identity is immutable; cancel and create another deadline';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_document_rule_policy//
CREATE TRIGGER protect_document_rule_policy
BEFORE UPDATE ON document_type_rules
FOR EACH ROW
BEGIN
  IF OLD.rule_code <> NEW.rule_code
     OR OLD.document_type_code <> NEW.document_type_code
     OR NOT (OLD.case_type_code <=> NEW.case_type_code)
     OR NOT (OLD.stage_code <=> NEW.stage_code)
     OR OLD.embedded_signature_policy <> NEW.embedded_signature_policy
     OR OLD.platform_signature_policy <> NEW.platform_signature_policy
     OR OLD.minimum_platform_signatures <> NEW.minimum_platform_signatures
     OR OLD.signer_match_policy <> NEW.signer_match_policy
     OR OLD.requires_authorization <> NEW.requires_authorization
     OR NOT (OLD.authorization_role_code <=> NEW.authorization_role_code)
     OR OLD.requires_certification <> NEW.requires_certification
     OR NOT (OLD.certification_role_code <=> NEW.certification_role_code)
     OR OLD.analyzer_policy <> NEW.analyzer_policy
     OR OLD.priority <> NEW.priority
     OR OLD.effective_from <> NEW.effective_from THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document rules are immutable; supersede and create a new rule';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_storage_object_identity//
CREATE TRIGGER protect_storage_object_identity
BEFORE UPDATE ON storage_objects
FOR EACH ROW
BEGIN
  IF OLD.document_version_id <> NEW.document_version_id
     OR OLD.object_role <> NEW.object_role
     OR OLD.storage_provider <> NEW.storage_provider
     OR NOT (OLD.bucket_name <=> NEW.bucket_name)
     OR OLD.object_key <> NEW.object_key
     OR NOT (OLD.provider_version_id <=> NEW.provider_version_id)
     OR NOT (OLD.legacy_binary_object_id <=> NEW.legacy_binary_object_id)
     OR OLD.original_filename <> NEW.original_filename
     OR OLD.detected_mime_type <> NEW.detected_mime_type
     OR OLD.size_bytes <> NEW.size_bytes
     OR OLD.sha256 <> NEW.sha256
     OR OLD.encryption_algorithm <> NEW.encryption_algorithm
     OR OLD.created_by_user_id <> NEW.created_by_user_id
     OR OLD.created_at <> NEW.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stored object identity and digest are immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_analysis_job_identity//
CREATE TRIGGER protect_analysis_job_identity
BEFORE UPDATE ON document_analysis_jobs
FOR EACH ROW
BEGIN
  IF OLD.document_version_id <> NEW.document_version_id
     OR OLD.analysis_type <> NEW.analysis_type
     OR OLD.provider_code <> NEW.provider_code
     OR OLD.attempt_number <> NEW.attempt_number
     OR OLD.requested_by_user_id <> NEW.requested_by_user_id
     OR OLD.requested_at <> NEW.requested_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Analysis job identity is immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS protect_observation_content//
CREATE TRIGGER protect_observation_content
BEFORE UPDATE ON document_observations
FOR EACH ROW
BEGIN
  IF OLD.document_version_id <> NEW.document_version_id
     OR OLD.author_user_id <> NEW.author_user_id
     OR OLD.observation_type <> NEW.observation_type
     OR OLD.body <> NEW.body
     OR OLD.created_at <> NEW.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Observation content is immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS no_update_user_status_change//
CREATE TRIGGER no_update_user_status_change BEFORE UPDATE ON user_status_changes
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User status history is immutable'; END//
DROP TRIGGER IF EXISTS no_update_case_profile_history//
CREATE TRIGGER no_update_case_profile_history BEFORE UPDATE ON case_profile_status_history
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case profile history is immutable'; END//
DROP TRIGGER IF EXISTS no_update_stage_transition//
CREATE TRIGGER no_update_stage_transition BEFORE UPDATE ON case_stage_transitions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case stage transitions are immutable'; END//
DROP TRIGGER IF EXISTS no_update_version_policy//
CREATE TRIGGER no_update_version_policy BEFORE UPDATE ON document_version_policies
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document version policy snapshots are immutable'; END//
DROP TRIGGER IF EXISTS no_update_version_metadata//
CREATE TRIGGER no_update_version_metadata BEFORE UPDATE ON document_version_metadata
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document version origin is immutable'; END//
DROP TRIGGER IF EXISTS no_update_analysis_result//
CREATE TRIGGER no_update_analysis_result BEFORE UPDATE ON document_analysis_results
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Analysis results are immutable'; END//
DROP TRIGGER IF EXISTS no_update_document_action//
CREATE TRIGGER no_update_document_action BEFORE UPDATE ON document_actions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document actions are immutable'; END//
DROP TRIGGER IF EXISTS no_update_signature_record//
CREATE TRIGGER no_update_signature_record BEFORE UPDATE ON document_signature_records
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Signature records are immutable'; END//

DROP TRIGGER IF EXISTS no_delete_schema_migration//
CREATE TRIGGER no_delete_schema_migration BEFORE DELETE ON schema_migrations
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Migration history cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_user_role_grant//
CREATE TRIGGER no_delete_user_role_grant BEFORE DELETE ON user_role_grants
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: user role grants cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_role_permission_grant//
CREATE TRIGGER no_delete_role_permission_grant BEFORE DELETE ON role_permission_grants
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: permission grants cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_user_status_change//
CREATE TRIGGER no_delete_user_status_change BEFORE DELETE ON user_status_changes
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: user status history cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_legal_area//
CREATE TRIGGER no_delete_legal_area BEFORE DELETE ON legal_areas
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: legal areas cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_case_type//
CREATE TRIGGER no_delete_case_type BEFORE DELETE ON case_types
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case types cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_organizational_unit//
CREATE TRIGGER no_delete_organizational_unit BEFORE DELETE ON organizational_units
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: organizational units cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_unit_membership//
CREATE TRIGGER no_delete_unit_membership BEFORE DELETE ON user_unit_memberships
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: unit memberships cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_case_profile//
CREATE TRIGGER no_delete_case_profile BEFORE DELETE ON case_profiles
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case profiles cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_case_profile_history//
CREATE TRIGGER no_delete_case_profile_history BEFORE DELETE ON case_profile_status_history
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case profile history cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_assignment_type//
CREATE TRIGGER no_delete_assignment_type BEFORE DELETE ON case_assignment_types
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: assignment types cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_case_assignment//
CREATE TRIGGER no_delete_case_assignment BEFORE DELETE ON case_assignments
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case assignments cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_participant_role_type//
CREATE TRIGGER no_delete_participant_role_type BEFORE DELETE ON case_participant_role_types
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: participant role types cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_case_participant_role//
CREATE TRIGGER no_delete_case_participant_role BEFORE DELETE ON case_participant_roles
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case participant roles cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_stage_definition//
CREATE TRIGGER no_delete_stage_definition BEFORE DELETE ON case_stage_definitions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: stage definitions cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_stage_transition//
CREATE TRIGGER no_delete_stage_transition BEFORE DELETE ON case_stage_transitions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: stage transitions cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_case_deadline//
CREATE TRIGGER no_delete_case_deadline BEFORE DELETE ON case_deadlines
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case deadlines cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_document_rule//
CREATE TRIGGER no_delete_document_rule BEFORE DELETE ON document_type_rules
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: document rules cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_rule_signer_role//
CREATE TRIGGER no_delete_rule_signer_role BEFORE DELETE ON document_rule_signer_roles
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: document signer rules cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_version_policy//
CREATE TRIGGER no_delete_version_policy BEFORE DELETE ON document_version_policies
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: version policies cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_version_metadata//
CREATE TRIGGER no_delete_version_metadata BEFORE DELETE ON document_version_metadata
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: version origin cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_storage_object//
CREATE TRIGGER no_delete_storage_object BEFORE DELETE ON storage_objects
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: storage objects cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_analysis_job//
CREATE TRIGGER no_delete_analysis_job BEFORE DELETE ON document_analysis_jobs
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: analysis jobs cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_analysis_result//
CREATE TRIGGER no_delete_analysis_result BEFORE DELETE ON document_analysis_results
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: analysis results cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_observation//
CREATE TRIGGER no_delete_observation BEFORE DELETE ON document_observations
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: observations cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_document_action//
CREATE TRIGGER no_delete_document_action BEFORE DELETE ON document_actions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: document actions cannot be deleted'; END//
DROP TRIGGER IF EXISTS no_delete_signature_record//
CREATE TRIGGER no_delete_signature_record BEFORE DELETE ON document_signature_records
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: signature records cannot be deleted'; END//

DELIMITER ;

CREATE OR REPLACE VIEW v_active_user_roles AS
SELECT
  grant_record.user_id,
  grant_record.role_code,
  role_record.label AS role_label,
  role_record.channel,
  grant_record.granted_at
FROM user_role_grants grant_record
JOIN roles role_record ON role_record.code = grant_record.role_code
WHERE grant_record.grant_status = 'active';

CREATE OR REPLACE VIEW v_active_role_permissions AS
SELECT
  grant_record.role_code,
  grant_record.permission_code,
  permission_record.description,
  grant_record.granted_at
FROM role_permission_grants grant_record
JOIN permissions permission_record ON permission_record.code = grant_record.permission_code
WHERE grant_record.grant_status = 'active';

CREATE OR REPLACE VIEW v_case_workspace_access AS
SELECT
  assignment_record.user_id,
  assignment_record.case_id,
  assignment_record.assignment_type_code,
  assignment_record.assignment_scope,
  profile.case_type_code,
  case_type.legal_area_code,
  profile.organizational_unit_id,
  profile.lifecycle_status,
  profile.visibility_status,
  profile.confidentiality_level,
  assignment_record.assigned_at
FROM case_assignments assignment_record
JOIN case_profiles profile ON profile.case_id = assignment_record.case_id
JOIN case_types case_type ON case_type.code = profile.case_type_code
WHERE assignment_record.assignment_status = 'active';

CREATE OR REPLACE VIEW v_active_unit_memberships AS
SELECT
  membership.user_id,
  membership.organizational_unit_id,
  unit_record.code AS organizational_unit_code,
  unit_record.name AS organizational_unit_name,
  membership.membership_type,
  membership.granted_at
FROM user_unit_memberships membership
JOIN organizational_units unit_record
  ON unit_record.id = membership.organizational_unit_id
WHERE membership.membership_status = 'active'
  AND unit_record.is_active = TRUE;

CREATE OR REPLACE VIEW v_document_version_workflow_general AS
SELECT
  document_record.id AS document_id,
  version_record.id AS document_version_id,
  document_record.case_id,
  document_record.document_type_code,
  document_record.title,
  document_record.lifecycle_status,
  version_record.version_number,
  metadata_record.upload_source,
  policy_record.embedded_signature_policy,
  policy_record.platform_signature_policy,
  policy_record.requires_authorization,
  policy_record.requires_certification,
  policy_record.minimum_platform_signatures,
  CASE
    WHEN policy_record.embedded_signature_policy = 'none' THEN 'not_required'
    ELSE COALESCE((
      SELECT analysis_job.job_status
      FROM document_analysis_jobs analysis_job
      WHERE analysis_job.document_version_id = version_record.id
        AND analysis_job.analysis_type = 'signature_detection'
      ORDER BY analysis_job.requested_at DESC, analysis_job.id DESC
      LIMIT 1
    ), 'pending')
  END AS signature_analysis_status,
  CASE
    WHEN policy_record.requires_authorization = FALSE THEN 'not_required'
    ELSE COALESCE((
      SELECT action_record.outcome
      FROM document_actions action_record
      WHERE action_record.document_version_id = version_record.id
        AND action_record.action_code = 'authorize'
      ORDER BY action_record.created_at DESC, action_record.id DESC
      LIMIT 1
    ), 'pending')
  END AS authorization_status,
  CASE
    WHEN policy_record.requires_certification = FALSE THEN 'not_required'
    ELSE COALESCE((
      SELECT action_record.outcome
      FROM document_actions action_record
      WHERE action_record.document_version_id = version_record.id
        AND action_record.action_code = 'certify'
      ORDER BY action_record.created_at DESC, action_record.id DESC
      LIMIT 1
    ), 'pending')
  END AS certification_status,
  CASE
    WHEN policy_record.platform_signature_policy = 'none' THEN 'not_required'
    WHEN (
      SELECT COUNT(*)
      FROM document_signature_records signature_record
      WHERE signature_record.document_version_id = version_record.id
        AND signature_record.verification_status = 'valid'
    ) >= policy_record.minimum_platform_signatures THEN 'signed'
    ELSE 'pending'
  END AS platform_signature_status,
  COALESCE((
    SELECT storage_record.storage_provider
    FROM storage_objects storage_record
    WHERE storage_record.document_version_id = version_record.id
      AND storage_record.object_role = 'original'
    ORDER BY storage_record.created_at DESC, storage_record.id DESC
    LIMIT 1
  ), 'legacy_database') AS storage_provider,
  COALESCE((
    SELECT storage_record.storage_status
    FROM storage_objects storage_record
    WHERE storage_record.document_version_id = version_record.id
      AND storage_record.object_role = 'original'
    ORDER BY storage_record.created_at DESC, storage_record.id DESC
    LIMIT 1
  ), 'available') AS storage_status
FROM documents document_record
JOIN document_versions version_record
  ON version_record.document_id = document_record.id
JOIN document_version_policies policy_record
  ON policy_record.document_version_id = version_record.id
JOIN document_version_metadata metadata_record
  ON metadata_record.document_version_id = version_record.id;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '002_generalizacion_plataforma',
  'Generalización jurídica, espacios de trabajo, conservación, políticas documentales y preparación para MinIO.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
