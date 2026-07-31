from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.audit import record_audit
from app.database import get_db
from app.deps import can_access_case, get_current_user, require_roles
from app.models import Case, CaseParticipant, CaseStatus, Document, DocumentVersion, Role, User
from app.rate_limit import limiter
from app.schemas import CaseCreate, CaseOut, CaseStatusUpdate, ParticipantCreate


router = APIRouter(prefix="/cases", tags=["matrimonial cases"])


def get_case(case_id: int, db: Session) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    return case


@router.post("", response_model=CaseOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
def create_case(
    request: Request,
    payload: CaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(Role.admin, Role.notary, Role.lawyer)),
):
    if db.query(Case).filter(Case.folio == payload.folio).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Folio is already registered")
    lawyer = db.get(User, payload.lawyer_id)
    judge = db.get(User, payload.judge_id) if payload.judge_id else None
    if lawyer is None or lawyer.role != Role.lawyer:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "lawyer_id must belong to an active lawyer")
    if judge is not None and judge.role != Role.judge:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "judge_id must belong to a judge")
    if current_user.role == Role.lawyer and current_user.id != lawyer.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Lawyers can only create their own cases")
    case = Case(**payload.model_dump(), created_by_id=current_user.id)
    db.add(case)
    db.flush()
    record_audit(db, request, current_user, "create_case", "case", case.id, {"folio": case.folio})
    db.commit()
    db.refresh(case)
    return case


@router.get("", response_model=list[CaseOut])
def list_cases(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Case)
    if current_user.role == Role.judge:
        query = query.filter(Case.status == CaseStatus.active)
    elif current_user.role == Role.lawyer:
        query = query.filter(Case.lawyer_id == current_user.id)
    elif current_user.role in {Role.party, Role.witness}:
        query = query.join(CaseParticipant).filter(CaseParticipant.user_id == current_user.id)
    elif current_user.role not in {Role.admin, Role.notary}:
        return []
    return query.order_by(Case.updated_at.desc()).all()


@router.get("/{case_id}", response_model=CaseOut)
def read_case(case_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    case = get_case(case_id, db)
    if not can_access_case(case, current_user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this case")
    return case


@router.post("/{case_id}/participants", status_code=status.HTTP_201_CREATED)
def add_participant(
    case_id: int,
    payload: ParticipantCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(Role.admin, Role.notary, Role.lawyer)),
):
    case = get_case(case_id, db)
    if current_user.role == Role.lawyer and case.lawyer_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Lawyers can only manage their own cases")
    user = db.get(User, payload.user_id)
    expected_role = Role.witness if payload.kind.value == "witness" else Role.party
    if user is None or user.role != expected_role:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Participant role does not match participant type")
    if db.query(CaseParticipant).filter_by(case_id=case.id, user_id=user.id).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "User is already a participant")
    participant = CaseParticipant(case_id=case.id, user_id=user.id, kind=payload.kind)
    db.add(participant)
    record_audit(db, request, current_user, "add_participant", "case", case.id, {"user_id": user.id, "kind": payload.kind.value})
    db.commit()
    return {"status": "participant_added", "case_id": case.id, "user_id": user.id}


@router.patch("/{case_id}/status", response_model=CaseOut)
def update_case_status(
    case_id: int,
    payload: CaseStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(Role.admin, Role.notary)),
):
    case = get_case(case_id, db)
    case.status = payload.status
    case.archived_at = datetime.utcnow() if payload.status != CaseStatus.active else None
    if payload.status != CaseStatus.active:
        documents = db.query(Document).filter(Document.case_id == case.id).all()
        for document in documents:
            document.is_archived = True
            for version in document.versions:
                version.storage_tier = "deep_archive"
                version.archived_at = datetime.utcnow()
    else:
        for document in db.query(Document).filter(Document.case_id == case.id).all():
            document.is_archived = False
            for version in document.versions:
                version.storage_tier = "active"
                version.archived_at = None
    record_audit(
        db,
        request,
        current_user,
        "change_case_status",
        "case",
        case.id,
        {"status": payload.status.value, "note": payload.note},
    )
    db.commit()
    db.refresh(case)
    return case
