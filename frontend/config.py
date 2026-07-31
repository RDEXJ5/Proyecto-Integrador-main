import os


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "")
    API_BASE_URL = os.getenv("API_BASE_URL", "http://api:8000").rstrip("/")
    API_APPLICATION_KEY = os.getenv("API_APPLICATION_KEY", "")
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024

