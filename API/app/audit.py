import json

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def record_audit(
    db: Session,
    request: Request | None,
    actor: User | None,
    action: str,
    resource_type: str,
    resource_id: str | int,
    details: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id),
            details=json.dumps(details, ensure_ascii=False, sort_keys=True) if details else None,
            ip_address=request.client.host if request and request.client else None,
        )
    )

