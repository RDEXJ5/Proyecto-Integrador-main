from __future__ import annotations

import json
import re

import requests


BASE_URL = "http://127.0.0.1:5000"
CSRF_PATTERN = re.compile(r'name="csrf_token" value="([^"]+)"')


def csrf_token(html: str) -> str:
    match = CSRF_PATTERN.search(html)
    if not match:
        raise AssertionError("No se encontró el token CSRF en el formulario.")
    return match.group(1)


def login(email: str) -> requests.Session:
    client = requests.Session()
    login_page = client.get(f"{BASE_URL}/login", timeout=10)
    login_page.raise_for_status()
    response = client.post(
        f"{BASE_URL}/login",
        data={
            "csrf_token": csrf_token(login_page.text),
            "email": email,
            "password": "2318",
        },
        timeout=15,
    )
    response.raise_for_status()
    if "/workspaces/" not in response.url:
        raise AssertionError(f"El inicio de sesión no llegó a un espacio de trabajo: {response.url}")
    return client


def main() -> None:
    contributor = login("web.abogado.20260731@example.test")
    case_page = contributor.get(f"{BASE_URL}/cases/1", timeout=15)
    case_page.raise_for_status()
    if "Agregar documento" not in case_page.text:
        raise AssertionError("El formulario de carga no se renderizó para el abogado.")

    pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    upload = contributor.post(
        f"{BASE_URL}/cases/1/documents",
        data={
            "csrf_token": csrf_token(case_page.text),
            "document_type_code": "evidence",
            "title": "Prueba integral desde Flask",
            "description": "Carga controlada para verificar el flujo web completo.",
        },
        files={"file": ("prueba-flask.pdf", pdf, "application/pdf")},
        allow_redirects=False,
        timeout=70,
    )
    if upload.status_code != 302:
        raise AssertionError(f"La carga Flask respondió {upload.status_code}: {upload.text[:300]}")
    location = upload.headers.get("Location", "")
    document_match = re.search(r"/documents/(\d+)", location)
    if not document_match:
        raise AssertionError(f"La carga no redirigió al documento creado: {location}")
    document_id = int(document_match.group(1))

    judge = login("web.juez.20260731@example.test")
    document_page = judge.get(f"{BASE_URL}/documents/{document_id}", timeout=15)
    document_page.raise_for_status()
    content_match = re.search(
        rf"/documents/{document_id}/versions/(\d+)/content",
        document_page.text,
    )
    if not content_match:
        raise AssertionError("El juez no recibió el control para abrir la versión almacenada.")
    version_id = int(content_match.group(1))
    content = judge.get(
        f"{BASE_URL}/documents/{document_id}/versions/{version_id}/content",
        timeout=70,
    )
    content.raise_for_status()
    if not content.content.startswith(b"%PDF"):
        raise AssertionError("El proxy Flask no devolvió el PDF original descifrado.")

    print(json.dumps({
        "status": "ok",
        "caseId": 1,
        "documentId": document_id,
        "versionId": version_id,
        "bytesReadByJudge": len(content.content),
    }))


if __name__ == "__main__":
    main()
