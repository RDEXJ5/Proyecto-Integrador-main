# APIs · Expediente Íntegro

El mismo proyecto Node.js produce dos servicios HTTP independientes que
comparten los servicios de dominio, MySQL y MinIO:

| Servicio | Puerto | Perfiles |
| --- | --- | --- |
| `api` | 3000 | Perfiles web y administración técnica |
| `mobile-api` | 3001 | Parte interesada y testigo |

La separación es por proceso y por rutas. Un JWT móvil no puede utilizar las
rutas jurídicas de la API web. Ambas APIs conservan una sola fuente de verdad
para expedientes, documentos, versiones, políticas, observaciones y auditoría.

## Inicio con Docker

```powershell
Copy-Item .env.example .env
Copy-Item .env.storage.example .env.storage
docker compose up --build -d
docker compose ps
```

Comprobaciones:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:5000/login
```

Las migraciones `012_mobile_api_channel.sql` y
`013_mobile_registration_invitations.sql` se ejecutan de forma idempotente tanto
en bases nuevas como en un volumen existente. No es necesario eliminar el
volumen para habilitar la API móvil, el registro o las invitaciones.

Para cargar cuentas y expedientes de demostración con contraseña `2318`, use el
perfil opcional después de levantar el stack:

```powershell
docker compose --profile demo run --rm demo-seed
```

El perfil `demo` nunca se ejecuta automáticamente y no debe utilizarse en
producción.

## API web

- Documentación: `http://127.0.0.1:3000/docs`.
- Contrato: `http://127.0.0.1:3000/openapi.json`.
- Login: `POST /auth/login` con `clientChannel` igual a `web` o `technical`.
- La API Key sólo protege `/system/*` y nunca se entrega al frontend.
- Las rutas documentales profesionales exigen canal web, JWT, permiso y acceso
  al expediente.
- `GET /process/catalogs?caseId={id}` devuelve únicamente combinaciones válidas
  de persona/responsabilidad y persona/calidad procesal para el expediente. Las
  operaciones de escritura vuelven a comprobar rol, asignación, duplicados y
  acceso, aunque el cliente altere el formulario.
- `GET /administration/users/{id}` devuelve la ficha técnica detallada del
  usuario, sus roles, permisos, membresías y los historiales de rol y estado,
  sin exponer contraseñas ni contenido jurídico.
- `POST /administration/users/{id}/password` permite al administrador asignar
  una contraseña con motivo auditable; la contraseña nunca se guarda en el
  evento de auditoría.
- Cuando una identidad tiene roles en varios canales, el inicio de sesión carga
  solamente los roles y permisos del canal solicitado. Esto evita que un rol
  móvil herede capacidades administrativas o viceversa.

## API móvil

| Método | Ruta | Función |
| --- | --- | --- |
| POST | `/auth/login` | Crea JWT móvil para parte o testigo |
| POST | `/auth/register` | Crea una cuenta móvil y devuelve su JWT |
| GET | `/auth/me` | Devuelve perfil y permisos móviles |
| GET | `/invitations` | Lista invitaciones pendientes propias |
| POST | `/invitations/:id/accept` | Acepta y crea la participación activa |
| POST | `/invitations/:id/decline` | Rechaza sin conceder acceso al expediente |
| GET | `/cases` | Expedientes donde participa el usuario |
| GET | `/cases/:caseId` | Metadatos permitidos del expediente |
| GET | `/cases/:caseId/documents` | Documentos propiedad del usuario |
| GET | `/cases/:caseId/document-types` | Tipos que el rol puede aportar |
| POST | `/cases/:caseId/documents` | Documento y primera versión |
| GET | `/documents/:documentId` | Metadatos del documento propio |
| GET | `/documents/:documentId/versions` | Historial de versiones |
| POST | `/documents/:documentId/versions` | Agrega una versión sin sobrescribir |
| GET | `/documents/:documentId/observations` | Observaciones y respuestas |
| POST | `/documents/:documentId/observations/:id/responses` | Respuesta auditable |

El login móvil recibe únicamente:

```json
{
  "email": "mobile.parte.20260731@example.test",
  "password": "2318"
}
```

La API determina el canal; no acepta `X-Client-Type` ni una API Key enviada por
el dispositivo.

El autorregistro local admite la contraseña de desarrollo `2318`; en producción
la API exige al menos doce caracteres. Una cuenta nueva inicia sin expedientes. La gestión web crea una
invitación pendiente y solamente la aceptación autenticada desde el móvil
genera un registro activo en `case_participant_roles`.

## Seguridad y almacenamiento

- JWT con expiración, emisor y audiencia verificados.
- BOLA/IDOR: cada consulta móvil exige participación activa y propiedad del
  documento, incluso si el usuario conoce otro identificador.
- Contraseñas bcrypt; nunca se comparan en texto plano.
- Helmet, límites de solicitudes, SQL parametrizado y tamaño máximo de carga.
- Tipo de archivo detectado desde el contenido.
- Cifrado AES-256-GCM antes de enviar el objeto a MinIO.
- Versionado, retención y bloqueo legal en MinIO.
- SHA-256 y origen inmutable por versión.
- Sin rutas móviles para descargar el original, firmar, autorizar, certificar,
  decidir o administrar.

## Desarrollo sin Docker

```powershell
npm install
npm test
npm run check
npm run dev
```

En otra terminal puede iniciar la API móvil con un puerto distinto:

```powershell
$env:PORT = "3001"
npm run dev:mobile
```

No use `docker compose down -v` salvo que desee destruir deliberadamente todos
los datos locales de desarrollo.
