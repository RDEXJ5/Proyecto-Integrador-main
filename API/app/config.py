from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    db_host: str = "mysql"
    db_port: int = 3306
    db_name: str = "control_documental"
    db_user: str = "appuser"
    db_password: str = ""

    api_application_key: str = ""
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    file_encryption_key: str = ""
    bootstrap_token: str = ""
    storage_path: str = "storage"
    max_upload_mb: int = 25
    rate_limit_default: str = "120/minute"
    rate_limit_login: str = "8/minute"

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"
        )

    @property
    def storage_root(self) -> Path:
        return Path(self.storage_path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()

