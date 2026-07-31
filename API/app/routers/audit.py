from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import AuditLog, Role, User
from app.schemas import AuditOut


router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditOut])
def list_audit_events(
    resource_type: str | None = None,
    resource_id: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _reviewer: User = Depends(require_roles(Role.admin, Role.notary)),
):
    query = db.query(AuditLog)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if resource_id:
        query = query.filter(AuditLog.resource_id == resource_id)
    return query.order_by(AuditLog.created_at.desc()).limit(min(max(limit, 1), 500)).all()

