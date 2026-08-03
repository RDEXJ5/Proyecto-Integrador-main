from __future__ import annotations

import os
import secrets
import tempfile
from datetime import timedelta
from functools import wraps
from typing import Any
from urllib.parse import urljoin

import requests
from cachelib.file import FileSystemCache
from flask import (
    Flask,
    Response,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_session import Session
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError


ROLE_LABELS = {
    "lawyer": "Abogado",
    "prosecutor": "Fiscal",
    "defender": "Defensor",
    "expert": "Perito",
    "judge": "Juez",
    "notary": "Notario",
    "secretary": "Secretario",
    "coordinator": "Coordinador",
    "auditor": "Auditor",
    "admin": "Administración TI",
    "party": "Parte",
    "witness": "Testigo",
}

STATUS_LABELS = {
    "active": "Activo",
    "paused": "Pausado",
    "closed": "Cerrado",
    "annulled": "Anulado",
    "archived": "Archivado",
    "cancelled": "Cancelado",
    "superseded": "Reemplazado",
    "pending": "Pendiente",
    "accepted": "Aceptada",
    "declined": "Rechazada",
    "expired": "Vencida",
    "pending_analysis": "Análisis pendiente",
    "approved": "Aprobado",
    "authorized": "Autorizado",
    "signed": "Firmado",
    "valid": "Válido",
    "rejected": "Rechazado",
    "invalid": "Inválido",
    "returned": "Devuelto",
    "noted": "Registrado",
    "not_required": "No requerido",
    "optional": "Opcional",
    "suspended": "Suspendido",
    "completed": "Completado",
    "overdue": "Vencido",
    "draft": "Borrador",
    "available": "Disponible",
    "quarantine": "En cuarentena",
    "validating": "En validación",
    "queued": "En espera",
    "revoked": "Revocado",
    "inactive": "Inactivo",
    "visible": "Visible",
    "hidden": "Oculto",
    "failed": "Fallido",
    "ok": "Operativo",
    "ready": "Disponible",
    "reachable": "Conectado",
    "unknown": "Sin información",
    "degraded": "Con incidencias",
    "unavailable": "No disponible",
}

OBSERVATION_TYPE_LABELS = {
    "comment": "Comentario",
    "correction_required": "Corrección requerida",
    "clarification_required": "Aclaración requerida",
    "legal_review": "Revisión jurídica",
}

OBSERVATION_STATUS_LABELS = {
    "open": "Abierta",
    "responded": "Respondida",
    "resolved": "Resuelta",
    "withdrawn": "Retirada",
}

UI_LABELS: dict[str, dict[str, str]] = {
    "channel": {
        "web": "Sitio web",
        "mobile": "Aplicación móvil",
        "api": "Integración entre sistemas",
        "system": "Proceso automático",
        "technical": "Administración técnica",
    },
    "membership": {
        "member": "Integrante",
        "supervisor": "Supervisión",
        "auditor": "Auditoría",
    },
    "unit_type": {
        "court": "Juzgado",
        "chamber": "Sala",
        "tribunal": "Tribunal",
        "prosecutor_office": "Fiscalía",
        "public_defense": "Defensoría pública",
        "expert_unit": "Unidad pericial",
        "administrative": "Unidad administrativa",
    },
    "audit_action": {
        "admin.document_type_created": "Tipo documental creado",
        "admin.role_granted": "Rol concedido",
        "admin.role_revoked": "Rol revocado",
        "admin.user_created": "Usuario creado",
        "admin.user_password_reset": "Contraseña de usuario actualizada",
        "admin.user_status_changed": "Estado de usuario modificado",
        "auth.login_succeeded": "Inicio de sesión correcto",
        "auth.login_failed": "Intento de inicio de sesión fallido",
        "auth.mobile_registered": "Cuenta móvil creada",
        "profile.updated": "Datos de perfil actualizados",
        "case.created": "Expediente creado",
        "case.assignment_created": "Responsable asignado",
        "case.assignment_revoked": "Asignación finalizada",
        "case.participant_added": "Participante agregado",
        "case.participant_ended": "Participación finalizada",
        "case.invitation_sent": "Invitación enviada",
        "case.invitation_accepted": "Invitación aceptada",
        "case.invitation_declined": "Invitación rechazada",
        "case.invitation_expired": "Invitación vencida",
        "case.stage_changed": "Etapa procesal actualizada",
        "case.deadline_created": "Plazo creado",
        "case.deadline_status_changed": "Estado del plazo actualizado",
        "case.state_changed": "Estado del expediente actualizado",
        "case.decision_issued": "Decisión procesal emitida",
        "document.version_uploaded": "Versión documental cargada",
        "document.content_viewed": "Documento visualizado",
        "document.content_downloaded": "Documento descargado",
        "document.observation_created": "Observación creada",
        "document.observation_responded": "Observación respondida",
        "document.observation_resolved": "Observación resuelta",
        "document.review_recorded": "Revisión documental registrada",
        "document.authorization_recorded": "Autorización documental registrada",
        "document.certification_recorded": "Certificación documental registrada",
        "document.integrity_signature_recorded": "Firma de integridad registrada",
        "system.bootstrap_admin": "Cuenta administradora inicial creada",
        "system.user_provisioned": "Cuenta del sistema creada",
        "development_workspace_accounts_seeded": "Cuentas de prueba creadas",
        "qa.case.seeded": "Expediente de prueba creado",
        "qa.case.updated": "Expediente de prueba actualizado",
        "qa.judgment.signed": "Resolución de prueba firmada",
    },
    "resource": {
        "case": "Expediente",
        "case_assignment": "Asignación de expediente",
        "case_participant_role": "Participación en expediente",
        "case_participant_invitation": "Invitación a expediente",
        "case_stage_transition": "Cambio de etapa",
        "case_deadline": "Plazo procesal",
        "case_decision": "Decisión procesal",
        "document": "Documento",
        "document_version": "Versión documental",
        "document_observation": "Observación documental",
        "document_action": "Control documental",
        "document_signature": "Constancia de firma",
        "document_signature_record": "Constancia de firma",
        "document_type": "Tipo documental",
        "storage_object": "Archivo almacenado",
        "analysis_job": "Análisis documental",
        "user": "Usuario",
        "user_role_grant": "Asignación de rol",
        "role": "Rol",
        "system": "Sistema",
    },
    "stage": {
        "intake": "Recepción y clasificación",
        "filing": "Presentación y admisión",
        "evidence": "Integración y pruebas",
        "hearing": "Audiencia o revisión",
        "review": "Revisión",
        "decision": "Decisión o resolución",
        "closed": "Concluido",
    },
    "decision": {
        "procedural_order": "Acuerdo procesal",
        "interim_resolution": "Resolución interlocutoria",
        "final_judgment": "Sentencia final",
        "other": "Otra determinación",
    },
    "outcome": {
        "qa_validated": "Validación completada",
        "qa_validated_utf8": "Validación integral completada",
        "procedente": "Procedente",
        "improcedente": "Improcedente",
        "admitido": "Admitido",
        "rechazado": "Rechazado",
    },
    "workflow_action": {
        "review": "Revisión",
        "authorize": "Autorización",
        "certify": "Certificación",
        "sign": "Firma",
    },
    "document_type": {
        "marriage_certificate": "Acta matrimonial",
        "personal_identification": "Identificación oficial",
        "curp": "CURP",
        "birth_certificate": "Acta de nacimiento",
        "rfc": "RFC",
        "proof_of_address": "Comprobante de domicilio",
        "witness_identification": "Identificación de testigo",
        "libel": "Libelo",
        "judgment": "Resolución judicial",
        "initial_filing": "Escrito inicial",
        "answer_filing": "Contestación",
        "evidence": "Medio de prueba",
        "expert_report": "Dictamen pericial",
        "judicial_resolution": "Resolución judicial",
        "procedural_order": "Acuerdo procesal",
        "hearing_record": "Acta de audiencia",
        "notification": "Notificación",
        "official_request": "Oficio",
        "certified_copy": "Copia certificada",
        "qa_evidence": "Evidencia de pruebas",
        "qa_general_record_2026": "Registro general de pruebas",
        "other": "Anexo u otro documento",
    },
    "upload_source": {
        "web_file": "Archivo cargado desde el sitio web",
        "mobile_file": "Archivo cargado desde la aplicación móvil",
        "mobile_camera": "Documento capturado con la cámara móvil",
        "legacy_database": "Archivo migrado del sistema anterior",
    },
    "policy": {
        "none": "No aplica",
        "optional": "Opcional",
        "required": "Obligatoria",
        "conditional": "Condicional",
        "skip": "No analizar",
        "on_demand": "Analizar cuando se solicite",
        "automatic": "Análisis automático",
    },
    "scope": {
        "full": "Completo",
        "documental": "Documental",
        "procedural": "Procesal",
        "review": "Revisión",
        "audit": "Auditoría",
        "case": "Expediente",
        "participant": "Participante",
    },
    "environment": {
        "development": "Desarrollo",
        "test": "Pruebas",
        "staging": "Preproducción",
        "production": "Producción",
    },
    "duration": {
        "15m": "15 minutos",
        "30m": "30 minutos",
        "45m": "45 minutos",
        "1h": "1 hora",
        "2h": "2 horas",
    },
    "retention": {
        "compliance-10-years": "Conservación normativa durante 10 años",
    },
    "provider": {
        "minio": "MinIO (almacenamiento privado)",
        "s3": "Almacenamiento S3 privado",
        "legacy_database": "Base de datos histórica",
    },
    "permission": {
        "analysis.read": "Consultar resultados autorizados del análisis documental",
        "analysis.request": "Solicitar reconocimiento de texto, clasificación o análisis de firmas",
        "audit.read": "Consultar la bitácora de trazabilidad",
        "audit.report": "Generar reportes a partir de eventos históricos",
        "case.assign": "Asignar responsables a un expediente",
        "case.classify": "Clasificar expedientes por materia, tipo y confidencialidad",
        "case.create": "Crear expedientes conservando el historial",
        "case.create.own": "Crear expedientes propios o institucionales",
        "case.deadline.manage": "Crear y actualizar plazos procesales",
        "case.participant.manage": "Gestionar participantes sin eliminarlos",
        "case.people.read": "Consultar personas vinculadas a expedientes autorizados",
        "case.read.assigned": "Consultar expedientes permitidos por asignación",
        "case.read.audit": "Consultar metadatos históricos para auditoría",
        "case.read.unit": "Consultar expedientes autorizados de una unidad",
        "case.stage.manage": "Registrar cambios de etapa procesal",
        "case.visibility.manage": "Ocultar o reactivar expedientes de manera lógica",
        "catalog.manage": "Gestionar catálogos mediante activación lógica",
        "configuration.manage": "Gestionar la configuración técnica de la plataforma",
        "decision.issue": "Emitir decisiones en expedientes asignados",
        "document.authorize": "Registrar autorizaciones notariales",
        "document.certify": "Certificar versiones documentales cuando corresponda",
        "document.content.read.web": "Visualizar archivos originales desde el sitio web",
        "document.create": "Registrar documentos y su primera versión",
        "document.download.web": "Descargar archivos originales desde el sitio web",
        "document.observation.create": "Emitir observaciones sobre versiones documentales",
        "document.observation.resolve": "Resolver observaciones de manera auditable",
        "document.observation.respond": "Responder observaciones de documentos aportados",
        "document.read.assigned": "Consultar documentos de expedientes asignados",
        "document.review": "Registrar la revisión de versiones documentales",
        "document.sign": "Registrar firmas judiciales",
        "document.upload": "Cargar archivos existentes desde el sitio web",
        "document.version.create": "Registrar versiones nuevas sin sobrescribir",
        "role.manage": "Otorgar o revocar roles conservando el historial",
        "storage.object.create": "Registrar archivos en almacenamiento privado",
        "storage.object.read": "Consultar archivos después de validar el acceso",
        "system.health.read": "Consultar el estado de los servicios",
        "user.manage": "Crear, suspender o reactivar cuentas",
        "workspace.administration.access": "Acceder a administración técnica",
        "workspace.audit.access": "Acceder a auditoría",
        "workspace.contribution.access": "Acceder a carga y seguimiento",
        "workspace.mobile.access": "Acceder a la aplicación móvil",
        "workspace.process.access": "Acceder a gestión procesal",
        "workspace.review.access": "Acceder a revisión y decisión",
    },
}


def ui_label(value: Any, category: str = "general") -> str:
    """Convierte identificadores internos en texto legible para la interfaz."""
    if value is None or str(value).strip() == "":
        return "Sin información"
    text = str(value).strip()
    if category == "role":
        return ROLE_LABELS.get(text, _fallback_ui_label(text))
    if category == "status":
        return STATUS_LABELS.get(text, _fallback_ui_label(text))
    return UI_LABELS.get(category, {}).get(text, _fallback_ui_label(text))


def _fallback_ui_label(value: str) -> str:
    normalized = value.replace("_", " ").replace(".", " ").replace("-", " ").strip()
    return normalized[:1].upper() + normalized[1:] if normalized else "Sin información"


def repair_display_text(value: Any) -> Any:
    """Repara en pantalla texto UTF-8 legado sin modificar el dato almacenado."""
    if not isinstance(value, str):
        return value

    repaired = value
    mojibake_markers = ("Ã", "Â", "â€", "ðŸ", "ï¿½")
    for _ in range(2):
        if not any(marker in repaired for marker in mojibake_markers):
            break
        try:
            candidate = repaired.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if candidate == repaired:
            break
        repaired = candidate

    legacy_replacements = {
        "revisi??n": "revisión",
        "informaci??n": "información",
        "migraci??n": "migración",
        "asignaci??n": "asignación",
        "participaci??n": "participación",
        "hist??rico": "histórico",
        "expl??cita": "explícita",
        "m??vil": "móvil",
        "validaci�n": "validación",
        "revisi�n": "revisión",
        "autorizaci�n": "autorización",
        "certificaci�n": "certificación",
        "decisi�n": "decisión",
        "observaci�n": "observación",
        "aclaraci�n": "aclaración",
        "integraci�n": "integración",
        "informaci�n": "información",
        "clasificaci�n": "clasificación",
        "asignaci�n": "asignación",
        "resoluci�n": "resolución",
        "descripci�n": "descripción",
        "participaci�n": "participación",
        "notificaci�n": "notificación",
        "administraci�n": "administración",
        "configuraci�n": "configuración",
        "conservaci�n": "conservación",
        "versi�n": "versión",
        "transici�n": "transición",
        "gesti�n": "gestión",
        "m�dulo": "módulo",
        "�ntegra": "íntegra",
    }
    for broken, corrected in legacy_replacements.items():
        repaired = repaired.replace(broken, corrected)
        repaired = repaired.replace(broken.capitalize(), corrected.capitalize())

    return repaired.replace("\ufffd", "")


def format_file_size(value: Any) -> str:
    """Presenta cantidades de bytes en una unidad comprensible."""
    try:
        size = int(value)
    except (TypeError, ValueError):
        return "Sin información"

    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):g} MB"
    if size >= 1024:
        return f"{size / 1024:g} KB"
    return f"{size} bytes"

WORKSPACES: dict[str, dict[str, Any]] = {
    "contribution": {
        "label": "Carga y seguimiento",
        "eyebrow": "APORTACIÓN DOCUMENTAL",
        "title": "Carga y seguimiento",
        "description": "Sube documentos, conserva sus versiones y atiende observaciones de los asuntos asignados.",
        "roles": ("lawyer", "prosecutor", "defender", "expert"),
        "sections": (
            ("dashboard", "Inicio"),
            ("cases", "Expedientes y documentos"),
            ("observations", "Observaciones"),
        ),
    },
    "review": {
        "label": "Revisión y decisión",
        "eyebrow": "CONTROL DOCUMENTAL",
        "title": "Revisión y decisión",
        "description": "Analiza versiones y aplica observaciones, autorizaciones, certificaciones o firmas según tu permiso.",
        "roles": ("judge", "notary"),
        "sections": (
            ("dashboard", "Inicio"),
            ("queue", "Expedientes y revisión"),
        ),
    },
    "process": {
        "label": "Gestión procesal",
        "eyebrow": "OPERACIÓN JURISDICCIONAL",
        "title": "Gestión procesal",
        "description": "Crea, clasifica y asigna expedientes; controla sus etapas, responsables y plazos.",
        "roles": ("secretary", "coordinator"),
        "sections": (
            ("dashboard", "Inicio"),
            ("cases", "Expedientes y gestión"),
        ),
    },
    "audit": {
        "label": "Auditoría",
        "eyebrow": "TRAZABILIDAD",
        "title": "Auditoría",
        "description": "Consulta de solo lectura sobre accesos, versiones y acciones registradas en el sistema.",
        "roles": ("auditor",),
        "sections": (
            ("dashboard", "Inicio"),
            ("events", "Eventos"),
            ("access", "Accesos"),
            ("versions", "Versiones"),
            ("signatures", "Firmas"),
            ("reports", "Reportes"),
        ),
    },
    "administration": {
        "label": "Administración técnica",
        "eyebrow": "OPERACIÓN DE PLATAFORMA",
        "title": "Administración técnica",
        "description": "Gestiona identidades, permisos, catálogos y salud sin intervenir en decisiones jurídicas.",
        "roles": ("admin",),
        "sections": (
            ("dashboard", "Inicio"),
            ("users", "Usuarios"),
            ("roles", "Roles y permisos"),
            ("catalogs", "Catálogos"),
            ("configuration", "Configuración"),
            ("health", "Salud del sistema"),
        ),
    },
}

# Las rutas anteriores se conservan para marcadores y enlaces existentes, pero
# todas redirigen al único apartado que ofrece el mismo resultado funcional.
SECTION_ALIASES = {
    ("contribution", "documents"): "cases",
    ("contribution", "notifications"): "observations",
    ("review", "cases"): "queue",
    ("review", "decisions"): "queue",
    ("review", "history"): "queue",
    ("process", "assignments"): "cases",
    ("process", "stages"): "cases",
    ("process", "deadlines"): "cases",
}

WEB_ROLE_CODES = {
    role
    for workspace in WORKSPACES.values()
    for role in workspace["roles"]
}

BASE_ACTIONS: dict[str, tuple[dict[str, str], ...]] = {
    "contribution": (
        {"code": "document.upload", "label": "Subir documento", "description": "Registra un archivo existente y su tipo documental."},
        {"code": "document.version.create", "label": "Crear versión", "description": "Corrige un documento sin sobrescribir el historial."},
        {"code": "document.observation.respond", "label": "Responder observación", "description": "Atiende solicitudes de revisión dentro del expediente."},
    ),
    "process": (
        {"code": "case.create", "label": "Crear expediente", "description": "Registra y clasifica un nuevo asunto."},
        {"code": "case.assign", "label": "Asignar responsables", "description": "Vincula perfiles autorizados con el expediente."},
        {"code": "case.stage.manage", "label": "Controlar etapa y plazo", "description": "Actualiza el avance procesal sin eliminar información."},
    ),
    "audit": (
        {"code": "audit.read", "label": "Consultar trazabilidad", "description": "Revisa eventos históricos en modo de solo lectura."},
        {"code": "audit.report", "label": "Generar reporte", "description": "Filtra evidencia sin modificar los registros de origen."},
    ),
    "administration": (
        {"code": "user.manage", "label": "Gestionar usuarios", "description": "Crea, suspende o reactiva cuentas sin eliminarlas."},
        {"code": "role.manage", "label": "Roles y permisos", "description": "Administra capacidades y canales autorizados."},
        {"code": "catalog.manage", "label": "Configurar catálogos", "description": "Mantiene materias, tipos y políticas documentales."},
    ),
}

REVIEW_COMMON_ACTIONS = (
    {"code": "document.review", "label": "Revisar documento", "description": "Analiza la versión y sus resultados automáticos."},
    {"code": "document.observation.create", "label": "Emitir observación", "description": "Solicita aclaraciones sin alterar el documento."},
)
REVIEW_ROLE_ACTIONS = {
    "judge": (
        {"code": "decision.issue", "label": "Emitir decisión", "description": "Registra una determinación sobre el expediente asignado."},
        {"code": "document.sign", "label": "Firmar", "description": "Firma solamente los tipos documentales que lo requieren."},
    ),
    "notary": (
        {"code": "document.authorize", "label": "Autorizar", "description": "Da visto bueno a la versión revisada."},
        {"code": "document.certify", "label": "Certificar", "description": "Certifica integridad y correspondencia documental."},
    ),
}

DASHBOARD_SHORTCUTS: dict[str, tuple[dict[str, str], ...]] = {
    "contribution": (
        {"section": "cases", "label": "Expedientes", "description": "Consulta asuntos y aporta archivos existentes."},
        {"section": "observations", "label": "Observaciones", "description": "Atiende solicitudes y conserva cada respuesta."},
    ),
    "review": (
        {"section": "queue", "label": "Bandeja de revisión", "description": "Prioriza expedientes activos y abre sus documentos."},
    ),
    "process": (
        {"section": "cases", "label": "Gestión de expedientes", "description": "Crea asuntos y controla responsables, etapas y plazos."},
    ),
    "audit": (
        {"section": "events", "label": "Eventos", "description": "Consulta acciones permanentes de la plataforma."},
        {"section": "versions", "label": "Versiones", "description": "Revisa el historial documental sin modificarlo."},
        {"section": "reports", "label": "Reportes", "description": "Genera evidencia de trazabilidad en modo de lectura."},
    ),
    "administration": (
        {"section": "users", "label": "Usuarios", "description": "Gestiona cuentas mediante estados lógicos."},
        {"section": "catalogs", "label": "Catálogos", "description": "Configura tipos y políticas documentales."},
        {"section": "health", "label": "Salud del sistema", "description": "Comprueba API, base de datos y almacenamiento."},
    ),
}

WORKSPACE_GUIDES: dict[str, tuple[str, ...]] = {
    "contribution": (
        "Abre únicamente un expediente asignado.",
        "Selecciona el tipo documental antes de cargar el archivo.",
        "Atiende las observaciones mediante una versión nueva cuando corresponda.",
    ),
    "review": (
        "Prioriza los expedientes activos de tu bandeja.",
        "Comprueba la versión y la política de su tipo documental.",
        "Registra la revisión, decisión, autorización, certificación o firma permitida.",
    ),
    "process": (
        "Crea y clasifica el expediente.",
        "Asigna responsables e invita a las personas participantes.",
        "Controla etapas, plazos, estado y visibilidad sin eliminar registros.",
    ),
    "audit": (
        "Localiza el evento o recurso que necesitas comprobar.",
        "Contrasta accesos, versiones y firmas.",
        "Genera un reporte sin modificar la evidencia de origen.",
    ),
    "administration": (
        "Comprueba primero la salud de los servicios.",
        "Gestiona identidades y roles con un motivo auditable.",
        "Mantén catálogos y políticas sin intervenir en decisiones jurídicas.",
    ),
}

csrf = CSRFProtect()
server_session = Session()


class ApiClientError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def env_bool(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def role_codes(user: dict[str, Any]) -> set[str]:
    return {role for role in (user.get("roles") or []) if isinstance(role, str)}


def permission_codes(user: dict[str, Any]) -> set[str]:
    return {
        permission
        for permission in (user.get("permissions") or [])
        if isinstance(permission, str)
    }


def workspace_codes_for_user(user: dict[str, Any]) -> list[str]:
    roles = role_codes(user)
    return [
        code
        for code, workspace in WORKSPACES.items()
        if roles.intersection(workspace["roles"])
    ]


def workspace_model(code: str) -> dict[str, Any]:
    return {"code": code, **WORKSPACES[code]}


def active_workspace_for_user(user: dict[str, Any]) -> dict[str, Any] | None:
    available_codes = workspace_codes_for_user(user)
    if not available_codes:
        return None
    active_code = session.get("active_workspace")
    if active_code not in available_codes:
        active_code = available_codes[0]
    return workspace_model(active_code)


def actions_for_workspace(workspace_code: str, user: dict[str, Any]) -> list[dict[str, str]]:
    if workspace_code != "review":
        return list(BASE_ACTIONS.get(workspace_code, ()))

    actions = list(REVIEW_COMMON_ACTIONS)
    roles = role_codes(user)
    for role in ("judge", "notary"):
        if role in roles:
            actions.extend(REVIEW_ROLE_ACTIONS[role])
    return actions


def build_attention_items(
    workspace_code: str,
    cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Ordena expedientes reales para convertir el inicio en una bandeja útil."""
    if workspace_code not in {"contribution", "review", "process"}:
        return []

    def pending_count(case: dict[str, Any]) -> int:
        if workspace_code == "process":
            return int(case.get("pending_deadline_count") or 0)
        if workspace_code == "review":
            return int(case.get("pending_review_count") or case.get("pending_observation_count") or 0)
        return int(case.get("pending_observation_count") or 0)

    ordered_cases = sorted(
        cases,
        key=lambda case: (
            0 if case.get("status") == "active" else 1,
            -pending_count(case),
            str(case.get("folio") or ""),
        ),
    )

    items: list[dict[str, Any]] = []
    for case in ordered_cases[:6]:
        count = pending_count(case)
        if workspace_code == "contribution":
            detail = (
                f"{count} {'observación pendiente' if count == 1 else 'observaciones pendientes'}"
                if count
                else f"{int(case.get('document_count') or 0)} documentos registrados"
            )
            action = "Abrir y aportar"
        elif workspace_code == "review":
            detail = (
                f"{count} elemento{' requiere' if count == 1 else 's requieren'} atención"
                if count
                else "Disponible para revisión según tus permisos"
            )
            action = "Abrir revisión"
        else:
            detail = (
                f"{count} plazo{' pendiente' if count == 1 else 's pendientes'}"
                if count
                else f"Etapa: {case.get('current_stage_label') or ui_label(case.get('current_stage_code'), 'stage')}"
            )
            action = "Abrir gestión"

        items.append({
            "case": case,
            "detail": detail,
            "action": action,
            "requires_attention": count > 0,
        })
    return items


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    web_environment = os.getenv("WEB_ENV", "production")
    secret_key = os.getenv("FLASK_SECRET_KEY", "")
    if test_config is None and (secret_key.startswith("replace_with_") or len(secret_key) < 32):
        if web_environment != "development":
            raise RuntimeError("FLASK_SECRET_KEY debe ser un secreto aleatorio de al menos 32 caracteres.")
        secret_key = secrets.token_urlsafe(48)
        app.logger.warning(
            "FLASK_SECRET_KEY no está definida; se usará una clave efímera únicamente para desarrollo."
        )

    app.config.from_mapping(
        SECRET_KEY=secret_key,
        WEB_ENV=web_environment,
        API_BASE_URL=os.getenv("API_BASE_URL", "http://api:3000").rstrip("/") + "/",
        SESSION_TYPE="cachelib",
        SESSION_CACHELIB=FileSystemCache(
            cache_dir=os.getenv("SESSION_DIR", os.path.join(tempfile.gettempdir(), "expediente-web-sessions")),
            threshold=500,
        ),
        SESSION_COOKIE_NAME="expediente_web_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=env_bool("SESSION_COOKIE_SECURE"),
        SESSION_REFRESH_EACH_REQUEST=True,
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),
        WTF_CSRF_TIME_LIMIT=3600,
        MAX_CONTENT_LENGTH=int(os.getenv("WEB_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))),
    )
    if test_config:
        app.config.update(test_config)

    csrf.init_app(app)
    server_session.init_app(app)
    app.jinja_env.filters["ui_label"] = ui_label
    app.jinja_env.filters["display_text"] = repair_display_text
    app.jinja_env.filters["file_size"] = format_file_size
    app.jinja_env.finalize = repair_display_text

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; form-action 'self'; "
            "frame-ancestors 'none'; connect-src 'self'; img-src 'self' data: blob:; "
            "style-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'"
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.context_processor
    def template_globals():
        user = session.get("user") or {}
        available = [workspace_model(code) for code in workspace_codes_for_user(user)]
        active = active_workspace_for_user(user)
        return {
            "current_user": user,
            "role_labels": ROLE_LABELS,
            "status_labels": STATUS_LABELS,
            "observation_type_labels": OBSERVATION_TYPE_LABELS,
            "observation_status_labels": OBSERVATION_STATUS_LABELS,
            "available_workspaces": available,
            "active_workspace": active,
            "current_role_labels": [
                ROLE_LABELS.get(role, role)
                for role in (user.get("roles") or [])
                if isinstance(role, str)
            ],
            "current_permissions": permission_codes(user),
        }

    @app.get("/health")
    def health():
        try:
            payload = call_api(app, "GET", "health", authenticated=False)
            return jsonify({
                "status": "ok",
                "api": payload.get("status"),
                "database": payload.get("database"),
                "storage": payload.get("storage"),
            })
        except ApiClientError as error:
            return jsonify({"status": "degraded", "api": error.code}), 503

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET" and session.get("access_token"):
            return redirect(url_for("dashboard"))

        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            if not email or not password:
                flash("Escribe tu correo y contraseña.", "error")
                return render_template("login.html", email=email), 400

            credentials = {"email": email, "password": password}
            try:
                payload = call_api(
                    app,
                    "POST",
                    "auth/login",
                    authenticated=False,
                    json={**credentials, "clientChannel": "web"},
                )
            except ApiClientError as web_error:
                if web_error.code != "channel_not_allowed":
                    if web_error.status in {401, 403}:
                        flash(web_error.message, "error")
                        return render_template("login.html", email=email), web_error.status
                    raise
                try:
                    payload = call_api(
                        app,
                        "POST",
                        "auth/login",
                        authenticated=False,
                        json={**credentials, "clientChannel": "technical"},
                    )
                except ApiClientError:
                    flash(web_error.message, "error")
                    return render_template("login.html", email=email), web_error.status

            user = payload.get("user") or {}
            role_entries = user.get("roles") or []
            normalized_roles = [
                entry.get("code") if isinstance(entry, dict) else entry
                for entry in role_entries
            ]
            normalized_roles = [code for code in normalized_roles if isinstance(code, str)]
            user["roleDetails"] = role_entries
            user["roles"] = normalized_roles
            if not WEB_ROLE_CODES.intersection(normalized_roles):
                flash("Este perfil debe utilizar la aplicación móvil.", "error")
                return render_template("login.html", email=email), 403

            session.clear()
            session.permanent = True
            session["access_token"] = payload["accessToken"]
            session["user"] = user
            session["active_workspace"] = workspace_codes_for_user(user)[0]
            flash(f"Bienvenido, {user.get('fullName', 'usuario')}.", "success")
            return redirect(url_for("dashboard"))

        return render_template("login.html", email="")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        flash("La sesión se cerró correctamente.", "success")
        return redirect(url_for("login"))

    @app.get("/")
    def index():
        return redirect(url_for("dashboard" if session.get("access_token") else "login"))

    @app.get("/dashboard")
    @login_required
    def dashboard():
        codes = workspace_codes_for_user(session["user"])
        if not codes:
            return render_template(
                "error.html",
                status=403,
                message="Tu cuenta no tiene un espacio WEB autorizado.",
            ), 403
        active_code = session.get("active_workspace")
        return redirect(url_for("workspace_dashboard", workspace_code=active_code if active_code in codes else codes[0]))

    @app.route("/profile", methods=["GET", "POST"])
    @login_required
    def profile():
        user = session["user"]
        if request.method == "POST":
            try:
                payload = call_api(
                    app,
                    "PATCH",
                    "auth/me",
                    json={"fullName": request.form.get("full_name", "")},
                )
            except ApiClientError as error:
                if error.status == 401:
                    raise
                flash(error.message, "error")
                return redirect(url_for("profile"))

            returned_user = payload.get("user") or {}
            updated_user = dict(user)
            updated_user["fullName"] = returned_user.get("fullName", user.get("fullName"))
            session["user"] = updated_user
            flash(
                "Tu nombre visible se actualizó correctamente."
                if payload.get("changed")
                else "El nombre ya estaba registrado de esa manera.",
                "success",
            )
            return redirect(url_for("profile"))

        return render_template(
            "profile.html",
            profile_permissions=[
                ui_label(permission, "permission")
                for permission in sorted(permission_codes(user))
            ],
            session_minutes=int(app.permanent_session_lifetime.total_seconds() / 60),
        )

    @app.get("/workspaces/<workspace_code>")
    @login_required
    def workspace_dashboard(workspace_code: str):
        assert_workspace_access(workspace_code)
        session["active_workspace"] = workspace_code
        workspace = workspace_model(workspace_code)
        cases, notice = load_workspace_cases(app, workspace_code)
        health_status = load_health_status(app) if workspace_code == "administration" else None
        module_data: dict[str, Any] = {}
        if workspace_code == "audit":
            module_data = call_api(app, "GET", "audit/overview")
        elif workspace_code == "administration":
            module_data = call_api(app, "GET", "administration/overview")
        return render_template(
            "workspace_dashboard.html",
            workspace=workspace,
            cases=cases,
            notice=notice,
            health_status=health_status,
            metrics=build_workspace_metrics(workspace_code, cases, health_status, module_data),
            module_data=module_data,
            actions=actions_for_workspace(workspace_code, session["user"]),
            attention_items=build_attention_items(workspace_code, cases),
            shortcuts=DASHBOARD_SHORTCUTS.get(workspace_code, ()),
            workspace_guide=WORKSPACE_GUIDES.get(workspace_code, ()),
        )

    @app.get("/workspaces/<workspace_code>/<section_code>")
    @login_required
    def workspace_section(workspace_code: str, section_code: str):
        assert_workspace_access(workspace_code)
        workspace = workspace_model(workspace_code)
        section_map = dict(workspace["sections"])
        canonical_section = SECTION_ALIASES.get((workspace_code, section_code))
        if canonical_section:
            return redirect(url_for(
                "workspace_section",
                workspace_code=workspace_code,
                section_code=canonical_section,
            ))
        if section_code == "dashboard":
            return redirect(url_for("workspace_dashboard", workspace_code=workspace_code))
        if section_code not in section_map:
            abort(404)

        session["active_workspace"] = workspace_code
        list_sections = {"cases", "queue"}
        cases, notice = load_workspace_cases(app, workspace_code) if section_code in list_sections else ([], None)
        observations: list[dict[str, Any]] = []
        if section_code in {"observations", "notifications"}:
            observation_payload = call_api(app, "GET", "observations")
            observations = observation_payload.get("observations") or []
        health_status = load_health_status(app) if workspace_code == "administration" and section_code == "health" else None
        process_catalogs: dict[str, Any] = {}
        audit_data: dict[str, Any] = {}
        administration_data: dict[str, Any] = {}
        if workspace_code == "process" and section_code == "cases":
            process_catalogs = (call_api(app, "GET", "process/catalogs").get("catalogs") or {})
        if workspace_code == "audit" and section_code in {"events", "access", "versions", "signatures"}:
            audit_data = call_api(app, "GET", f"audit/{section_code}")
        if workspace_code == "administration":
            endpoint_by_section = {
                "users": "administration/users",
                "roles": "administration/roles",
                "catalogs": "administration/catalogs",
                "configuration": "administration/configuration",
            }
            endpoint = endpoint_by_section.get(section_code)
            if endpoint:
                administration_data = call_api(app, "GET", endpoint)
            if section_code == "users":
                administration_data["roles"] = call_api(app, "GET", "administration/roles").get("roles") or []
        return render_template(
            "workspace_section.html",
            workspace=workspace,
            section_code=section_code,
            section_label=section_map[section_code],
            cases=cases,
            observations=observations,
            notice=notice,
            health_status=health_status,
            process_catalogs=process_catalogs,
            audit_data=audit_data,
            administration_data=administration_data,
            actions=actions_for_workspace(workspace_code, session["user"]),
        )

    @app.get("/workspaces/administration/users/<int:user_id>")
    @login_required
    def administration_user_detail(user_id: int):
        assert_workspace_access("administration")
        if "user.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede consultar usuarios.")
        session["active_workspace"] = "administration"
        profile_data = call_api(app, "GET", f"administration/users/{user_id}")
        return render_template(
            "administration_user_detail.html",
            user_profile=profile_data.get("user") or {},
            active_roles=profile_data.get("activeRoles") or [],
            profile_permissions=profile_data.get("permissions") or [],
            role_history=profile_data.get("roleHistory") or [],
            status_history=profile_data.get("statusHistory") or [],
            unit_memberships=profile_data.get("unitMemberships") or [],
        )

    # Rutas de compatibilidad con los paneles originales.
    @app.get("/notary/dashboard")
    @login_required
    @role_required("notary")
    def notary_dashboard():
        return redirect(url_for("workspace_dashboard", workspace_code="review"))

    @app.get("/judge/dashboard")
    @login_required
    @role_required("judge")
    def judge_dashboard():
        return redirect(url_for("workspace_dashboard", workspace_code="review"))

    @app.get("/lawyer/dashboard")
    @login_required
    @role_required("lawyer")
    def lawyer_dashboard():
        return redirect(url_for("workspace_dashboard", workspace_code="contribution"))

    @app.get("/cases/<int:case_id>")
    @login_required
    def case_detail(case_id: int):
        case_payload = call_api(app, "GET", f"cases/{case_id}")
        document_payload = call_api(app, "GET", f"cases/{case_id}/documents")
        people = {"professionals": [], "participants": []}
        if "case.people.read" in permission_codes(session["user"]):
            people_payload = call_api(app, "GET", f"cases/{case_id}/people")
            people = people_payload.get("people") or people
        document_types: list[dict[str, Any]] = []
        if "document.upload" in permission_codes(session["user"]):
            type_payload = call_api(app, "GET", f"cases/{case_id}/document-types")
            document_types = type_payload.get("documentTypes") or []
        decisions: list[dict[str, Any]] = []
        if (
            "decision.issue" in permission_codes(session["user"])
            or "notary" in role_codes(session["user"])
        ):
            decision_payload = call_api(app, "GET", f"cases/{case_id}/decisions")
            decisions = decision_payload.get("decisions") or []
        active = active_workspace_for_user(session["user"])
        process_data: dict[str, Any] = {}
        process_catalogs: dict[str, Any] = {}
        if active and active["code"] == "process":
            process_data = call_api(app, "GET", f"process/cases/{case_id}").get("process") or {}
            process_catalogs = call_api(app, "GET", f"process/catalogs?caseId={case_id}").get("catalogs") or {}
        return render_template(
            "case_detail.html",
            case=case_payload.get("case") or {},
            documents=document_payload.get("documents") or [],
            people=people,
            document_types=document_types,
            decisions=decisions,
            process_data=process_data,
            process_catalogs=process_catalogs,
            actions=actions_for_workspace(active["code"], session["user"]) if active else [],
        )

    @app.post("/cases/<int:case_id>/documents")
    @login_required
    def upload_document(case_id: int):
        if "document.upload" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede cargar documentos.")
        uploaded_file = request.files.get("file")
        if not uploaded_file or not uploaded_file.filename:
            flash("Selecciona un archivo PDF, JPG, PNG o DOCX.", "error")
            return redirect(url_for("case_detail", case_id=case_id))
        payload = call_api(
            app,
            "POST",
            f"cases/{case_id}/documents",
            data={
                "documentTypeCode": request.form.get("document_type_code", ""),
                "title": request.form.get("title", ""),
                "description": request.form.get("description", ""),
            },
            files={
                "file": (
                    uploaded_file.filename,
                    uploaded_file.stream,
                    uploaded_file.mimetype or "application/octet-stream",
                )
            },
            timeout=65,
        )
        document = payload.get("document") or {}
        flash("Documento almacenado y primera versión registrada correctamente.", "success")
        return redirect(url_for("document_detail", document_id=document.get("id")))

    @app.get("/documents/<int:document_id>")
    @login_required
    def document_detail(document_id: int):
        document_payload = call_api(app, "GET", f"documents/{document_id}")
        versions_payload = call_api(app, "GET", f"documents/{document_id}/versions")
        observations_payload = call_api(app, "GET", f"documents/{document_id}/observations")
        workflow = {"actions": [], "signatures": []}
        workflow_permissions = {
            "document.review",
            "document.authorize",
            "document.certify",
            "document.sign",
        }
        if permission_codes(session["user"]).intersection(workflow_permissions):
            workflow = call_api(app, "GET", f"documents/{document_id}/workflow")
        active = active_workspace_for_user(session["user"])
        return render_template(
            "document_detail.html",
            document=document_payload.get("document") or {},
            versions=versions_payload.get("versions") or [],
            observations=observations_payload.get("observations") or [],
            workflow_actions=workflow.get("actions") or [],
            signatures=workflow.get("signatures") or [],
            actions=actions_for_workspace(active["code"], session["user"]) if active else [],
        )

    @app.post("/documents/<int:document_id>/versions/<int:version_id>/actions")
    @login_required
    def record_document_action(document_id: int, version_id: int):
        action_code = request.form.get("action_code", "")
        permission_by_action = {
            "review": "document.review",
            "authorize": "document.authorize",
            "certify": "document.certify",
        }
        required_permission = permission_by_action.get(action_code)
        if not required_permission or required_permission not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede registrar esta acción documental.")
        call_api(
            app,
            "POST",
            f"documents/{document_id}/versions/{version_id}/actions",
            json={
                "actionCode": action_code,
                "outcome": request.form.get("outcome", ""),
                "note": request.form.get("note", ""),
            },
        )
        flash("Acción registrada en el historial inmutable de la versión.", "success")
        return redirect(url_for("document_detail", document_id=document_id) + f"#version-{version_id}")

    @app.post("/documents/<int:document_id>/versions/<int:version_id>/signatures")
    @login_required
    def sign_document_version(document_id: int, version_id: int):
        if "document.sign" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede firmar versiones documentales.")
        call_api(
            app,
            "POST",
            f"documents/{document_id}/versions/{version_id}/signatures",
            json={"confirmation": request.form.get("confirmation") == "yes"},
        )
        flash("Constancia de firma e integridad registrada correctamente.", "success")
        return redirect(url_for("document_detail", document_id=document_id) + f"#version-{version_id}")

    @app.post("/cases/<int:case_id>/decisions")
    @login_required
    def issue_case_decision(case_id: int):
        if "decision.issue" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede emitir decisiones procesales.")
        call_api(
            app,
            "POST",
            f"cases/{case_id}/decisions",
            json={
                "decisionType": request.form.get("decision_type", ""),
                "outcomeCode": request.form.get("outcome_code", ""),
                "title": request.form.get("title", ""),
                "reasoning": request.form.get("reasoning", ""),
                "documentVersionId": request.form.get("document_version_id", ""),
                "supersedesDecisionId": request.form.get("supersedes_decision_id", ""),
            },
        )
        flash("Decisión emitida y conservada permanentemente.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#decisions")

    @app.post("/process/cases")
    @login_required
    def create_process_case():
        if "case.create" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede crear expedientes.")
        payload = call_api(
            app,
            "POST",
            "process/cases",
            json={
                "folio": request.form.get("folio", ""),
                "title": request.form.get("title", ""),
                "description": request.form.get("description", ""),
                "caseTypeCode": request.form.get("case_type_code", ""),
                "organizationalUnitId": request.form.get("organizational_unit_id", ""),
                "confidentialityLevel": request.form.get("confidentiality_level", ""),
                "initialStatus": request.form.get("initial_status", "active"),
                "statusReason": request.form.get("status_reason", ""),
            },
        )
        created = payload.get("case") or {}
        flash("Expediente creado y asignado a tu gestión.", "success")
        return redirect(url_for("case_detail", case_id=created.get("id")))

    @app.post("/process/cases/<int:case_id>/assignments")
    @login_required
    def create_case_assignment(case_id: int):
        if "case.assign" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede asignar responsables.")
        candidate = request.form.get("assignment_candidate", "").strip()
        if candidate:
            user_id, separator, assignment_type_code = candidate.partition(":")
            if not separator or not user_id.isdigit() or not assignment_type_code:
                flash("Selecciona una persona y una responsabilidad válidas.", "error")
                return redirect(url_for("case_detail", case_id=case_id) + "#process-management")
        else:
            # Compatibilidad con clientes anteriores; la API vuelve a validar el rol.
            user_id = request.form.get("user_id", "")
            assignment_type_code = request.form.get("assignment_type_code", "")
        call_api(app, "POST", f"process/cases/{case_id}/assignments", json={
            "userId": user_id,
            "assignmentTypeCode": assignment_type_code,
            "assignmentScope": request.form.get("assignment_scope", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Responsable asignado sin alterar las asignaciones históricas.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/assignments/<int:assignment_id>/end")
    @login_required
    def end_case_assignment(case_id: int, assignment_id: int):
        if "case.assign" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede finalizar asignaciones.")
        call_api(app, "POST", f"process/cases/{case_id}/assignments/{assignment_id}/end", json={
            "reason": request.form.get("reason", ""),
        })
        flash("Asignación finalizada mediante baja lógica.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/invitations")
    @login_required
    def create_case_invitation(case_id: int):
        if "case.participant.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede invitar participantes.")
        candidate = request.form.get("participant_candidate", "").strip()
        if candidate:
            user_id, separator, participant_role_code = candidate.partition(":")
            if not separator or not user_id.isdigit() or not participant_role_code:
                flash("Selecciona una persona y una calidad procesal válidas.", "error")
                return redirect(url_for("case_detail", case_id=case_id) + "#process-management")
        else:
            # Compatibilidad con clientes anteriores; la API vuelve a validar el perfil móvil.
            user_id = request.form.get("user_id", "")
            participant_role_code = request.form.get("participant_role_code", "")
        call_api(app, "POST", f"process/cases/{case_id}/invitations", json={
            "userId": user_id,
            "participantRoleCode": participant_role_code,
            "reason": request.form.get("reason", ""),
        })
        flash("Invitación enviada. La persona obtendrá acceso cuando la acepte desde la aplicación móvil.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/participants/<int:participation_id>/end")
    @login_required
    def end_case_participant(case_id: int, participation_id: int):
        if "case.participant.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede finalizar participaciones.")
        call_api(app, "POST", f"process/cases/{case_id}/participants/{participation_id}/end", json={
            "reason": request.form.get("reason", ""),
        })
        flash("Participación inactivada lógicamente; su historial se conserva.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/stages")
    @login_required
    def change_case_stage(case_id: int):
        if "case.stage.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede cambiar etapas.")
        call_api(app, "POST", f"process/cases/{case_id}/stages", json={
            "stageCode": request.form.get("stage_code", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Nueva etapa registrada en el historial.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/deadlines")
    @login_required
    def create_case_deadline(case_id: int):
        if "case.deadline.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede crear plazos.")
        call_api(app, "POST", f"process/cases/{case_id}/deadlines", json={
            "title": request.form.get("title", ""),
            "description": request.form.get("description", ""),
            "dueAt": request.form.get("due_at", ""),
            "assignedUserId": request.form.get("assigned_user_id", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Plazo registrado con estado pendiente.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/deadlines/<int:deadline_id>/status")
    @login_required
    def change_deadline_status(case_id: int, deadline_id: int):
        if "case.deadline.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede actualizar plazos.")
        call_api(app, "POST", f"process/cases/{case_id}/deadlines/{deadline_id}/status", json={
            "status": request.form.get("status", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Estado del plazo actualizado y conservado en historial.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.post("/process/cases/<int:case_id>/state")
    @login_required
    def change_case_state(case_id: int):
        if not permission_codes(session["user"]).intersection({"case.stage.manage", "case.visibility.manage"}):
            abort(403, description="Tu perfil no puede cambiar el estado del expediente.")
        call_api(app, "POST", f"process/cases/{case_id}/state", json={
            "lifecycleStatus": request.form.get("lifecycle_status", ""),
            "visibilityStatus": request.form.get("visibility_status", "visible"),
            "reason": request.form.get("reason", ""),
        })
        flash("Estado actualizado mediante trazabilidad y borrado lógico.", "success")
        return redirect(url_for("case_detail", case_id=case_id) + "#process-management")

    @app.get("/workspaces/audit/reports/download")
    @login_required
    def download_audit_report():
        if "audit.report" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede generar reportes.")
        api_response = call_api_response(app, "GET", "audit/report.csv", params={"limit": "5000"})
        response = Response(api_response.content, status=api_response.status_code, content_type="text/csv; charset=utf-8")
        response.headers["Content-Disposition"] = api_response.headers.get("Content-Disposition", "attachment; filename=reporte-auditoria.csv")
        response.headers["Cache-Control"] = "private, no-store, max-age=0"
        return response

    @app.post("/administration/users")
    @login_required
    def create_administration_user():
        if "user.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede crear usuarios.")
        call_api(app, "POST", "administration/users", json={
            "fullName": request.form.get("full_name", ""),
            "email": request.form.get("email", ""),
            "password": request.form.get("password", ""),
            "roleCode": request.form.get("role_code", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Usuario creado sin exponer la contraseña en la base de datos.", "success")
        return redirect(url_for("workspace_section", workspace_code="administration", section_code="users"))

    @app.post("/administration/users/<int:user_id>/password")
    @login_required
    def change_administration_user_password(user_id: int):
        if "user.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede actualizar contraseñas.")
        call_api(app, "POST", f"administration/users/{user_id}/password", json={
            "password": request.form.get("password", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Contraseña actualizada y registrada en la bitácora sin revelar su contenido.", "success")
        return redirect(url_for("administration_user_detail", user_id=user_id))

    @app.post("/administration/users/<int:user_id>/status")
    @login_required
    def change_administration_user_status(user_id: int):
        if "user.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede cambiar usuarios.")
        call_api(app, "POST", f"administration/users/{user_id}/status", json={
            "status": request.form.get("status", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Estado de cuenta actualizado sin eliminar al usuario.", "success")
        return redirect(url_for("workspace_section", workspace_code="administration", section_code="users"))

    @app.post("/administration/users/<int:user_id>/roles")
    @login_required
    def grant_administration_role(user_id: int):
        if "role.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede conceder roles.")
        call_api(app, "POST", f"administration/users/{user_id}/roles", json={
            "roleCode": request.form.get("role_code", ""),
            "reason": request.form.get("reason", ""),
        })
        flash("Rol concedido mediante un registro revocable y permanente.", "success")
        return redirect(url_for("workspace_section", workspace_code="administration", section_code="users"))

    @app.post("/administration/users/<int:user_id>/roles/<role_code>/revoke")
    @login_required
    def revoke_administration_role(user_id: int, role_code: str):
        if "role.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede revocar roles.")
        call_api(app, "POST", f"administration/users/{user_id}/roles/{role_code}/revoke", json={
            "reason": request.form.get("reason", ""),
        })
        flash("Rol revocado lógicamente; el historial de concesión se conserva.", "success")
        return redirect(url_for("workspace_section", workspace_code="administration", section_code="users"))

    @app.post("/administration/document-types")
    @login_required
    def create_administration_document_type():
        if "catalog.manage" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede crear tipos documentales.")
        call_api(app, "POST", "administration/document-types", json={
            "code": request.form.get("code", ""),
            "label": request.form.get("label", ""),
            "description": request.form.get("description", ""),
            "ownerScope": request.form.get("owner_scope", ""),
            "defaultSensitive": request.form.get("default_sensitive") == "yes",
            "embeddedSignaturePolicy": request.form.get("embedded_signature_policy", "none"),
            "platformSignaturePolicy": request.form.get("platform_signature_policy", "none"),
            "requiresAuthorization": request.form.get("requires_authorization") == "yes",
            "requiresCertification": request.form.get("requires_certification") == "yes",
            "analyzerPolicy": request.form.get("analyzer_policy", "skip"),
            "signerRoles": request.form.getlist("signer_roles"),
        })
        flash("Tipo documental y su primera regla inmutable creados.", "success")
        return redirect(url_for("workspace_section", workspace_code="administration", section_code="catalogs"))

    @app.post("/documents/<int:document_id>/versions/<int:version_id>/observations")
    @login_required
    def create_document_observation(document_id: int, version_id: int):
        if "document.observation.create" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede emitir observaciones documentales.")
        call_api(
            app,
            "POST",
            f"documents/{document_id}/versions/{version_id}/observations",
            json={
                "observationType": request.form.get("observation_type", ""),
                "body": request.form.get("body", ""),
            },
        )
        flash("Observación registrada sin modificar el documento.", "success")
        return redirect(url_for("document_detail", document_id=document_id) + "#observations")

    @app.post("/documents/<int:document_id>/observations/<int:observation_id>/responses")
    @login_required
    def respond_document_observation(document_id: int, observation_id: int):
        if "document.observation.respond" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede responder observaciones documentales.")
        call_api(
            app,
            "POST",
            f"documents/{document_id}/observations/{observation_id}/responses",
            json={
                "body": request.form.get("body", ""),
                "referencedDocumentVersionId": request.form.get("referenced_document_version_id", ""),
            },
        )
        flash("Respuesta agregada al historial de la observación.", "success")
        return redirect(url_for("document_detail", document_id=document_id) + "#observations")

    @app.post("/documents/<int:document_id>/observations/<int:observation_id>/resolve")
    @login_required
    def resolve_document_observation(document_id: int, observation_id: int):
        if "document.observation.resolve" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede resolver observaciones documentales.")
        call_api(
            app,
            "POST",
            f"documents/{document_id}/observations/{observation_id}/resolve",
            json={"resolutionNote": request.form.get("resolution_note", "")},
        )
        flash("Observación marcada como resuelta y conservada en el historial.", "success")
        return redirect(url_for("document_detail", document_id=document_id) + "#observations")

    @app.post("/documents/<int:document_id>/versions")
    @login_required
    def upload_document_version(document_id: int):
        if "document.version.create" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede crear versiones documentales.")
        uploaded_file = request.files.get("file")
        if not uploaded_file or not uploaded_file.filename:
            flash("Selecciona el archivo de la nueva versión.", "error")
            return redirect(url_for("document_detail", document_id=document_id))
        call_api(
            app,
            "POST",
            f"documents/{document_id}/versions",
            files={
                "file": (
                    uploaded_file.filename,
                    uploaded_file.stream,
                    uploaded_file.mimetype or "application/octet-stream",
                )
            },
            timeout=65,
        )
        flash("Nueva versión registrada sin sobrescribir el historial.", "success")
        return redirect(url_for("document_detail", document_id=document_id))

    @app.get("/documents/<int:document_id>/versions/<int:version_id>/content")
    @login_required
    def document_content(document_id: int, version_id: int):
        if "document.content.read.web" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede abrir archivos originales.")
        wants_download = request.args.get("download") == "1"
        if wants_download and "document.download.web" not in permission_codes(session["user"]):
            abort(403, description="Tu perfil no puede descargar archivos originales.")
        api_response = call_api_response(
            app,
            "GET",
            f"documents/{document_id}/versions/{version_id}/content",
            params={"download": "1" if wants_download else "0"},
            timeout=65,
        )
        response = Response(
            api_response.content,
            status=api_response.status_code,
            content_type=api_response.headers.get("Content-Type", "application/octet-stream"),
        )
        for header in ("Content-Disposition", "Content-Length", "Cache-Control", "Pragma"):
            if header in api_response.headers:
                response.headers[header] = api_response.headers[header]
        return response

    @app.errorhandler(ApiClientError)
    def handle_api_error(error: ApiClientError):
        if error.status == 401:
            session.clear()
            flash("Tu sesión expiró. Inicia sesión nuevamente.", "error")
            return redirect(url_for("login"))
        return render_template("error.html", status=error.status, message=error.message), error.status

    @app.errorhandler(CSRFError)
    def handle_csrf_error(_error: CSRFError):
        return render_template(
            "error.html",
            status=400,
            message="La solicitud perdió su validación de seguridad. Actualiza la página e inténtalo de nuevo.",
        ), 400

    @app.errorhandler(403)
    def forbidden(error):
        return render_template(
            "error.html",
            status=403,
            message=getattr(error, "description", "Tu cuenta no tiene acceso a esta vista."),
        ), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", status=404, message="La página solicitada no existe."), 404

    @app.errorhandler(500)
    def internal_error(_error):
        return render_template(
            "error.html",
            status=500,
            message="No fue posible completar la operación. Inténtalo nuevamente.",
        ), 500

    return app


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not session.get("access_token") or not session.get("user"):
            flash("Inicia sesión para acceder al sistema.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def role_required(role: str):
    def decorator(view):
        @wraps(view)
        def wrapped_view(*args, **kwargs):
            if role not in role_codes(session.get("user") or {}):
                return render_template(
                    "error.html",
                    status=403,
                    message="Tu perfil no tiene acceso a esta vista.",
                ), 403
            return view(*args, **kwargs)

        return wrapped_view

    return decorator


def assert_workspace_access(workspace_code: str) -> None:
    if workspace_code not in WORKSPACES:
        abort(404)
    if workspace_code not in workspace_codes_for_user(session.get("user") or {}):
        abort(403, description="Tu perfil no tiene acceso a este espacio de trabajo.")


def load_workspace_cases(app: Flask, workspace_code: str) -> tuple[list[dict[str, Any]], str | None]:
    if workspace_code not in {"contribution", "review", "process"}:
        return [], None
    try:
        payload = call_api(app, "GET", "cases")
        return payload.get("cases") or [], None
    except ApiClientError as error:
        if error.status == 401:
            raise
        return [], "El sistema todavía no habilita la consulta necesaria para este espacio de trabajo."


def load_health_status(app: Flask) -> dict[str, Any]:
    try:
        payload = call_api(app, "GET", "health", authenticated=False)
        return {
            "available": True,
            "api": payload.get("status", "ok"),
            "database": payload.get("database", "unknown"),
            "storage": payload.get("storage", "unknown"),
        }
    except ApiClientError:
        return {"available": False, "api": "unavailable", "database": "unknown", "storage": "unknown"}


def build_workspace_metrics(
    workspace_code: str,
    cases: list[dict[str, Any]],
    health_status: dict[str, Any] | None,
    module_data: dict[str, Any] | None = None,
) -> list[dict[str, str | int]]:
    active_count = sum(1 for case in cases if case.get("status") == "active")
    pending_observations = sum(
        int(case.get("pending_observation_count") or 0)
        for case in cases
    )
    pending_deadlines = sum(
        int(case.get("pending_deadline_count") or 0)
        for case in cases
    )
    if workspace_code in {"contribution", "review", "process"}:
        third_label = {
            "contribution": "Observaciones pendientes",
            "review": "Revisiones pendientes",
            "process": "Plazos próximos",
        }[workspace_code]
        return [
            {"value": len(cases), "label": "Expedientes visibles", "detail": "Según asignación"},
            {"value": active_count, "label": "Expedientes activos", "detail": "Estado actual"},
            {
                "value": pending_observations if workspace_code in {"contribution", "review"} else pending_deadlines,
                "label": third_label,
                "detail": "En expedientes asignados",
            },
            {"value": "100%", "label": "Acceso protegido", "detail": "Validado por permisos"},
        ]
    if workspace_code == "audit":
        overview = (module_data or {}).get("overview") or {}
        return [
            {"value": overview.get("event_count", 0), "label": "Eventos consultables", "detail": "Bitácora permanente"},
            {"value": "Solo", "label": "Modo de acceso", "detail": "Lectura"},
            {"value": overview.get("version_count", 0), "label": "Versiones", "detail": "Sin eliminaciones"},
            {"value": overview.get("signature_count", 0), "label": "Firmas", "detail": "Verificables"},
        ]
    if workspace_code == "administration":
        overview = (module_data or {}).get("overview") or {}
        is_available = bool(health_status and health_status.get("available"))
        return [
            {"value": "En línea" if is_available else "Revisar", "label": "API", "detail": "Conectividad"},
            {"value": ui_label((health_status or {}).get("database"), "status"), "label": "Base de datos", "detail": "Estado reportado"},
            {"value": overview.get("active_user_count", 0), "label": "Usuarios activos", "detail": f"{overview.get('user_count', 0)} registrados"},
            {"value": ui_label((health_status or {}).get("storage"), "status"), "label": "Almacenamiento", "detail": "MinIO privado"},
        ]
    return []


def call_api(
    app: Flask,
    method: str,
    path: str,
    *,
    authenticated: bool = True,
    json: dict[str, Any] | None = None,
    data: dict[str, str] | None = None,
    files: dict[str, Any] | None = None,
    timeout: int = 10,
) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if authenticated:
        access_token = session.get("access_token")
        if not access_token:
            raise ApiClientError(401, "authentication_required", "Debes iniciar sesión.")
        headers["Authorization"] = f"Bearer {access_token}"

    try:
        response = requests.request(
            method,
            urljoin(app.config["API_BASE_URL"], path.lstrip("/")),
            headers=headers,
            json=json,
            data=data,
            files=files,
            timeout=(3.05, timeout),
        )
    except requests.RequestException as error:
        app.logger.warning("No fue posible contactar la API: %s", error.__class__.__name__)
        raise ApiClientError(503, "api_unavailable", "El servicio no está disponible temporalmente.") from error

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.ok:
        return payload

    api_error = payload.get("error") if isinstance(payload, dict) else None
    code = api_error.get("code", "api_error") if isinstance(api_error, dict) else "api_error"
    message = (
        api_error.get("message", "El servicio rechazó la solicitud.")
        if isinstance(api_error, dict)
        else "El servicio rechazó la solicitud."
    )
    raise ApiClientError(response.status_code, code, message)


def call_api_response(
    app: Flask,
    method: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    timeout: int = 10,
) -> requests.Response:
    access_token = session.get("access_token")
    if not access_token:
        raise ApiClientError(401, "authentication_required", "Debes iniciar sesión.")
    try:
        response = requests.request(
            method,
            urljoin(app.config["API_BASE_URL"], path.lstrip("/")),
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=(3.05, timeout),
        )
    except requests.RequestException as error:
        app.logger.warning("No fue posible contactar la API: %s", error.__class__.__name__)
        raise ApiClientError(503, "api_unavailable", "El servicio no está disponible temporalmente.") from error
    if response.ok:
        return response
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    api_error = payload.get("error") if isinstance(payload, dict) else None
    code = api_error.get("code", "api_error") if isinstance(api_error, dict) else "api_error"
    message = (
        api_error.get("message", "El servicio rechazó la solicitud.")
        if isinstance(api_error, dict)
        else "El servicio rechazó la solicitud."
    )
    raise ApiClientError(response.status_code, code, message)


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
