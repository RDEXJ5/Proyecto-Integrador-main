import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Role(str, enum.Enum):
    notary = "notary"
    judge = "judge"
    lawyer = "lawyer"
    party = "party"
    witness = "witness"
    admin = "admin"


class CaseStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    closed = "closed"
    annulled = "annulled"


class ParticipantKind(str, enum.Enum):
    petitioner = "petitioner"
    respondent = "respondent"
    witness = "witness"


class DocumentKind(str, enum.Enum):
    marriage_certificate = "marriage_certificate"
    personal_identification = "personal_identification"
    curp = "curp"
    birth_certificate = "birth_certificate"
    rfc = "rfc"
    proof_of_address = "proof_of_address"
    witness_identification = "witness_identification"
    libel = "libel"
    judgment = "judgment"
    other = "other"


class DocumentType(Base):
    __tablename__ = "document_types"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    requires_notarial_authorization: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_judicial_signature: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    documents: Mapped[list["Document"]] = relationship(back_populates="document_type")


class AuthorizationDecision(str, enum.Enum):
    authorized = "authorized"
    rejected = "rejected"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    folio: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[CaseStatus] = mapped_column(Enum(CaseStatus), nullable=False, default=CaseStatus.active)
    lawyer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    judge_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)

    participants: Mapped[list["CaseParticipant"]] = relationship(back_populates="case", cascade="all, delete-orphan")
    documents: Mapped[list["Document"]] = relationship(back_populates="case")


class CaseParticipant(Base):
    __tablename__ = "case_participants"
    __table_args__ = (UniqueConstraint("case_id", "user_id", name="uq_case_participant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    kind: Mapped[ParticipantKind] = mapped_column(Enum(ParticipantKind), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    case: Mapped[Case] = relationship(back_populates="participants")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), nullable=False, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(ForeignKey("document_types.code"), nullable=False, index=True)
    requires_notarial_authorization: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_judicial_signature: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    contains_sensitive_data: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    case: Mapped[Case] = relationship(back_populates="documents")
    document_type: Mapped[DocumentType] = relationship(back_populates="documents")
    versions: Mapped[list["DocumentVersion"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version_number", name="uq_document_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    compression: Mapped[str] = mapped_column(String(32), nullable=False, default="zlib")
    storage_tier: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)

    document: Mapped[Document] = relationship(back_populates="versions")
    authorizations: Mapped[list["DocumentAuthorization"]] = relationship(back_populates="version")
    signatures: Mapped[list["DocumentSignature"]] = relationship(back_populates="version")


class DocumentAuthorization(Base):
    __tablename__ = "document_authorizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"), nullable=False)
    notary_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    decision: Mapped[AuthorizationDecision] = mapped_column(Enum(AuthorizationDecision), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    version: Mapped[DocumentVersion] = relationship(back_populates="authorizations")


class DocumentSignature(Base):
    __tablename__ = "document_signatures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"), nullable=False)
    signer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(60), nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    signature: Mapped[str] = mapped_column(Text, nullable=False)
    signed_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    version: Mapped[DocumentVersion] = relationship(back_populates="signatures")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
