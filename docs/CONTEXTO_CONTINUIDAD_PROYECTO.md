# Contexto de continuidad: Expediente Íntegro

> Este documento está preparado para entregarse a otro chat de Codex. Su propósito es evitar que se reconstruyan componentes que ya existen o que se retomen carpetas descartadas.

## Instrucción principal para el siguiente chat

Continúa el proyecto **Expediente Íntegro** desde el estado descrito aquí. Antes de modificar algo, inspecciona los archivos actuales y el estado de Docker. No reinicies la arquitectura, no recrees la base de datos, no elimines volúmenes y no sustituyas componentes que ya funcionan. Conserva los cambios existentes del usuario y evita trabajar sobre las carpetas heredadas equivocadas.

## Ubicación y componentes canónicos

El proyecto activo utilizado por Docker está en:

```text
C:\Users\britz\OneDrive\Documentos\GitHub\Proyecto
```

La copia que puede aparecer como espacio de trabajo de Codex está en:

```text
C:\Users\britz\Downloads\Proyecto-Integrador-main\Proyecto-Integrador-main
```

Los componentes canónicos son:

```text
sistema_nulidad_api/   API web y API móvil Node.js; archivo docker-compose.yml
sistema_nulidad_bd/    Esquema, migraciones, verificaciones y datos de prueba
sistema_nulidad_web/   Aplicación web Flask
mobile/                Aplicación Expo 54 para partes y testigos
docs/                  Guías y documentación
```

Las carpetas antiguas `API/`, `frontend/` y `mysql/` son restos de una implementación anterior. No deben tomarse como backend o web principal salvo que el usuario lo solicite expresamente. Los nombres `sistema_nulidad_*` y la base `juzgado_nulidad_documental` son nombres heredados; el sistema actual ya es general y no debe limitarse a nulidad matrimonial.

El árbol de trabajo contiene cambios previos y archivos sin seguimiento que pertenecen al usuario. No usar `git reset --hard`, no limpiar archivos y no sobrescribir cambios ajenos.

## Objetivo real del sistema

Es una plataforma general de gestión procesal y documental jurídica para asuntos familiares, penales, civiles, mercantiles, laborales, administrativos, constitucionales y tipos configurables.

Principios obligatorios:

- Ningún expediente, usuario, documento, versión, asignación, decisión ni evento se elimina físicamente.
- Las bajas, cierres, revocaciones, cancelaciones y ocultamientos son lógicos y conservan actor, fecha y motivo.
- Un archivo nunca se sobrescribe; cualquier corrección crea una versión nueva.
- La trazabilidad debe conservar accesos, cambios, revisiones, observaciones, autorizaciones, firmas y decisiones.
- Los datos personales son sensibles: INE, CURP, RFC, actas, comprobantes y documentos de testigos.
- El tipo documental determina si se analiza una firma y si requiere autorización, certificación o firma de plataforma. Esto evita exigir firma a documentos que no la necesitan.
- La web solo carga archivos existentes. La captura con cámara pertenece exclusivamente a la aplicación móvil.
- Los documentos se visualizan dentro de la web con PDF.js. La existencia de un visor no sustituye la autorización de la API.

## Arquitectura implementada

```text
Navegador
   -> Flask con sesión de servidor y CSRF
   -> API web Node.js (puerto 3000)
Aplicación Expo
   -> API móvil Node.js (puerto 3001)
Ambas APIs
   -> JWT, RBAC y autorización por recurso
   -> MySQL para metadatos, reglas y trazabilidad
   -> MinIO privado para archivos cifrados y versionados
```

La API móvil se implementa como un proceso separado, pero reutiliza los mismos
servicios de autenticación, versionamiento, políticas y almacenamiento. Sólo
expone expedientes participantes, documentos propios, cargas desde archivo o
cámara, versiones y respuestas a observaciones. No expone descargas, firmas,
autorizaciones, decisiones ni administración. La migración más reciente es
`012_mobile_api_channel.sql`.

Tecnologías principales:

- Node.js 20 o superior, Express 5, JWT, bcrypt, Helmet, CORS y rate limiting.
- Flask 3.1, Flask-Session, Flask-WTF, Gunicorn y Requests.
- MySQL 8.4.11.
- MinIO con versionado y retención predeterminada en modo de cumplimiento durante 10 años.
- PDF.js 5.7.284 empaquetado localmente, sin CDN en ejecución.
- Docker Compose como entorno de integración.

MySQL no está publicado al anfitrión. API, web y consolas están enlazadas únicamente a `127.0.0.1`.

## Espacios de trabajo y permisos funcionales

| Espacio | Perfiles | Funciones ya implementadas |
|---|---|---|
| Carga y seguimiento | Abogado, fiscal, defensor y perito | Casos asignados, carga de archivos, creación de versiones, consulta en visor y respuesta a observaciones. No tienen descarga explícita. |
| Revisión y decisión | Juez y notario | Casos asignados, personas involucradas, documentos, revisión y observaciones. El juez emite decisiones y firmas; el notario autoriza y certifica. Ambos pueden descargar cuando el permiso y la política lo permiten. |
| Gestión procesal | Secretario y coordinador | Crear expedientes, asignar responsables, registrar o finalizar participantes, cambiar etapas, crear/cerrar plazos y modificar estados lógicos. |
| Auditoría | Auditor | Eventos, accesos, versiones, firmas y reporte CSV en modo de solo lectura. |
| Administración técnica | Administrador TI | Usuarios, estados lógicos, concesión/revocación de roles, catálogos documentales, configuración y salud. No tiene acceso jurídico implícito. |
| Consulta personal móvil | Parte y testigo | Deben usar el canal móvil y acceder únicamente a su información y documentos propios. La integración móvil completa sigue pendiente. |

Rutas web principales:

```text
http://127.0.0.1:5000/login
/workspaces/contribution
/workspaces/review
/workspaces/process
/workspaces/audit
/workspaces/administration
/cases/<id>
/documents/<id>
```

Las secciones repetidas se consolidaron. Por ejemplo, revisión usa `Expedientes y revisión`, y gestión procesal usa una sola vista principal de expedientes. Las rutas antiguas redirigen a la vista canónica. Los formularios de creación o alta permanecen ocultos hasta presionar su botón. Las listas tienen filtros adaptados al rol y al contenido.

## Funcionalidad existente que no debe rehacerse

### API y acceso

- Inicio de sesión y consulta de sesión.
- JWT firmado con expiración y canal validado (`web` o `mobile`).
- API key independiente solo para `/system/*`.
- RBAC basado en concesiones activas.
- Protección BOLA/IDOR: cada expediente, documento y versión se autoriza en el servidor.
- SQL parametrizado, CORS permitido por lista, Helmet y límite de intentos de inicio de sesión.
- Separación entre administrador técnico y operación jurídica.

### Expedientes y proceso

- Listado por asignación, con prioridad visual de asuntos activos.
- Consulta de expediente, responsables y participantes.
- Creación de expedientes generalizados.
- Asignaciones y finalización lógica de asignaciones.
- Participantes y finalización lógica de participaciones.
- Historial de etapas, plazos y cambios de estado.
- Decisiones procesales inmutables; una corrección debe crear otra decisión que sustituya a la anterior.

### Documentos

- Carga web de PDF, JPG, PNG y DOCX existentes.
- Validación del tipo real y límites de tamaño.
- Cifrado antes de guardar en MinIO y comprobación SHA-256 al leer.
- Registro de origen: `web_file`, `mobile_file`, `mobile_camera` o migración histórica.
- Primera versión y versiones posteriores sin sobrescritura.
- Visor PDF.js integrado en la misma vista.
- Vista previa para perfiles con `document.content.read.web`.
- Descarga solamente para perfiles con `document.download.web`, actualmente juez y notario.
- Cada visualización y descarga produce auditoría.
- Observaciones, respuestas y resolución auditable.
- Revisión, autorización, certificación y firma condicionadas por la política capturada para la versión.

### Administración y auditoría

- Usuarios con suspensión, activación o archivo lógico.
- Roles revocables sin borrar el historial.
- Catálogo de tipos documentales y primera regla de flujo.
- Salud de API, base y almacenamiento.
- Eventos de auditoría traducidos y reporte CSV.

## Política documental

Las tablas `document_type_rules` y `document_version_policies` ya modelan:

- firma incorporada: no aplica, opcional, obligatoria o condicional;
- firma de plataforma: no aplica, opcional, obligatoria o condicional;
- roles autorizados para firmar;
- mínimo de firmas;
- autorización y rol autorizador;
- certificación y rol certificador;
- análisis automático: omitir, bajo solicitud o automático;
- prioridad y vigencia de la regla;
- instantánea inmutable de la política usada por cada versión.

No se debe ejecutar un analizador de firma de manera indiscriminada. Primero se consulta el tipo y la política de la versión.

## Modelo de datos importante

- Clasificación: `legal_areas`, `case_types`, `organizational_units`.
- Expedientes: `cases`, `case_profiles`, historiales y estados lógicos.
- Acceso: `case_assignments`, `case_participant_roles`, `user_unit_memberships`.
- Proceso: `case_stage_definitions`, `case_stage_transitions`, `case_deadlines`, `case_decisions`.
- Seguridad: `roles`, `permissions`, `user_role_grants`, `role_permission_grants`.
- Documentos: `document_types`, `documents`, `document_versions`.
- Políticas: `document_type_rules`, `document_version_policies`, `document_version_metadata`.
- Almacenamiento: `storage_objects` y binarios históricos heredados.
- Flujo: `document_actions`, `document_signature_records`, observaciones y respuestas.
- Análisis futuro: `document_analysis_jobs`, `document_analysis_results`.
- Auditoría: `audit_events`.

Los triggers impiden operaciones físicas destructivas y cambios sobre hechos inmutables. Si una actualización falla con un mensaje de inmutabilidad, no se debe desactivar el trigger; debe crearse una nueva versión, decisión o registro de estado.

## Migraciones ya aplicadas

El esquema actual incluye `schema.sql` y migraciones hasta:

```text
001_refresh_workflow_view.sql
002_generalizacion_plataforma.sql
003_contribution_inline_preview.sql
004_document_observation_workflow.sql
005_case_centric_access.sql
006_review_decision_workflow.sql
007_process_management.sql
008_utf8mb4_demo_repair.sql
009_spanish_demo_copy.sql
010_spanish_catalog_copy.sql
011_spanish_legal_catalogs.sql
```

La siguiente migración debe numerarse `012_...sql`.

Los scripts en `/docker-entrypoint-initdb.d` solo se ejecutan al crear un volumen nuevo. En una base existente, aplicar una migración sin borrar el volumen mediante copia binaria al contenedor:

```powershell
docker compose cp "..\sistema_nulidad_bd\migrations\012_ejemplo.sql" db:/tmp/012_ejemplo.sql
docker compose exec -T db sh -c "mysql -uroot -p2318 --default-character-set=utf8mb4 < /tmp/012_ejemplo.sql"
```

No canalizar SQL con `Get-Content | docker compose exec`, porque PowerShell dañó acentos en una prueba anterior. No ejecutar `docker compose down -v` salvo autorización explícita: destruye la base y los archivos del entorno.

## Redacción e idioma

Toda la interfaz visible debe estar en español. Los códigos internos como `case.read.assigned`, `web_file`, `required` o `reachable` no deben aparecer al usuario.

Ya se implementó:

- `UI_LABELS`, `STATUS_LABELS` y `ui_label()` en `sistema_nulidad_web/app.py`;
- reparación visual de texto UTF-8 histórico con `repair_display_text()` sin alterar filas inmutables;
- nombres comprensibles para permisos, estados, canales, políticas, tipos, etapas, recursos y acciones;
- correcciones de catálogos UTF-8 en las migraciones 008 a 011;
- tamaños y duraciones comprensibles, por ejemplo `25 MB` y `30 minutos`;
- plurales correctos como `1 versión`.

MinIO, API, PDF, SHA-256, CURP, RFC, PDF.js y otros nombres técnicos inevitables pueden conservarse, pero deben estar acompañados de una explicación en español.

## Seguridad que debe conservarse

- El JWT de usuario permanece en la sesión del servidor Flask, nunca en `localStorage`.
- Formularios protegidos con CSRF.
- Cookies `HttpOnly` y `SameSite=Lax`; en producción deben ser `Secure`.
- Cabeceras CSP, no-sniff, no-referrer, denegación de cámara/micrófono/geolocalización en web.
- Contenedores de API y web con sistema de archivos de solo lectura, `tmpfs`, capacidades eliminadas y `no-new-privileges`.
- MySQL dentro de la red privada.
- MinIO privado; el navegador no recibe claves ni URL directa del objeto.
- Cifrado documental, SHA-256, versionado y retención.
- Las claves JWT, API, firma de plataforma, MinIO y cifrado son secretos distintos y no se deben imprimir ni confirmar en un chat.
- Los archivos `.env` y `.env.storage` ya existen en el proyecto activo y no deben versionarse ni reemplazarse sin necesidad.
- La contraseña `2318` es únicamente la convención actual de desarrollo para cuentas funcionales y MySQL. No debe sustituir secretos criptográficos ni utilizarse en producción.

## Credenciales funcionales de desarrollo

Todas estas cuentas están activas. La contraseña de desarrollo general es `2318`, salvo la cuenta de Cristian indicada en la tabla.

| Perfil | Correo | Canal |
|---|---|---|
| Administración TI | `admin.web@example.test` | Web |
| Administración TI (Cristian Erasto Corona Uribe) | `cristian05corona@gmail.com` — contraseña `27098644` | Web técnica y móvil como parte interesada |
| Notario | `web.notario.20260731@example.test` | Web |
| Juez | `web.juez.20260731@example.test` | Web |
| Abogado | `web.abogado.20260731@example.test` | Web |
| Fiscal | `web.fiscal.20260731@example.test` | Web |
| Defensor | `web.defensor.20260731@example.test` | Web |
| Perito | `web.perito.20260731@example.test` | Web |
| Secretario | `web.secretario.20260731@example.test` | Web |
| Coordinador | `web.coordinador.20260731@example.test` | Web |
| Auditor | `web.auditor.20260731@example.test` | Web |
| Parte | `mobile.parte.20260731@example.test` | Móvil |
| Testigo | `mobile.testigo.20260731@example.test` | Móvil |

Parte y testigo no deben acceder a los espacios web. Que el servidor rechace ese acceso es el comportamiento correcto.

La identidad de Cristian conserva dos roles separados por canal: recibe únicamente Administración TI al iniciar sesión en la web técnica y únicamente Parte interesada al ingresar en la aplicación móvil. Los permisos de ambos canales no se mezclan.

## Datos de demostración existentes

- `QA-NUL-2026-0001`: familiar, nulidad matrimonial, activo y con documentos/versiones para probar el flujo completo.
- `DEMO-PEN-2026-0002`: penal, activo, asignado para revisión y aportaciones.
- `QA-GEN-2026-0001`: civil, activo, usado para validación web general.
- `DEMO-CIV-2026-0003`: civil y pausado, útil para comprobar prioridad de casos activos.

Los perfiles solo deben ver estos casos si cuentan con asignación, participación o alcance de unidad autorizado.

## Docker y ejecución

Directorio de ejecución:

```powershell
cd C:\Users\britz\OneDrive\Documentos\GitHub\Proyecto\sistema_nulidad_api
docker compose up --build -d
docker compose ps
```

Direcciones locales:

```text
Web:           http://127.0.0.1:5000
API:           http://127.0.0.1:3000
Swagger:       http://127.0.0.1:3000/docs
OpenAPI JSON:  http://127.0.0.1:3000/openapi.json
MinIO API:     http://127.0.0.1:9000
MinIO consola: http://127.0.0.1:9001
```

Estado confirmado el 2 de agosto de 2026:

- API: activa y saludable.
- MySQL: activo y saludable.
- MinIO: activo y saludable.
- Web Flask: activa en el puerto 5000.

Para detener sin borrar:

```powershell
docker compose down
```

Para revisar errores:

```powershell
docker compose ps
docker compose logs --tail 100 api web db minio
```

## Pruebas confirmadas

Última verificación:

- 30 pruebas de la web superadas.
- 12 pruebas de autorización y flujo de la API superadas.
- Catálogos revisados sin texto UTF-8 dañado.
- Auditoría visual en navegador de roles, catálogos, configuración, salud, expediente del juez y detalle documental.

Los Dockerfile de producción no copian las carpetas de pruebas. Por eso `docker compose exec api npm test` puede informar cero pruebas. Para ejecutar las suites reales con las imágenes ya construidas:

```powershell
docker run --rm `
  -v "C:\Users\britz\OneDrive\Documentos\GitHub\Proyecto\sistema_nulidad_api\test:/app/test:ro" `
  sistema_nulidad_api-api:latest npm test

docker run --rm --entrypoint python `
  -e PYTHONPATH=/app `
  -v "C:\Users\britz\OneDrive\Documentos\GitHub\Proyecto\sistema_nulidad_web\tests:/tests:ro" `
  sistema_nulidad_api-web:latest `
  -m unittest discover -s /tests -v
```

Existe además `sistema_nulidad_web/tests/verify_document_flow.py` para el recorrido web integrado.

## Archivos clave que deben leerse antes de cambiar arquitectura

```text
sistema_nulidad_api/docker-compose.yml
sistema_nulidad_api/src/app.js
sistema_nulidad_api/src/security/authorization.js
sistema_nulidad_api/src/security/resource-access.js
sistema_nulidad_api/src/documents/workflow-policy.js
sistema_nulidad_api/src/routes/
sistema_nulidad_bd/schema.sql
sistema_nulidad_bd/migrations/002_generalizacion_plataforma.sql
sistema_nulidad_bd/migrations/004_document_observation_workflow.sql
sistema_nulidad_bd/migrations/006_review_decision_workflow.sql
sistema_nulidad_bd/migrations/007_process_management.sql
sistema_nulidad_bd/migrations/008_utf8mb4_demo_repair.sql
sistema_nulidad_bd/migrations/009_spanish_demo_copy.sql
sistema_nulidad_bd/migrations/010_spanish_catalog_copy.sql
sistema_nulidad_bd/migrations/011_spanish_legal_catalogs.sql
sistema_nulidad_bd/migrations/012_mobile_api_channel.sql
sistema_nulidad_bd/migrations/013_mobile_registration_invitations.sql
sistema_nulidad_web/app.py
sistema_nulidad_web/templates/workspace_section.html
sistema_nulidad_web/templates/case_detail.html
sistema_nulidad_web/templates/document_detail.html
sistema_nulidad_web/static/styles.css
sistema_nulidad_web/static/document-viewer.mjs
```

## Trabajo pendiente y orden recomendado

La base web es funcional para los flujos implementados, pero el producto no debe considerarse terminado para producción. El siguiente trabajo recomendado es:

1. Implementar el proveedor real de OCR y detección/verificación de firmas usando las tablas de trabajos y resultados ya existentes, siempre respetando la política del tipo documental.
2. Completar la conversión segura de DOCX a PDF para vista previa; hoy DOCX puede almacenarse, pero no se convierte para el visor.
3. Ampliar pruebas integrales por rol, casos no asignados, estados lógicos y fallos de MinIO.
4. Antes de producción: HTTPS y proxy inverso, rotación de secretos, contraseñas robustas, verificación de correo, MFA o recuperación segura, escaneo antimalware, copias de seguridad, restauración probada, monitoreo y estrategia de alta disponibilidad.
5. Definir el alcance legal de la firma: la firma de integridad actual no sustituye automáticamente una firma electrónica cualificada o un certificado legal.

No volver a crear desde cero la base, API, web, MinIO, visor PDF, espacios de trabajo, filtros, formularios desplegables, RBAC o las traducciones: todos esos elementos ya están implementados.

## Frase corta para iniciar otro chat

```text
Lee primero docs/CONTEXTO_CONTINUIDAD_PROYECTO.md y continúa Expediente Íntegro desde ese estado. No reconstruyas lo ya implementado, no uses las carpetas heredadas API/frontend/mysql como sistema principal, no borres volúmenes ni datos, conserva la interfaz móvil y verifica Docker y los archivos actuales antes de proponer cambios.
```
