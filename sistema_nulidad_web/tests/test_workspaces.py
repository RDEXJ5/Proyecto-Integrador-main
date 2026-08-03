import unittest
from unittest.mock import patch

from cachelib.simple import SimpleCache

from app import ApiClientError, create_app, format_file_size, repair_display_text, ui_label


class WorkspaceWebTest(unittest.TestCase):
    def setUp(self):
        self.app = create_app(
            {
                "TESTING": True,
                "WTF_CSRF_ENABLED": False,
                "SECRET_KEY": "test-secret-key-with-more-than-32-characters",
                "SESSION_TYPE": "cachelib",
                "SESSION_CACHELIB": SimpleCache(),
            }
        )
        self.client = self.app.test_client()

    def set_session(self, *roles, permissions=()):
        with self.client.session_transaction() as flask_session:
            flask_session["access_token"] = "test-token"
            flask_session["user"] = {
                "id": 1,
                "fullName": "Persona de prueba",
                "email": "persona@example.test",
                "roles": list(roles),
                "permissions": list(permissions),
            }

    def test_repairs_legacy_utf8_text_only_for_display(self):
        self.assertEqual(repair_display_text("ResoluciÃ³n judicial"), "Resolución judicial")
        self.assertEqual(repair_display_text("validaci�n y revisi�n"), "validación y revisión")
        self.assertEqual(repair_display_text("revisi??n e informaci??n"), "revisión e información")
        self.assertEqual(repair_display_text("firmada e �ntegra"), "firmada e íntegra")
        self.assertEqual(repair_display_text("Información válida"), "Información válida")
        self.assertEqual(ui_label("reachable", "status"), "Conectado")
        self.assertEqual(ui_label("30m", "duration"), "30 minutos")
        self.assertEqual(format_file_size(26214400), "25 MB")

    @patch("app.call_api")
    def test_judge_uses_shared_review_workspace(self, call_api_mock):
        call_api_mock.return_value = {"cases": []}
        self.set_session("judge")

        response = self.client.get("/dashboard", follow_redirects=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("Revisi\u00f3n y decisi\u00f3n".encode(), response.data)
        self.assertIn("Firmar".encode(), response.data)
        self.assertIn("Expedientes y revisi\u00f3n".encode(), response.data)
        self.assertNotIn("Decisiones y firmas".encode(), response.data)
        self.assertNotIn("Historial".encode(), response.data)

    @patch("app.call_api")
    def test_notary_gets_authorization_actions(self, call_api_mock):
        call_api_mock.return_value = {"cases": []}
        self.set_session("notary")

        response = self.client.get("/workspaces/review")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Autorizar".encode(), response.data)
        self.assertIn("Certificar".encode(), response.data)

    @patch("app.call_api")
    def test_lawyer_uses_contribution_workspace(self, call_api_mock):
        call_api_mock.return_value = {"cases": []}
        self.set_session("lawyer")

        response = self.client.get("/workspaces/contribution")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Subir documento".encode(), response.data)
        self.assertIn("Crear versi\u00f3n".encode(), response.data)

    @patch("app.call_api")
    def test_workspace_home_prioritizes_active_cases_and_adds_shortcuts(self, call_api_mock):
        call_api_mock.return_value = {"cases": [
            {
                "id": 8,
                "folio": "PAUS-008",
                "title": "Expediente pausado",
                "status": "paused",
                "legal_area_label": "Civil",
                "case_type_label": "Procedimiento civil",
                "pending_observation_count": 3,
            },
            {
                "id": 7,
                "folio": "ACT-007",
                "title": "Expediente activo",
                "status": "active",
                "legal_area_label": "Familiar",
                "case_type_label": "Procedimiento familiar",
                "pending_observation_count": 1,
            },
        ]}
        self.set_session("lawyer")

        response = self.client.get("/workspaces/contribution")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Accesos rápidos".encode(), response.data)
        self.assertIn("Flujo recomendado".upper().encode(), response.data)
        self.assertIn("1 observación pendiente".encode(), response.data)
        self.assertIn(b'href="/profile"', response.data)
        self.assertIn(b"<span>Mi perfil</span>", response.data)
        self.assertLess(response.data.index(b"ACT-007"), response.data.index(b"PAUS-008"))

    def test_profile_translates_permissions_and_explains_session_security(self):
        self.set_session(
            "lawyer",
            permissions=("case.read.assigned", "document.version.create"),
        )

        response = self.client.get("/profile")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Mi perfil".encode(), response.data)
        self.assertIn("Editar mis datos".encode(), response.data)
        self.assertIn("Algunos datos no pueden modificarse".encode(), response.data)
        self.assertIn(b"cristian05corona@gmail.com", response.data)
        self.assertIn("Carga y seguimiento".encode(), response.data)
        self.assertIn("Consultar expedientes permitidos por asignación".encode(), response.data)
        self.assertIn("Registrar versiones nuevas sin sobrescribir".encode(), response.data)
        self.assertIn(b"30 minutos", response.data)
        self.assertNotIn(b">case.read.assigned<", response.data)
        self.assertNotIn(b">document.version.create<", response.data)
        self.assertNotIn(b"Servidor configurado", response.data)
        self.assertNotIn(b"La API valida", response.data)

    def test_administrator_profile_uses_the_user_registry_instead_of_support(self):
        self.set_session(
            "admin",
            permissions=("workspace.administration.access", "user.manage"),
        )

        response = self.client.get("/profile")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Datos administrativos protegidos".encode(), response.data)
        self.assertIn("Abrir registro de usuarios".encode(), response.data)
        self.assertNotIn(b"cristian05corona@gmail.com", response.data)
        self.assertNotIn("contacta a soporte".encode(), response.data)

    @patch("app.call_api")
    def test_profile_updates_only_the_safe_display_name(self, call_api_mock):
        call_api_mock.return_value = {
            "changed": True,
            "user": {"fullName": "Nombre actualizado"},
        }
        self.set_session("lawyer", permissions=("case.read.assigned",))

        response = self.client.post(
            "/profile",
            data={
                "full_name": "Nombre actualizado",
                "email": "correo-no-permitido@example.test",
                "roles": "admin",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers["Location"].endswith("/profile"))
        with self.client.session_transaction() as flask_session:
            self.assertEqual(flask_session["user"]["fullName"], "Nombre actualizado")
        call_api_mock.assert_called_once_with(
            self.app,
            "PATCH",
            "auth/me",
            json={"fullName": "Nombre actualizado"},
        )

    def test_workspace_access_is_denied_for_unrelated_role(self):
        self.set_session("judge")

        response = self.client.get("/workspaces/administration")

        self.assertEqual(response.status_code, 403)

    @patch("app.call_api")
    def test_administration_hides_configuration_and_system_health(self, call_api_mock):
        call_api_mock.return_value = {
            "overview": {
                "user_count": 23,
                "active_user_count": 22,
                "role_count": 12,
                "active_document_type_count": 18,
            }
        }
        self.set_session("admin", permissions=("workspace.administration.access",))

        response = self.client.get("/workspaces/administration")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Usuarios registrados".encode(), response.data)
        self.assertIn("Roles disponibles".encode(), response.data)
        self.assertIn("Tipos documentales".encode(), response.data)
        self.assertNotIn(b"/workspaces/administration/configuration", response.data)
        self.assertNotIn(b"/workspaces/administration/health", response.data)
        self.assertNotIn("Salud del sistema".encode(), response.data)
        call_api_mock.assert_called_once_with(self.app, "GET", "administration/overview")

        self.assertEqual(self.client.get("/workspaces/administration/configuration").status_code, 404)
        self.assertEqual(self.client.get("/workspaces/administration/health").status_code, 404)

    def test_mobile_role_has_no_web_workspace(self):
        self.set_session("party")

        response = self.client.get("/dashboard")

        self.assertEqual(response.status_code, 403)

    @patch("app.call_api")
    def test_legacy_lawyer_route_redirects(self, call_api_mock):
        self.set_session("lawyer")

        response = self.client.get("/lawyer/dashboard")

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers["Location"].endswith("/workspaces/contribution"))

    @patch("app.call_api")
    def test_technical_admin_can_authenticate_for_web_workspace(self, call_api_mock):
        call_api_mock.side_effect = [
            ApiClientError(403, "channel_not_allowed", "Canal no autorizado."),
            {
                "accessToken": "admin-token",
                "user": {
                    "id": 9,
                    "fullName": "Administración TI",
                    "email": "admin@example.test",
                    "roles": [{"code": "admin", "channel": "technical"}],
                },
            },
        ]

        response = self.client.post(
            "/login",
            data={"email": "admin@example.test", "password": "2318"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers["Location"].endswith("/dashboard"))

    @patch("app.call_api")
    def test_contributor_gets_inline_viewer_without_download(self, call_api_mock):
        call_api_mock.side_effect = [
            {"document": {"id": 7, "case_id": 1, "title": "Prueba", "lifecycle_status": "active"}},
            {"versions": [{
                "document_id": 7,
                "document_version_id": 11,
                "version_number": 2,
                "title": "Prueba",
                "lifecycle_status": "active",
                "storage_provider": "minio",
                "storage_status": "available",
                "content_type": "application/pdf",
                "original_name": "prueba.pdf",
            }]},
            {"observations": []},
        ]
        self.set_session("lawyer", permissions=("document.content.read.web",))

        response = self.client.get("/documents/7")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"document-viewer.mjs", response.data)
        self.assertIn(b"Ver en esta", response.data)
        self.assertIn(b"Solo visualizaci", response.data)
        self.assertNotIn(b"data-download-url", response.data)
        self.assertNotIn(b"Descargar original", response.data)

    @patch("app.call_api")
    def test_authorized_reviewer_gets_download_inside_viewer(self, call_api_mock):
        call_api_mock.side_effect = [
            {"document": {"id": 7, "case_id": 1, "title": "Prueba", "lifecycle_status": "active"}},
            {"versions": [{
                "document_id": 7,
                "document_version_id": 11,
                "version_number": 2,
                "title": "Prueba",
                "lifecycle_status": "active",
                "storage_provider": "minio",
                "storage_status": "available",
                "content_type": "application/pdf",
                "original_name": "prueba.pdf",
            }]},
            {"observations": []},
        ]
        self.set_session(
            "judge",
            permissions=("document.content.read.web", "document.download.web"),
        )

        response = self.client.get("/documents/7")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"data-download-url", response.data)
        self.assertIn(b"Descargar original", response.data)

    @patch("app.call_api")
    def test_reviewer_can_create_and_resolve_observations(self, call_api_mock):
        call_api_mock.side_effect = [
            {"document": {"id": 7, "case_id": 1, "title": "Prueba", "lifecycle_status": "active"}},
            {"versions": [{
                "document_version_id": 11,
                "version_number": 2,
                "title": "Prueba",
                "lifecycle_status": "active",
            }]},
            {"observations": [{
                "id": 3,
                "version_number": 2,
                "author_name": "Juez de prueba",
                "observation_type": "clarification_required",
                "body": "Aclare el contenido de la segunda página.",
                "observation_status": "responded",
                "created_at": "2026-08-01",
                "responses": [{
                    "responder_name": "Abogado de prueba",
                    "body": "Se agregó la explicación solicitada.",
                    "created_at": "2026-08-01",
                    "referenced_version_number": None,
                }],
            }]},
        ]
        self.set_session(
            "judge",
            permissions=("document.observation.create", "document.observation.resolve"),
        )

        response = self.client.get("/documents/7")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Emitir observación sobre esta versión".encode(), response.data)
        self.assertIn("Resolver observación".encode(), response.data)
        self.assertNotIn("Responder observación".encode(), response.data)

    @patch("app.call_api")
    def test_contributor_can_respond_but_cannot_resolve(self, call_api_mock):
        call_api_mock.side_effect = [
            {"document": {"id": 7, "case_id": 1, "title": "Prueba", "lifecycle_status": "active"}},
            {"versions": [{
                "document_version_id": 11,
                "version_number": 2,
                "title": "Prueba",
                "lifecycle_status": "active",
            }]},
            {"observations": [{
                "id": 3,
                "version_number": 2,
                "author_name": "Juez de prueba",
                "observation_type": "correction_required",
                "body": "Corrija el dato señalado.",
                "observation_status": "open",
                "created_at": "2026-08-01",
                "responses": [],
            }]},
        ]
        self.set_session("lawyer", permissions=("document.observation.respond",))

        response = self.client.get("/documents/7")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Responder observación".encode(), response.data)
        self.assertNotIn("Resolver observación".encode(), response.data)
        self.assertNotIn("Emitir observación sobre esta versión".encode(), response.data)

    @patch("app.call_api")
    def test_contribution_observation_inbox_uses_api_results(self, call_api_mock):
        call_api_mock.return_value = {"observations": [{
            "id": 3,
            "document_id": 7,
            "document_title": "Escrito inicial",
            "case_folio": "EXP-001",
            "version_number": 2,
            "observation_type": "legal_review",
            "body": "Verificar fundamento jurídico.",
            "observation_status": "open",
            "response_count": 0,
        }]}
        self.set_session("lawyer")

        response = self.client.get("/workspaces/contribution/observations")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Escrito inicial".encode(), response.data)
        self.assertIn("Abrir seguimiento".encode(), response.data)

    @patch("app.call_api")
    def test_judge_case_shows_documents_and_involved_people(self, call_api_mock):
        call_api_mock.side_effect = [
            {"case": {
                "id": 2,
                "folio": "DEMO-PEN-2026-0002",
                "title": "Expediente penal",
                "description": "Caso de prueba",
                "status": "active",
                "legal_area_label": "Penal",
                "case_type_label": "Procedimiento penal",
                "current_stage_code": "review",
                "organizational_unit_name": "Unidad de prueba",
            }},
            {"documents": [{
                "id": 20,
                "document_type_code": "evidence",
                "title": "Informe pericial",
                "description": "Documento del expediente penal",
                "contains_sensitive_data": True,
                "lifecycle_status": "active",
            }]},
            {"people": {
                "professionals": [{
                    "full_name": "Juez de prueba",
                    "assignment_type_label": "Juez asignado",
                    "assignment_scope": "review",
                }],
                "participants": [{
                    "full_name": "Parte de prueba",
                    "participant_role_label": "Víctima",
                }],
            }},
        ]
        self.set_session("judge", permissions=("case.people.read",))

        response = self.client.get("/cases/2")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Personas involucradas".encode(), response.data)
        self.assertIn("Juez de prueba".encode(), response.data)
        self.assertIn("Parte de prueba".encode(), response.data)
        self.assertIn("Informe pericial".encode(), response.data)

    @patch("app.call_api")
    def test_contributor_case_does_not_request_people_without_permission(self, call_api_mock):
        call_api_mock.side_effect = [
            {"case": {
                "id": 1,
                "folio": "EXP-001",
                "title": "Expediente asignado",
                "status": "active",
                "legal_area_label": "Familiar",
                "case_type_label": "Procedimiento familiar",
                "organizational_unit_name": "Unidad de prueba",
            }},
            {"documents": []},
        ]
        self.set_session("lawyer", permissions=("document.read.assigned",))

        response = self.client.get("/cases/1")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Personas involucradas".encode(), response.data)
        self.assertEqual(call_api_mock.call_count, 2)

    @patch("app.call_api")
    def test_judge_sees_real_review_signature_and_decision_controls(self, call_api_mock):
        call_api_mock.side_effect = [
            {"document": {"id": 7, "case_id": 1, "title": "Sentencia", "lifecycle_status": "active"}},
            {"versions": [{
                "document_version_id": 11,
                "version_number": 1,
                "title": "Sentencia",
                "lifecycle_status": "active",
                "review_status": "pending",
                "requires_notarial_authorization": False,
                "requires_certification": False,
                "requires_judicial_signature": True,
                "allows_platform_signature": True,
                "signature_status": "pending",
                "open_observation_count": 0,
            }]},
            {"observations": []},
            {"actions": [], "signatures": []},
        ]
        self.set_session(
            "judge",
            permissions=("document.review", "document.sign", "decision.issue"),
        )

        response = self.client.get("/documents/7")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Registrar revisión".encode(), response.data)
        self.assertIn("Firmar integridad".encode(), response.data)
        self.assertNotIn("Autorizar versión".encode(), response.data)

    @patch("app.call_api")
    def test_notary_only_sees_actions_required_by_document_policy(self, call_api_mock):
        call_api_mock.side_effect = [
            {"document": {"id": 7, "case_id": 1, "title": "Acta", "lifecycle_status": "active"}},
            {"versions": [{
                "document_version_id": 11,
                "version_number": 1,
                "title": "Acta",
                "lifecycle_status": "active",
                "review_status": "approved",
                "requires_notarial_authorization": True,
                "authorization_status": "pending",
                "requires_certification": False,
                "requires_judicial_signature": False,
                "signature_status": "not_required",
                "open_observation_count": 0,
            }]},
            {"observations": []},
            {"actions": [], "signatures": []},
        ]
        self.set_session("notary", permissions=("document.review", "document.authorize", "document.certify"))

        response = self.client.get("/documents/7")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Autorizar versión".encode(), response.data)
        self.assertNotIn("Certificar versión".encode(), response.data)

    @patch("app.call_api")
    def test_action_form_forwards_only_permission_scoped_payload(self, call_api_mock):
        call_api_mock.return_value = {"action": {"id": 5}}
        self.set_session("judge", permissions=("document.review",))

        response = self.client.post(
            "/documents/7/versions/11/actions",
            data={"action_code": "review", "outcome": "approved", "note": "Contenido revisado."},
        )

        self.assertEqual(response.status_code, 302)
        call_api_mock.assert_called_once_with(
            self.app,
            "POST",
            "documents/7/versions/11/actions",
            json={"actionCode": "review", "outcome": "approved", "note": "Contenido revisado."},
        )

    @patch("app.call_api")
    def test_process_cases_section_renders_real_creation_form(self, call_api_mock):
        call_api_mock.side_effect = [
            {"cases": []},
            {"catalogs": {
                "caseTypes": [{"code": "civil_proceeding", "label": "Civil", "legal_area_label": "Civil"}],
                "units": [{"id": 1, "name": "Juzgado de prueba"}],
                "assignmentTypes": [],
                "users": [],
            }},
        ]
        self.set_session("secretary", permissions=("case.create",))

        response = self.client.get("/workspaces/process/cases")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Crear expediente".encode(), response.data)
        self.assertIn("+ Nuevo expediente".encode(), response.data)
        self.assertIn(b'class="creation-disclosure"', response.data)
        self.assertIn(b"civil_proceeding", response.data)

    @patch("app.call_api")
    def test_case_filters_adapt_to_process_workspace(self, call_api_mock):
        call_api_mock.side_effect = [
            {"cases": [{
                "id": 4,
                "folio": "PROC-004",
                "title": "Expediente de prueba",
                "status": "active",
                "legal_area_label": "Civil",
                "case_type_label": "Procedimiento civil",
                "current_stage_code": "review",
                "pending_observation_count": 0,
            }]},
            {"catalogs": {"caseTypes": [], "units": [], "assignmentTypes": [], "users": []}},
        ]
        self.set_session("secretary")

        response = self.client.get("/workspaces/process/cases")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-filter-key="stage"', response.data)
        self.assertNotIn(b'data-filter-key="attention"', response.data)
        self.assertIn(b'data-filter-item', response.data)

    @patch("app.call_api")
    def test_case_filters_adapt_to_review_workspace(self, call_api_mock):
        call_api_mock.return_value = {"cases": [{
            "id": 5,
            "folio": "REV-005",
            "title": "Expediente para revisar",
            "status": "active",
            "legal_area_label": "Penal",
            "case_type_label": "Procedimiento penal",
            "pending_observation_count": 2,
        }]}
        self.set_session("judge")

        response = self.client.get("/workspaces/review/queue")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-filter-key="attention"', response.data)
        self.assertNotIn(b'data-filter-key="assignment"', response.data)

    @patch("app.call_api")
    def test_document_list_has_type_status_and_sensitivity_filters(self, call_api_mock):
        call_api_mock.side_effect = [
            {"case": {"id": 6, "folio": "EXP-006", "title": "Expediente", "status": "active"}},
            {"documents": [{
                "id": 9,
                "document_type_code": "evidence",
                "title": "Prueba documental",
                "description": "Documento sensible",
                "lifecycle_status": "active",
                "contains_sensitive_data": True,
            }]},
        ]
        self.set_session("lawyer")

        response = self.client.get("/cases/6")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-filter-key="type"', response.data)
        self.assertIn(b'data-filter-key="status"', response.data)
        self.assertIn(b'data-filter-key="sensitivity"', response.data)
        self.assertIn(b'data-filter-sensitivity="sensitive"', response.data)

    def test_login_has_context_and_security_information(self):
        response = self.client.get("/login")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Todo el expediente".encode(), response.data)
        self.assertIn("Versiones inmutables".encode(), response.data)
        self.assertIn("Conservaci\u00f3n permanente".encode(), response.data)
        self.assertIn(b'/static/logo.png', response.data)
        self.assertIn("Logotipo del Sistema Integral de Gestión Documental".encode(), response.data)
        self.assertIn("SISTEMA INTEGRAL DE".encode(), response.data)
        self.assertIn("GESTIÓN DOCUMENTAL".encode(), response.data)
        self.assertNotIn("Expediente Íntegro".encode(), response.data)
        self.assertIn(b'/static/filters.js', response.data)

    def test_duplicate_workspace_sections_redirect_to_canonical_view(self):
        aliases = (
            ("judge", "/workspaces/review/cases", "/workspaces/review/queue"),
            ("judge", "/workspaces/review/decisions", "/workspaces/review/queue"),
            ("secretary", "/workspaces/process/assignments", "/workspaces/process/cases"),
            ("secretary", "/workspaces/process/stages", "/workspaces/process/cases"),
            ("lawyer", "/workspaces/contribution/documents", "/workspaces/contribution/cases"),
        )
        for role, source, destination in aliases:
            with self.subTest(source=source):
                self.set_session(role)
                response = self.client.get(source)
                self.assertEqual(response.status_code, 302)
                self.assertTrue(response.headers["Location"].endswith(destination))

    @patch("app.call_api")
    def test_document_creation_form_is_opened_from_button(self, call_api_mock):
        call_api_mock.side_effect = [
            {"case": {"id": 1, "folio": "EXP-001", "title": "Expediente", "status": "active"}},
            {"documents": []},
            {"documentTypes": [{"code": "evidence", "label": "Prueba"}]},
        ]
        self.set_session("lawyer", permissions=("document.upload",))

        response = self.client.get("/cases/1")

        self.assertEqual(response.status_code, 200)
        self.assertIn("+ Agregar documento".encode(), response.data)
        self.assertIn(b'class="creation-disclosure"', response.data)
        self.assertIn(b'accept=".pdf,.jpg,.jpeg,.png"', response.data)
        self.assertNotIn(b".docx", response.data)

    @patch("app.call_api")
    def test_process_case_detail_renders_assignments_stages_and_deadlines(self, call_api_mock):
        call_api_mock.side_effect = [
            {"case": {"id": 2, "folio": "PROC-002", "title": "Caso procesal", "status": "active", "legal_area_label": "Civil", "case_type_label": "Civil", "organizational_unit_name": "Juzgado", "current_stage_code": "intake"}},
            {"documents": []},
            {"process": {"assignments": [], "participants": [], "stages": [{"stage_code": "review", "label": "Revisión", "sequence_number": 2}], "stageHistory": [], "deadlines": []}},
            {"catalogs": {
                "assignmentCandidates": [{
                    "user_id": 8,
                    "full_name": "Juez disponible",
                    "assignment_type_code": "judge",
                    "assignment_type_label": "Juez asignado",
                }],
                "participantCandidates": [{
                    "user_id": 15,
                    "full_name": "Testigo disponible",
                    "participant_role_code": "witness",
                    "participant_role_label": "Testigo",
                }],
            }},
        ]
        self.set_session(
            "secretary",
            permissions=("case.assign", "case.participant.manage", "case.stage.manage", "case.deadline.manage"),
        )

        response = self.client.get("/cases/2")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Gestión procesal".encode(), response.data)
        self.assertIn("Agregar responsable".encode(), response.data)
        self.assertIn("Invitar participante".encode(), response.data)
        self.assertIn("Crear plazo".encode(), response.data)
        self.assertIn(b'name="assignment_candidate"', response.data)
        self.assertIn(b'value="8:judge"', response.data)
        self.assertIn(b'name="participant_candidate"', response.data)
        self.assertIn(b'value="15:witness"', response.data)

    @patch("app.call_api")
    def test_process_assignment_uses_a_compatible_candidate_pair(self, call_api_mock):
        call_api_mock.return_value = {"assignment": {"id": 9}}
        self.set_session("coordinator", permissions=("case.assign",))

        response = self.client.post(
            "/process/cases/2/assignments",
            data={
                "assignment_candidate": "8:judge",
                "assignment_scope": "review",
                "reason": "Responsable designado para la revisión del expediente.",
            },
        )

        self.assertEqual(response.status_code, 302)
        call_api_mock.assert_called_once_with(
            self.app,
            "POST",
            "process/cases/2/assignments",
            json={
                "userId": "8",
                "assignmentTypeCode": "judge",
                "assignmentScope": "review",
                "reason": "Responsable designado para la revisión del expediente.",
            },
        )

    @patch("app.call_api")
    def test_process_invitation_uses_a_compatible_candidate_pair(self, call_api_mock):
        call_api_mock.return_value = {"invitation": {"id": 10}}
        self.set_session("secretary", permissions=("case.participant.manage",))

        response = self.client.post(
            "/process/cases/2/invitations",
            data={
                "participant_candidate": "15:witness",
                "reason": "Comparecencia solicitada como testigo del expediente.",
            },
        )

        self.assertEqual(response.status_code, 302)
        call_api_mock.assert_called_once_with(
            self.app,
            "POST",
            "process/cases/2/invitations",
            json={
                "userId": "15",
                "participantRoleCode": "witness",
                "reason": "Comparecencia solicitada como testigo del expediente.",
            },
        )

    @patch("app.call_api")
    def test_process_invites_participant_without_granting_direct_access(self, call_api_mock):
        call_api_mock.return_value = {"invitation": {"id": 7, "invitationStatus": "pending"}}
        self.set_session("secretary", permissions=("case.participant.manage",))

        response = self.client.post(
            "/process/cases/2/invitations",
            data={
                "user_id": "15",
                "participant_role_code": "witness",
                "reason": "Comparecencia como testigo del expediente.",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers["Location"].endswith("/cases/2#process-management"))
        call_api_mock.assert_called_once_with(
            self.app,
            "POST",
            "process/cases/2/invitations",
            json={
                "userId": "15",
                "participantRoleCode": "witness",
                "reason": "Comparecencia como testigo del expediente.",
            },
        )

    @patch("app.call_api")
    def test_audit_events_section_uses_read_only_api_data(self, call_api_mock):
        call_api_mock.return_value = {"events": [{
            "id": 1,
            "created_at": "2026-08-01",
            "actor_name": "Juez QA",
            "actor_email": "juez@example.test",
            "action_code": "case.decision_issued",
            "resource_type": "case_decision",
            "resource_id": "1",
            "client_channel": "web",
            "ip_address": "127.0.0.1",
        }]}
        self.set_session("auditor", permissions=("audit.read",))

        response = self.client.get("/workspaces/audit/events")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Decisión procesal emitida".encode(), response.data)
        self.assertIn("Decisión procesal número 1".encode(), response.data)
        self.assertIn("Sitio web".encode(), response.data)
        self.assertNotIn(b">case.decision_issued<", response.data)
        self.assertIn("Solo lectura".encode(), response.data)

    @patch("app.call_api")
    def test_role_permissions_use_clear_spanish_descriptions(self, call_api_mock):
        call_api_mock.return_value = {
            "roles": [{
                "code": "lawyer",
                "label": "Abogado",
                "channel": "web",
                "description": "Aporta documentos de sus expedientes asignados.",
            }],
            "permissions": [{
                "role_code": "lawyer",
                "permission_code": "case.read.assigned",
                "description": "Consultar los expedientes permitidos por asignación.",
            }],
        }
        self.set_session("admin", permissions=("role.manage",))

        response = self.client.get("/workspaces/administration/roles")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Funciones permitidas".encode(), response.data)
        self.assertIn("Consultar los expedientes permitidos por asignación.".encode(), response.data)
        self.assertIn("Sitio web".encode(), response.data)
        self.assertNotIn(b">case.read.assigned<", response.data)
        self.assertNotIn(b">lawyer<", response.data)

    @patch("app.call_api")
    def test_document_catalog_translates_policy_codes(self, call_api_mock):
        call_api_mock.return_value = {"catalogs": {"documentTypes": [{
            "code": "signed_resolution",
            "label": "Resolución firmada",
            "description": "Resolución que requiere firma.",
            "embedded_signature_policy": "optional",
            "platform_signature_policy": "required",
            "requires_authorization": True,
            "requires_certification": False,
        }]}}
        self.set_session("admin", permissions=("catalog.manage",))

        response = self.client.get("/workspaces/administration/catalogs")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Resolución firmada".encode(), response.data)
        self.assertIn("Opcional".encode(), response.data)
        self.assertIn("Obligatoria".encode(), response.data)
        self.assertNotIn(b">required<", response.data)

    @patch("app.call_api")
    def test_administration_users_section_has_logical_status_controls(self, call_api_mock):
        call_api_mock.side_effect = [
            {"users": [{"id": 3, "full_name": "Usuario QA", "email": "qa@example.test", "account_status": "active", "roles": ["lawyer"]}]},
            {"roles": [{"code": "lawyer", "label": "Abogado"}, {"code": "judge", "label": "Juez"}]},
        ]
        self.set_session("admin", permissions=("user.manage", "role.manage"))

        response = self.client.get("/workspaces/administration/users")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Crear usuario".encode(), response.data)
        self.assertIn("+ Nuevo usuario".encode(), response.data)
        self.assertIn("Ver perfil detallado".encode(), response.data)
        self.assertIn("Cambiar estado".encode(), response.data)
        self.assertIn("Conceder rol".encode(), response.data)

    @patch("app.call_api")
    def test_administration_can_open_a_detailed_user_profile(self, call_api_mock):
        call_api_mock.return_value = {
            "user": {
                "id": 9,
                "full_name": "Usuario detallado",
                "email": "detalle@example.test",
                "account_status": "active",
                "created_at": "2026-08-03",
                "updated_at": "2026-08-03",
            },
            "activeRoles": [{
                "code": "secretary",
                "label": "Secretario",
                "channel": "web",
                "description": "Opera expedientes.",
                "grant_reason": "Asignación funcional.",
                "granted_at": "2026-08-03",
                "granted_by_name": "Administración",
            }],
            "permissions": [{"code": "case.create", "description": "Crear expedientes."}],
            "roleHistory": [],
            "statusHistory": [],
            "unitMemberships": [],
        }
        self.set_session("admin", permissions=("user.manage",))

        response = self.client.get("/workspaces/administration/users/9")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Usuario detallado".encode(), response.data)
        self.assertIn("Roles activos".encode(), response.data)
        self.assertIn("Crear expedientes.".encode(), response.data)
        self.assertIn("Vista técnica de identidad".encode(), response.data)
        self.assertNotIn("Membresías organizativas".encode(), response.data)
        self.assertNotIn("Sin unidad asignada".encode(), response.data)
        self.assertNotIn("contacta a soporte".encode(), response.data)
        call_api_mock.assert_called_once_with(self.app, "GET", "administration/users/9")

    @patch("app.call_api")
    def test_administration_password_change_forwards_no_unrelated_fields(self, call_api_mock):
        call_api_mock.return_value = {"user": {"id": 9, "passwordUpdated": True}}
        self.set_session("admin", permissions=("user.manage",))

        response = self.client.post(
            "/administration/users/9/password",
            data={
                "password": "NuevaClaveSegura123",
                "reason": "Restablecimiento solicitado por la persona titular.",
                "roles": "admin",
            },
        )

        self.assertEqual(response.status_code, 302)
        call_api_mock.assert_called_once_with(
            self.app,
            "POST",
            "administration/users/9/password",
            json={
                "password": "NuevaClaveSegura123",
                "reason": "Restablecimiento solicitado por la persona titular.",
            },
        )


if __name__ == "__main__":
    unittest.main()
