-- Migración 013: autorregistro móvil e invitaciones a expedientes.
-- Es aditiva e idempotente. Las invitaciones y sus respuestas se conservan.

USE juzgado_nulidad_documental;

CREATE TABLE IF NOT EXISTS case_participant_invitations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  invited_user_id BIGINT UNSIGNED NOT NULL,
  participant_role_code VARCHAR(40) NOT NULL,
  invitation_status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired')
    NOT NULL DEFAULT 'pending',
  invited_by_user_id BIGINT UNSIGNED NOT NULL,
  invitation_reason VARCHAR(1000) NOT NULL,
  invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  responded_at TIMESTAMP NULL,
  response_ip_address VARCHAR(45) NULL,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN invitation_status = 'pending' THEN 1 ELSE NULL END
  ) STORED,
  CONSTRAINT fk_case_invitation_case
    FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_invitation_user
    FOREIGN KEY (invited_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_invitation_role
    FOREIGN KEY (participant_role_code) REFERENCES case_participant_role_types(code),
  CONSTRAINT fk_case_invitation_sender
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_pending_case_invitation
    UNIQUE (case_id, invited_user_id, participant_role_code, active_slot),
  CONSTRAINT chk_case_invitation_response CHECK (
    (invitation_status = 'pending' AND responded_at IS NULL)
    OR (invitation_status <> 'pending' AND responded_at IS NOT NULL)
  ),
  INDEX idx_case_invitation_user (invited_user_id, invitation_status, expires_at),
  INDEX idx_case_invitation_case (case_id, invitation_status, invited_at)
) ENGINE=InnoDB;

DELIMITER //

DROP TRIGGER IF EXISTS protect_case_invitation_identity//
CREATE TRIGGER protect_case_invitation_identity
BEFORE UPDATE ON case_participant_invitations
FOR EACH ROW
BEGIN
  IF OLD.case_id <> NEW.case_id
     OR OLD.invited_user_id <> NEW.invited_user_id
     OR OLD.participant_role_code <> NEW.participant_role_code
     OR OLD.invited_by_user_id <> NEW.invited_by_user_id
     OR OLD.invitation_reason <> NEW.invitation_reason
     OR OLD.invited_at <> NEW.invited_at
     OR OLD.expires_at <> NEW.expires_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case invitation identity is immutable';
  END IF;

  IF OLD.invitation_status <> 'pending'
     AND (
       OLD.invitation_status <> NEW.invitation_status
       OR NOT (OLD.responded_at <=> NEW.responded_at)
       OR NOT (OLD.response_ip_address <=> NEW.response_ip_address)
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Answered case invitations are immutable';
  END IF;

  IF OLD.invitation_status = 'pending'
     AND NEW.invitation_status NOT IN ('pending', 'accepted', 'declined', 'cancelled', 'expired') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid case invitation transition';
  END IF;
END//

DROP TRIGGER IF EXISTS no_delete_case_participant_invitation//
CREATE TRIGGER no_delete_case_participant_invitation
BEFORE DELETE ON case_participant_invitations
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case invitations cannot be deleted';
END//

DELIMITER ;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '013_mobile_registration_invitations',
  'Autorregistro de partes y testigos e invitaciones que requieren aceptación móvil.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
