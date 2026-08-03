import hmac
import secrets
from functools import wraps

from flask import Flask, Response, abort, flash, redirect, render_template, request, session, url_for

import backend_client as api
from backend_client import BackendError
from config import Config


app = Flask(__name__)
app.config.from_object(Config)

WEB_ROLES = ("admin", "notary", "judge", "lawyer")
ROLE_DASHBOARDS = {
    "judge": "judge_dashboard.html",
    "notary": "notary_dashboard.html",
    "lawyer": "lawyer_dashboard.html",
}


@app.before_request
def protect_mutating_requests():
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        expected = session.get("csrf_token", "")
        supplied = request.form.get("csrf_token", "")
        if not expected or not hmac.compare_digest(expected, supplied):
            abort(400, "Solicitud rechazada por validación CSRF")


@app.context_processor
def inject_context():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return {"csrf_token": session["csrf_token"], "current_user": session.get("user")}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("access_token"):
            flash("Inicia sesión para acceder al expediente.", "warning")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def allowed_roles(*roles):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if session.get("user", {}).get("role") not in roles:
                flash("Tu rol no tiene permiso para esta operación.", "danger")
                return redirect(url_for("dashboard"))
            return view(*args, **kwargs)

        return wrapped

    return decorator


def backend_error(exc: BackendError):
    if exc.status_code == 401:
        session.clear()
        flash("La sesión expiró. Inicia sesión nuevamente.", "warning")
        return redirect(url_for("login"))
    flash(str(exc), "danger")
    return None


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("access_token"):
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        try:
            result = api.login(request.form.get("email", ""), request.form.get("password", ""))
            if result["user"]["role"] not in WEB_ROLES:
                flash("Las partes y los testigos deben acceder exclusivamente desde la aplicación móvil.", "warning")
                return render_template("login.html"), 403
            session["access_token"] = result["access_token"]
            session["user"] = result["user"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("dashboard"))
        except BackendError as exc:
            backend_error(exc)
    return render_template("login.html")


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
@login_required
def dashboard():
    try:
        cases = api.list_cases()
        documents = api.list_documents()
    except BackendError as exc:
        response = backend_error(exc)
        if response:
            return response
        cases, documents = [], []
    template = ROLE_DASHBOARDS.get(session["user"]["role"], "index.html")
    return render_template(template, cases=cases, documents=documents)


@app.route("/cases/new", methods=["GET", "POST"])
@login_required
@allowed_roles("admin", "notary", "lawyer")
def create_case():
    if request.method == "POST":
        try:
            payload = {
                "folio": request.form.get("folio", ""),
                "title": request.form.get("title", ""),
                "description": request.form.get("description") or None,
                "lawyer_id": int(request.form.get("lawyer_id", 0)),
                "judge_id": int(request.form["judge_id"]) if request.form.get("judge_id") else None,
            }
            case = api.create_case(payload)
            flash("Expediente creado. El folio ya forma parte de la trazabilidad.", "success")
            return redirect(url_for("case_detail", case_id=case["id"]))
        except (BackendError, ValueError) as exc:
            flash(str(exc), "danger")
    return render_template("case_form.html")


@app.get("/cases/<int:case_id>")
@login_required
@allowed_roles(*WEB_ROLES)
def case_detail(case_id: int):
    try:
        case = api.case(case_id)
        documents = api.list_documents(case_id)
    except BackendError as exc:
        response = backend_error(exc)
        return response or redirect(url_for("dashboard"))
    return render_template("case_detail.html", case=case, documents=documents)


@app.route("/documents/new", methods=["GET", "POST"])
@login_required
@allowed_roles("admin", "notary", "lawyer")
def create_document():
    if request.method == "POST":
        upload = request.files.get("file")
        if not upload or not upload.filename:
            flash("Selecciona un archivo para registrar la primera versión.", "danger")
            return render_template("document_form.html")
        try:
            document = api.create_document(
                {
                    "case_id": int(request.form.get("case_id", 0)),
                    "owner_id": int(request.form.get("owner_id", 0)),
                    "kind": request.form.get("kind", "other"),
                    "title": request.form.get("title", ""),
                    "description": request.form.get("description") or None,
                    "contains_sensitive_data": request.form.get("contains_sensitive_data") == "on",
                }
            )
            api.add_version(document["id"], upload)
            flash("Documento y versión 1 registrados, comprimidos y cifrados.", "success")
            return redirect(url_for("document_detail", document_id=document["id"]))
        except (BackendError, ValueError) as exc:
            flash(str(exc), "danger")
    return render_template("document_form.html")


@app.get("/documents/<int:document_id>")
@login_required
@allowed_roles(*WEB_ROLES)
def document_detail(document_id: int):
    try:
        document = api.request("GET", f"/documents/{document_id}")
        versions = api.list_versions(document_id)
    except BackendError as exc:
        response = backend_error(exc)
        return response or redirect(url_for("dashboard"))
    return render_template("document_detail.html", document=document, versions=versions)


@app.post("/documents/<int:document_id>/versions")
@login_required
@allowed_roles("admin", "notary", "lawyer")
def add_version(document_id: int):
    upload = request.files.get("file")
    if not upload or not upload.filename:
        flash("Selecciona un archivo.", "danger")
    else:
        try:
            version = api.add_version(document_id, upload)
            flash(f"Versión {version['version_number']} registrada sin sobrescribir el historial.", "success")
        except BackendError as exc:
            backend_error(exc)
    return redirect(url_for("document_detail", document_id=document_id))


@app.post("/versions/<int:version_id>/authorize")
@login_required
@allowed_roles("notary")
def authorize_version(version_id: int):
    try:
        api.authorize(version_id, request.form.get("decision", "rejected"), request.form.get("note", ""))
        flash("La autorización notarial fue registrada en la bitácora.", "success")
    except BackendError as exc:
        backend_error(exc)
    return redirect(request.referrer or url_for("dashboard"))


@app.post("/versions/<int:version_id>/sign")
@login_required
@allowed_roles("judge")
def sign_version(version_id: int):
    try:
        api.sign(version_id)
        flash("Firma de integridad registrada; su verificación queda disponible en la API.", "success")
    except BackendError as exc:
        backend_error(exc)
    return redirect(request.referrer or url_for("dashboard"))


@app.get("/versions/<int:version_id>/content")
@login_required
@allowed_roles("notary", "judge")
def download_version(version_id: int):
    try:
        result = api.download_version(version_id)
    except BackendError as exc:
        response = backend_error(exc)
        return response or redirect(url_for("dashboard"))
    return Response(
        result.content,
        content_type=result.headers.get("Content-Type", "application/octet-stream"),
        headers={"Content-Disposition": result.headers.get("Content-Disposition", "inline")},
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "document-control-web"}
