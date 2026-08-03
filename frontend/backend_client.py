import requests
from flask import current_app, session


class BackendError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


def _headers(auth: bool = True, web_channel: bool = False) -> dict:
    headers = {"X-API-Key": current_app.config["API_APPLICATION_KEY"], "X-Client-Channel": "web"}
    if auth and session.get("access_token"):
        headers["Authorization"] = f"Bearer {session['access_token']}"
    if web_channel:
        headers["X-Client-Channel"] = "web"
    return headers


def _error_message(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return f"Error del servicio ({response.status_code})"
    detail = payload.get("detail") if isinstance(payload, dict) else None
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        return "; ".join(item.get("msg", "Dato inválido") for item in detail if isinstance(item, dict))
    return f"Error del servicio ({response.status_code})"


def request(method: str, path: str, *, auth: bool = True, web_channel: bool = False, **kwargs):
    headers = kwargs.pop("headers", {})
    headers.update(_headers(auth=auth, web_channel=web_channel))
    try:
        response = requests.request(
            method,
            f"{current_app.config['API_BASE_URL']}{path}",
            headers=headers,
            timeout=20,
            **kwargs,
        )
    except requests.RequestException as exc:
        raise BackendError("No se pudo establecer comunicación con la API", 503) from exc
    if not response.ok:
        raise BackendError(_error_message(response), response.status_code)
    if response.status_code == 204:
        return None
    return response.json()


def login(email: str, password: str):
    return request("POST", "/auth/login", auth=False, json={"email": email, "password": password})


def list_cases():
    return request("GET", "/cases")


def create_case(payload: dict):
    return request("POST", "/cases", json=payload)


def case(case_id: int):
    return request("GET", f"/cases/{case_id}")


def list_documents(case_id: int | None = None):
    suffix = f"?case_id={case_id}" if case_id else ""
    return request("GET", f"/documents{suffix}")


def create_document(payload: dict):
    return request("POST", "/documents", json=payload)


def add_version(document_id: int, file_storage):
    return request(
        "POST",
        f"/documents/{document_id}/versions",
        files={"file": (file_storage.filename, file_storage.stream, file_storage.mimetype)},
    )


def list_versions(document_id: int):
    return request("GET", f"/documents/{document_id}/versions")


def authorize(version_id: int, decision: str, note: str):
    return request("POST", f"/documents/versions/{version_id}/authorizations", json={"decision": decision, "note": note})


def sign(version_id: int):
    return request("POST", f"/documents/versions/{version_id}/signatures", json={})


def download_version(version_id: int):
    headers = _headers(web_channel=True)
    response = requests.get(f"{current_app.config['API_BASE_URL']}/documents/versions/{version_id}/content", headers=headers, timeout=30)
    if not response.ok:
        raise BackendError(_error_message(response), response.status_code)
    return response
