"""Small, idempotent schema migration runner for the Docker MySQL volume.

The MySQL init scripts run only when a volume is empty. This runner upgrades an
already-created local volume before the API accepts requests, without deleting
legal records.
"""

from sqlalchemy import text

from app.database import engine


DOCUMENT_POLICY_MIGRATION = "20260730_document_type_policies"
DOCUMENT_TYPES = (
    ("marriage_certificate", "Acta matrimonial", "Documento rector del expediente de nulidad.", True, False, True),
    ("personal_identification", "Identificación oficial", "INE o documento oficial de la parte interesada.", True, False, True),
    ("curp", "CURP", "Clave Única de Registro de Población.", True, False, True),
    ("birth_certificate", "Acta de nacimiento", "Acta de nacimiento de una parte interesada.", True, False, True),
    ("rfc", "RFC", "Constancia de Registro Federal de Contribuyentes.", True, False, True),
    ("proof_of_address", "Comprobante de domicilio", "Documento de domicilio de una parte interesada.", True, False, True),
    ("witness_identification", "Identificación de testigo", "Identificación oficial del testigo.", True, False, True),
    ("libel", "Libelo", "Relato de hechos presentado por una parte o testigo.", False, False, True),
    ("judgment", "Resolución judicial", "Resolución que requiere autorización notarial y firma judicial.", True, True, True),
    ("other", "Anexo u otro documento", "Documento complementario sin firma judicial obligatoria.", False, False, True),
)


def _column_exists(connection, table: str, column: str) -> bool:
    return bool(
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = DATABASE() AND table_name = :table_name AND column_name = :column_name
                """
            ),
            {"table_name": table, "column_name": column},
        ).scalar()
    )


def _named_constraint_exists(connection, table: str, name: str) -> bool:
    return bool(
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM information_schema.table_constraints
                WHERE table_schema = DATABASE() AND table_name = :table_name AND constraint_name = :constraint_name
                """
            ),
            {"table_name": table, "constraint_name": name},
        ).scalar()
    )


def _index_exists(connection, table: str, name: str) -> bool:
    return bool(
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM information_schema.statistics
                WHERE table_schema = DATABASE() AND table_name = :table_name AND index_name = :index_name
                """
            ),
            {"table_name": table, "index_name": name},
        ).scalar()
    )


def apply_document_type_policy_migration() -> None:
    """Add document workflow policies while preserving all existing evidence."""
    with engine.connect() as connection:
        locked = connection.execute(text("SELECT GET_LOCK('control_documental_document_types_v1', 30)")).scalar()
        if locked != 1:
            raise RuntimeError("Could not acquire document policy migration lock")
        try:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        version VARCHAR(100) PRIMARY KEY,
                        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB
                    """
                )
            )
            applied = connection.execute(
                text("SELECT COUNT(*) FROM schema_migrations WHERE version = :version"),
                {"version": DOCUMENT_POLICY_MIGRATION},
            ).scalar()
            if applied:
                return

            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS document_types (
                        code VARCHAR(64) PRIMARY KEY,
                        label VARCHAR(120) NOT NULL,
                        description VARCHAR(500) NULL,
                        requires_notarial_authorization BOOLEAN NOT NULL DEFAULT FALSE,
                        requires_judicial_signature BOOLEAN NOT NULL DEFAULT FALSE,
                        default_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
                        is_active BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        CONSTRAINT chk_signature_requires_authorization
                            CHECK (NOT requires_judicial_signature OR requires_notarial_authorization)
                    ) ENGINE=InnoDB
                    """
                )
            )
            for code, label, description, requires_authorization, requires_signature, default_sensitive in DOCUMENT_TYPES:
                connection.execute(
                    text(
                        """
                        INSERT INTO document_types (
                            code, label, description, requires_notarial_authorization,
                            requires_judicial_signature, default_sensitive
                        ) VALUES (:code, :label, :description, :requires_authorization, :requires_signature, :default_sensitive)
                        ON DUPLICATE KEY UPDATE
                            label = VALUES(label),
                            description = VALUES(description),
                            requires_notarial_authorization = VALUES(requires_notarial_authorization),
                            requires_judicial_signature = VALUES(requires_judicial_signature),
                            default_sensitive = VALUES(default_sensitive),
                            is_active = TRUE
                        """
                    ),
                    {
                        "code": code,
                        "label": label,
                        "description": description,
                        "requires_authorization": requires_authorization,
                        "requires_signature": requires_signature,
                        "default_sensitive": default_sensitive,
                    },
                )

            kind_type = connection.execute(
                text(
                    """
                    SELECT data_type FROM information_schema.columns
                    WHERE table_schema = DATABASE() AND table_name = 'documents' AND column_name = 'kind'
                    """
                )
            ).scalar()
            if kind_type == "enum":
                connection.execute(text("ALTER TABLE documents MODIFY COLUMN kind VARCHAR(64) NOT NULL"))
            if not _column_exists(connection, "documents", "requires_notarial_authorization"):
                connection.execute(
                    text(
                        "ALTER TABLE documents ADD COLUMN requires_notarial_authorization BOOLEAN NOT NULL DEFAULT FALSE AFTER kind"
                    )
                )
            if not _column_exists(connection, "documents", "requires_judicial_signature"):
                connection.execute(
                    text(
                        "ALTER TABLE documents ADD COLUMN requires_judicial_signature BOOLEAN NOT NULL DEFAULT FALSE AFTER requires_notarial_authorization"
                    )
                )
            if not _named_constraint_exists(connection, "documents", "fk_document_type"):
                connection.execute(
                    text(
                        "ALTER TABLE documents ADD CONSTRAINT fk_document_type FOREIGN KEY (kind) REFERENCES document_types(code)"
                    )
                )

            connection.execute(
                text(
                    """
                    UPDATE documents AS document_record
                    INNER JOIN document_types AS type_policy ON type_policy.code = document_record.kind
                    SET document_record.requires_notarial_authorization = type_policy.requires_notarial_authorization,
                        document_record.requires_judicial_signature = type_policy.requires_judicial_signature
                    """
                )
            )

            duplicates = connection.execute(
                text(
                    """
                    SELECT COUNT(*) FROM (
                        SELECT version_id FROM document_signatures GROUP BY version_id HAVING COUNT(*) > 1
                    ) AS duplicate_versions
                    """
                )
            ).scalar()
            if not duplicates and not _index_exists(connection, "document_signatures", "uq_signature_version"):
                connection.execute(text("ALTER TABLE document_signatures ADD UNIQUE KEY uq_signature_version (version_id)"))

            connection.execute(
                text("INSERT INTO schema_migrations (version) VALUES (:version)"),
                {"version": DOCUMENT_POLICY_MIGRATION},
            )
            connection.commit()
        finally:
            connection.execute(text("SELECT RELEASE_LOCK('control_documental_document_types_v1')"))
