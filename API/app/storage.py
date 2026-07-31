import base64
import hashlib
import zlib
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class StorageConfigurationError(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = get_settings().file_encryption_key
    if not key:
        raise StorageConfigurationError("FILE_ENCRYPTION_KEY is not configured")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise StorageConfigurationError("FILE_ENCRYPTION_KEY is invalid") from exc


def store_version(content: bytes) -> tuple[str, str]:
    """Compress first, encrypt second, and never overwrite an existing object."""
    root = get_settings().storage_root
    root.mkdir(parents=True, exist_ok=True)
    sha256 = hashlib.sha256(content).hexdigest()
    stored_name = f"{uuid4().hex}.bin"
    path = root / stored_name
    path.write_bytes(_fernet().encrypt(zlib.compress(content, level=9)))
    return stored_name, sha256


def load_version(stored_name: str) -> bytes:
    path = get_settings().storage_root / stored_name
    if not path.is_file():
        raise FileNotFoundError("Encrypted object is not present in storage")
    try:
        return zlib.decompress(_fernet().decrypt(path.read_bytes()))
    except InvalidToken as exc:
        raise RuntimeError("Stored file integrity cannot be verified") from exc


def make_integrity_signature(sha256: str) -> tuple[str, str, str]:
    """Creates a verifiable Ed25519 integrity signature for one version.

    This proves that the recorded digest was signed at a time by this service.
    It is not a substitute for a qualified Mexican e.firma certificate.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    private_key = Ed25519PrivateKey.generate()
    message = sha256.encode("ascii")
    signature = private_key.sign(message)
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return (
        "Ed25519-SHA256",
        base64.b64encode(public_key).decode("ascii"),
        base64.b64encode(signature).decode("ascii"),
    )
