import base64
from datetime import datetime

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import record_audit
from app.config import get_settings
from app.database import get_db
from app.deps import can_access_case, can_access_document, get_current_user, require_roles
from app.models import (
    AuthorizationDecision,
    CaseStatus,
    CaseParticipant,
    Document,
    DocumentAuthorization,
    DocumentSignature,
    DocumentVersion,
    Role,
    User,
)
from app.rate_limit import limiter
from app.schemas import (
    AuthorizationCreate,
    AuthorizationOut,
    DocumentCreate,
    DocumentOut,
    SignatureOut,
    VersionOut,
)
from app.storage import StorageConfigurationError, load_version, make_integrity_signature, store_version


router = APIRouter(prefix="/documents", tags=["immutable documents"])
settings = get_settings()


def get_document(document_id: int, db: Session) -> Document:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return document


def get_version(version_id: int, db: Session) -> DocumentVersion:
    version = db.get(DocumentVersion, version_id)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document version not found")
    return version


def ensure_writable(document: Document, current_user: User) -> None:
    if document.case.status != CaseStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Inactive cases preserve records but cannot receive new versions")
    if current_user.role in {Role.admin, Role.notary}:
        return
    if current_user.role == Role.lawyer and document.case.lawyer_id == current_user.id:
        return
    if current_user.id == document.owner_id and current_user.role in {Role.party, Role.witness}:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to modify this document")


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_document(
    request: Request,
    payload: DocumentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.routers.cases import get_case

    case = get_case(payload.case_id, db)
    if case.status != CaseStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Documents cannot be added to an inactive case")
    if current_user.role == Role.lawyer and case.lawyer_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Lawyers can only create documents in their own cases")
    if current_user.role in {Role.party, Role.witness}:
        if current_user.id != payload.owner_id or not can_access_case(case, current_user, db):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Participants can only create their own documents in their own cases")
    if current_user.role not in {Role.admin, Role.notary, Role.lawyer, Role.party, Role.witness}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This role cannot create documents")
    owner = db.get(User, payload.owner_id)
    if owner is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "owner_id does not exist")
    if owner.role in {Role.party, Role.witness} and not db.query(CaseParticipant).filter_by(case_id=case.id, user_id=owner.id).first():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Personal document owners must be registered case participants")
    document = Document(**payload.model_dump())
    db.add(document)
    db.flush()
    record_audit(db, request, current_user, "create_document", "document", document.id, {"kind": document.kind.value})
    db.commit()
    db.refresh(document)
    return document


@router.get("", response_model=list[DocumentOut])
def list_documents(
    case_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Document)
    if case_id is not None:
        query = query.filter(Document.case_id == case_id)
    return [document for document in query.order_by(Document.updated_at.desc()).all() if can_access_document(document, current_user, db)]


@router.get("/{document_id}", response_model=DocumentOut)
def read_document(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document(document_id, db)
    if not can_access_document(document, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this document")
    return document


@router.get("/{document_id}/versions", response_model=list[VersionOut])
def list_versions(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document(document_id, db)
    if not can_access_document(document, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this document")
    return db.query(DocumentVersion).filter_by(document_id=document.id).order_by(DocumentVersion.version_number.desc()).all()


@router.post("/{document_id}/versions", response_model=VersionOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def add_version(
    document_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document(document_id, db)
    ensure_writable(document, current_user)
    allowed_content_types = {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    }
    if file.content_type and file.content_type not in allowed_content_types:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "This document type is not allowed")
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "An empty file cannot be registered")
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file exceeds the configured size limit")
    try:
        stored_name, digest = store_version(content)
    except StorageConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    latest = db.query(func.max(DocumentVersion.version_number)).filter_by(document_id=document.id).scalar() or 0
    version = DocumentVersion(
        document_id=document.id,
        version_number=latest + 1,
        original_name=(file.filename or "unnamed-document").replace("\\", "/").rsplit("/", 1)[-1].replace('"', ""),
        stored_name=stored_name,
        content_type=file.content_type,
        size_bytes=len(content),
        sha256=digest,
        compression="zlib+fernet",
        uploaded_by_id=current_user.id,
    )
    db.add(version)
    record_audit(
        db,
        request,
        current_user,
        "create_document_version",
        "document_version",
        f"{document.id}:{latest + 1}",
        {"sha256": digest, "size_bytes": len(content)},
    )
    db.commit()
    db.refresh(version)
    return version


@router.get("/versions/{version_id}/content")
def read_version_content(
    version_id: int,
    request: Request,
    client_channel: str | None = Header(default=None, alias="X-Client-Channel"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(Role.notary, Role.judge)),
):
    """Downloads are intentionally impossible for mobile clients and all non-judicial roles."""
    if client_channel != "web":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Document downloads are only available in the web application")
    version = get_version(version_id, db)
    if not can_access_document(version.document, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to access this version")
    try:
        content = load_version(version.stored_name)
    except (FileNotFoundError, RuntimeError, StorageConfigurationError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    record_audit(db, request, current_user, "read_document_content", "document_version", version.id)
    db.commit()
    headers = {"Content-Disposition": f'inline; filename="{version.original_name}"'}
    return Response(content=content, media_type=version.content_type or "application/octet-stream", headers=headers)


@router.post("/versions/{version_id}/authorizations", response_model=AuthorizationOut, status_code=status.HTTP_201_CREATED)
def authorize_version(
    version_id: int,
    payload: AuthorizationCreate,
    request: Request,
    db: Session = Depends(get_db),
    notary: User = Depends(require_roles(Role.notary)),
):
    version = get_version(version_id, db)
    authorization = DocumentAuthorization(
        version_id=version.id,
        notary_id=notary.id,
        decision=payload.decision,
        note=payload.note,
    )
    db.add(authorization)
    record_audit(
        db,
        request,
        notary,
        "authorize_document_version",
        "document_version",
        version.id,
        {"decision": payload.decision.value},
    )
    db.commit()
    db.refresh(authorization)
    return authorization


@router.get("/versions/{version_id}/authorizations", response_model=list[AuthorizationOut])
def list_authorizations(
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    version = get_version(version_id, db)
    if not can_access_document(version.document, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this version")
    return db.query(DocumentAuthorization).filter_by(version_id=version.id).order_by(DocumentAuthorization.created_at.desc()).all()


@router.post("/versions/{version_id}/signatures", response_model=SignatureOut, status_code=status.HTTP_201_CREATED)
def sign_version(
    version_id: int,
    request: Request,
    db: Session = Depends(get_db),
    judge: User = Depends(require_roles(Role.judge)),
):
    version = get_version(version_id, db)
    if not any(a.decision == AuthorizationDecision.authorized for a in version.authorizations):
        raise HTTPException(status.HTTP_409_CONFLICT, "A notarial authorization is required before a judicial signature")
    if version.document.case.status != CaseStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only active cases can receive a new signature")
    algorithm, public_key, signature = make_integrity_signature(version.sha256)
    signed = DocumentSignature(
        version_id=version.id,
        signer_id=judge.id,
        algorithm=algorithm,
        public_key=public_key,
        signature=signature,
        signed_digest=version.sha256,
    )
    db.add(signed)
    record_audit(db, request, judge, "sign_document_version", "document_version", version.id, {"algorithm": algorithm})
    db.commit()
    db.refresh(signed)
    return signed


@router.get("/versions/{version_id}/signatures", response_model=list[SignatureOut])
def list_signatures(
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    version = get_version(version_id, db)
    if not can_access_document(version.document, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this version")
    return db.query(DocumentSignature).filter_by(version_id=version.id).order_by(DocumentSignature.created_at.desc()).all()


@router.get("/signatures/{signature_id}/verify")
def verify_signature(signature_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    signature = db.get(DocumentSignature, signature_id)
    if signature is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signature not found")
    if not can_access_document(signature.version.document, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to verify this signature")
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(signature.public_key)).verify(
            base64.b64decode(signature.signature), signature.signed_digest.encode("ascii")
        )
        valid = True
    except Exception:
        valid = False
    return {"signature_id": signature.id, "valid": valid, "algorithm": signature.algorithm}
