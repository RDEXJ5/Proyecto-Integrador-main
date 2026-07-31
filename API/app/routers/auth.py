import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.audit import record_audit
from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Role, User
from app.rate_limit import limiter
from app.schemas import BootstrapAdminRequest, LoginRequest, TokenOut, UserOut
from app.security import create_access_token, hash_password, verify_password


router = APIRouter(prefix="/auth", tags=["authentication"])
settings = get_settings()


@router.post("/bootstrap-admin", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/hour")
def bootstrap_admin(
    request: Request,
    payload: BootstrapAdminRequest,
    bootstrap_token: str | None = Header(default=None, alias="X-Bootstrap-Token"),
    db: Session = Depends(get_db),
):
    if not settings.bootstrap_token or not hmac.compare_digest(bootstrap_token or "", settings.bootstrap_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid bootstrap token")
    if db.query(User).count() != 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bootstrap is permanently disabled after the first user")
    admin = User(
        full_name=payload.full_name,
        email=str(payload.email).lower(),
        password_hash=hash_password(payload.password),
        role=Role.admin,
    )
    db.add(admin)
    record_audit(db, request, admin, "bootstrap_admin", "user", "first-admin")
    db.commit()
    db.refresh(admin)
    return admin


@router.post("/login", response_model=TokenOut)
@limiter.limit(settings.rate_limit_login)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == str(payload.email).lower()).first()
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token, expires_in = create_access_token(user.id, user.role.value)
    record_audit(db, request, user, "login", "user", user.id)
    db.commit()
    return TokenOut(access_token=token, expires_in=expires_in, user=user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user

