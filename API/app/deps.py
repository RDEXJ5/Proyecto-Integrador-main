import hmac

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Case, CaseParticipant, Document, Role, User
from app.security import decode_access_token


settings = get_settings()
bearer = HTTPBearer(auto_error=False)


def verify_application_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    if not settings.api_application_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "API_APPLICATION_KEY is not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key, settings.api_application_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid X-API-Key")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bearer token is required")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload.get("sub", ""))
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User is not active")
    return user


def require_roles(*roles: Role):
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return current_user

    return checker


def can_access_case(case: Case, user: User, db: Session) -> bool:
    if user.role in {Role.admin, Role.notary}:
        return True
    if user.role == Role.judge:
        return case.status.value == "active"
    if user.role == Role.lawyer:
        return case.lawyer_id == user.id
    return db.query(CaseParticipant).filter_by(case_id=case.id, user_id=user.id).first() is not None


def can_access_document(document: Document, user: User, db: Session) -> bool:
    if not can_access_case(document.case, user, db):
        return False
    if user.role in {Role.party, Role.witness}:
        return document.owner_id == user.id
    return True

