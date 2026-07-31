from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import AuthorizationDecision, CaseStatus, DocumentKind, ParticipantKind, Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    full_name: str = Field(min_length=3, max_length=160)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: Role


class UserOut(ORMModel):
    id: int
    full_name: str
    email: EmailStr
    role: Role
    is_active: bool
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class BootstrapAdminRequest(UserCreate):
    role: Role = Role.admin


class CaseCreate(BaseModel):
    folio: str = Field(min_length=4, max_length=40, pattern=r"^[A-Za-z0-9-]+$")
    title: str = Field(min_length=5, max_length=255)
    description: str | None = None
    lawyer_id: int
    judge_id: int | None = None

    @field_validator("folio")
    @classmethod
    def normalized_folio(cls, value: str) -> str:
        return value.upper()


class CaseStatusUpdate(BaseModel):
    status: CaseStatus
    note: str | None = Field(default=None, max_length=1000)


class ParticipantCreate(BaseModel):
    user_id: int
    kind: ParticipantKind


class CaseOut(ORMModel):
    id: int
    folio: str
    title: str
    description: str | None
    status: CaseStatus
    lawyer_id: int
    judge_id: int | None
    created_by_id: int
    created_at: datetime
    archived_at: datetime | None


class DocumentCreate(BaseModel):
    case_id: int
    owner_id: int
    kind: DocumentKind
    title: str = Field(min_length=3, max_length=255)
    description: str | None = None
    contains_sensitive_data: bool = True


class DocumentOut(ORMModel):
    id: int
    case_id: int
    owner_id: int
    kind: DocumentKind
    title: str
    description: str | None
    contains_sensitive_data: bool
    is_archived: bool
    created_at: datetime


class VersionOut(ORMModel):
    id: int
    document_id: int
    version_number: int
    original_name: str
    content_type: str | None
    size_bytes: int
    sha256: str
    compression: str
    storage_tier: str
    uploaded_by_id: int
    created_at: datetime
    archived_at: datetime | None


class AuthorizationCreate(BaseModel):
    decision: AuthorizationDecision
    note: str | None = Field(default=None, max_length=2000)


class AuthorizationOut(ORMModel):
    id: int
    version_id: int
    notary_id: int
    decision: AuthorizationDecision
    note: str | None
    created_at: datetime


class SignatureOut(ORMModel):
    id: int
    version_id: int
    signer_id: int
    algorithm: str
    public_key: str
    signature: str
    signed_digest: str
    created_at: datetime


class AuditOut(ORMModel):
    id: int
    actor_id: int | None
    action: str
    resource_type: str
    resource_id: str
    details: str | None
    ip_address: str | None
    created_at: datetime

