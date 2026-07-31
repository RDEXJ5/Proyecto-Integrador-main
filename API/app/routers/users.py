from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.audit import record_audit
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Role, User
from app.rate_limit import limiter
from app.schemas import UserCreate, UserOut
from app.security import hash_password


router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
def create_user(
    request: Request,
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(Role.admin)),
):
    email = str(payload.email).lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered")
    user = User(
        full_name=payload.full_name,
        email=email,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    record_audit(db, request, admin, "create_user", "user", email, {"role": payload.role.value})
    db.commit()
    db.refresh(user)
    return user


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_roles(Role.admin, Role.notary)),
):
    return db.query(User).order_by(User.full_name).all()


@router.patch("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(Role.admin)),
):
    if admin.id == user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An administrator cannot deactivate their own account")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.is_active = False
    record_audit(db, request, admin, "deactivate_user", "user", user.id)
    db.commit()
    db.refresh(user)
    return user

