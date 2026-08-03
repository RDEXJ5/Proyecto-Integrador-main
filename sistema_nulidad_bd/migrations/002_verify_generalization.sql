-- Verificación no destructiva de la migración 002.
USE juzgado_nulidad_documental;

DELIMITER //
DROP PROCEDURE IF EXISTS verify_migration_002//
CREATE PROCEDURE verify_migration_002()
BEGIN
  DECLARE case_delete_blocked BOOLEAN DEFAULT FALSE;
  DECLARE storage_delete_blocked BOOLEAN DEFAULT FALSE;
  DECLARE policy_update_blocked BOOLEAN DEFAULT FALSE;
  DECLARE version_count BIGINT DEFAULT 0;
  DECLARE policy_count BIGINT DEFAULT 0;
  DECLARE origin_count BIGINT DEFAULT 0;
  DECLARE storage_count BIGINT DEFAULT 0;

  SELECT COUNT(*) INTO version_count FROM document_versions;
  SELECT COUNT(*) INTO policy_count FROM document_version_policies;
  SELECT COUNT(*) INTO origin_count FROM document_version_metadata;
  SELECT COUNT(*) INTO storage_count
  FROM storage_objects
  WHERE object_role = 'original';

  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000'
      SET case_delete_blocked = TRUE;
    DELETE FROM case_profiles ORDER BY case_id LIMIT 1;
  END;
  ROLLBACK;

  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000'
      SET storage_delete_blocked = TRUE;
    DELETE FROM storage_objects ORDER BY id LIMIT 1;
  END;
  ROLLBACK;

  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000'
      SET policy_update_blocked = TRUE;
    UPDATE document_version_policies
    SET snapshotted_at = snapshotted_at
    ORDER BY document_version_id
    LIMIT 1;
  END;
  ROLLBACK;

  IF version_count <> policy_count
     OR version_count <> origin_count
     OR version_count <> storage_count THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 002 incomplete: version metadata counts do not match';
  END IF;

  IF case_delete_blocked = FALSE
     OR storage_delete_blocked = FALSE
     OR policy_update_blocked = FALSE THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 002 incomplete: retention or immutability trigger missing';
  END IF;

  SELECT
    '002_generalizacion_plataforma' AS migration,
    'ok' AS verification_status,
    (SELECT COUNT(*) FROM legal_areas WHERE is_active = TRUE) AS active_legal_areas,
    (SELECT COUNT(*) FROM case_types WHERE is_active = TRUE) AS active_case_types,
    (SELECT COUNT(*) FROM roles WHERE code IN (
      'prosecutor', 'defender', 'expert', 'secretary', 'coordinator', 'auditor'
    )) AS new_roles,
    (SELECT COUNT(*) FROM case_profiles) AS case_profiles,
    version_count AS document_versions,
    policy_count AS policy_snapshots,
    origin_count AS origin_records,
    storage_count AS original_storage_objects,
    case_delete_blocked AS case_delete_blocked,
    storage_delete_blocked AS storage_delete_blocked,
    policy_update_blocked AS policy_update_blocked;
END//
DELIMITER ;

CALL verify_migration_002();
DROP PROCEDURE verify_migration_002;
