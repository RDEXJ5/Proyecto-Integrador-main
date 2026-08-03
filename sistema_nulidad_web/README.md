# WEB Flask de Expediente Íntegro

Cliente web del sistema general de gestión documental jurídica. La aplicación no
se conecta directamente a MySQL ni a MinIO: todas las operaciones pasan por la
API, que debe validar JWT, permisos, asignación y acceso al recurso.

## Espacios de trabajo

| Ruta | Perfiles | Propósito |
|---|---|---|
| `/workspaces/contribution` | Abogado, fiscal, defensor y perito | Carga y seguimiento documental. |
| `/workspaces/review` | Juez y notario | Revisión, decisiones, autorizaciones, certificaciones y firmas. |
| `/workspaces/process` | Secretario y coordinador | Gestión de expedientes, asignaciones, etapas y plazos. |
| `/workspaces/audit` | Auditor | Consulta histórica de solo lectura. |
| `/workspaces/administration` | Administrador TI | Identidades, permisos, catálogos y salud. |

Un usuario con más de un perfil puede cambiar entre los espacios que le
correspondan. Las rutas originales de juez, notario y abogado redirigen al nuevo
espacio para conservar compatibilidad.

Cada inicio de espacio incluye métricas, accesos rápidos, una bandeja priorizada
con datos reales y una ruta de trabajo adaptada al perfil. La opción **Mi
perfil** permanece visible en el menú de cada espacio y presenta los roles,
espacios y funciones autorizadas con nombres comprensibles, además de explicar
la protección de la sesión. Los iconos del menú y de las acciones principales
son recursos SVG internos y no dependen de servicios externos.

Desde **Mi perfil**, cada persona puede actualizar únicamente su nombre visible.
El correo electrónico, los roles, los permisos y el estado de la cuenta quedan
bloqueados para evitar cambios de identidad o autorización. Las solicitudes
correspondientes se canalizan mediante `cristian05corona@gmail.com` y cada
cambio permitido se registra en auditoría.

En los perfiles de Administración TI no se muestra el mensaje para contactar a
soporte. En su lugar se ofrece acceso directo al registro de usuarios, desde el
que puede abrirse una ficha detallada con identidad, estado, roles, funciones,
membresías e historial, sin exponer la contraseña ni documentos jurídicos.

Todas las bandejas con `data-filter-scope` utilizan el controlador compartido
`static/filters.js`. La búsqueda ignora mayúsculas y acentos; los selectores se
adaptan a los atributos de cada vista y el botón **Limpiar filtros** restaura la
lista completa y su contador.

En **Gestión procesal**, los botones *Agregar responsable* e *Invitar
participante* se habilitan dentro de cada expediente. Las opciones ya vienen
combinadas con la responsabilidad o calidad procesal compatible: no se muestran
asignaciones activas ni invitaciones pendientes duplicadas. La invitación de una
parte o testigo no concede acceso inmediato; la persona debe aceptarla desde la
aplicación móvil.

Los módulos para los cuales aún no existen endpoints se presentan como pendientes
de integración y nunca muestran datos ficticios. Actualmente se conservan las
consultas existentes de expedientes, documentos y versiones.

## Seguridad

- JWT almacenado en sesión del servidor, no en `localStorage`.
- Formularios protegidos con CSRF.
- Cookie `HttpOnly` y `SameSite=Lax`.
- Política de permisos que deshabilita cámara, micrófono y geolocalización.
- La web solamente aceptará archivos existentes; la cámara pertenece al canal móvil.
- La visibilidad de la interfaz no sustituye la autorización de la API.
- PDF.js 5.7.284 se empaqueta dentro de la imagen Docker y renderiza los PDF en
  la página, sin usar el visor nativo ni una CDN en tiempo de ejecución.
- `document.content.read.web` habilita la vista previa; el botón de descarga
  solamente se crea para sesiones con `document.download.web`.
- Los DOCX necesitan una conversión posterior a PDF y nunca se abren como una
  descarga accidental desde el control de vista previa.

## Flujo

```text
Navegador -> sesión Flask -> API Node -> MySQL / MinIO
```

## Ejecución con Docker

Define en el `.env` del entorno Compose:

```dotenv
WEB_PORT=5000
FLASK_SECRET_KEY=un_secreto_aleatorio_de_al_menos_32_caracteres
SESSION_COOKIE_SECURE=false
WEB_MAX_UPLOAD_BYTES=26214400
```

Después ejecuta:

```powershell
docker compose up --build -d
```

Abre `http://127.0.0.1:5000`. En producción con HTTPS usa
`SESSION_COOKIE_SECURE=true`.
