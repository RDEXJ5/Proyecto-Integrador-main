# Sistema Integral de Gestión y Control Documental

Plataforma para expedientes de nulidad matrimonial. Implementa el flujo:

`abogado/parte registra documento -> notario autoriza -> juez firma -> auditoría permanente`.

## Capacidades implementadas

- Expedientes con folio y estados `active`, `paused`, `closed` y `annulled`.
- Seis roles: administración TI, notaría, juez, abogado, parte y testigo.
- Control de acceso por rol, asignación y propiedad de documento.
- Versionado inmutable: no hay endpoint de eliminación ni reemplazo de archivo.
- Triggers MySQL que rechazan `DELETE` sobre usuarios, expedientes, versiones,
  autorizaciones, firmas y auditoría.
- Compresión `zlib`, cifrado Fernet en reposo y hash SHA-256 por versión.
- Autorización notarial y firma Ed25519 verificable del digest de cada versión.
- Bitácora de inicio de sesión, creación, autorización, firma, descarga web y cambios de estado.
- Interfaz web para expedientes, documentos, versiones y flujo notarial/judicial.
- App Expo enfocada a consulta y firma judicial móvil. No incluye descarga de archivos.
- HAProxy con TLS de desarrollo, dos réplicas de API/web y monitoreo Prometheus/Grafana.

La firma de integridad implementada no sustituye una firma electrónica avanzada
con e.firma o un prestador de servicios de certificación. Para operación legal
debe integrarse un proveedor/certificado admitido por el marco aplicable.

## Arranque local

1. Copia `.env.example` como `.env`. Reemplaza todos los valores de ejemplo;
   genera una clave Fernet con `Fernet.generate_key()` antes de usar datos reales.
2. Inicia los servicios:

   ```powershell
   docker compose up --build
   ```

3. El proxy queda disponible en `https://localhost`. El certificado que genera
   HAProxy es autofirmado y solamente sirve para desarrollo. Prometheus y
   Grafana se exponen exclusivamente en `127.0.0.1`.
4. Crea el primer administrador una única vez. Ajusta las claves con los
   valores reales de `.env`:

   ```powershell
   curl.exe -k -X POST https://localhost/api/auth/bootstrap-admin `
     -H "X-API-Key: <API_APPLICATION_KEY>" `
     -H "X-Bootstrap-Token: <BOOTSTRAP_TOKEN>" `
     -H "Content-Type: application/json" `
     -d '{"full_name":"Administración TI","email":"admin@example.mx","password":"UnaClaveLargaYUnica2026!"}'
   ```

   El endpoint se bloquea en cuanto existe el primer usuario. Después, el
   administrador crea los demás usuarios desde la API (`/api/docs`) con JWT.

## Seguridad y operación

- Sustituye el certificado de desarrollo de `haproxy_certs` por uno emitido
  para el dominio productivo y aplica reglas de firewall en el servidor para
  permitir únicamente 80/443 y el acceso administrativo autorizado.
- MySQL está dentro de una red Docker interna y no publica puertos al host.
- No almacenes `.env`, certificados privados ni documentos en Git.
- La retención permanente requiere una política institucional de archivo,
  cifrado de respaldos, control de claves y revisión legal de plazos.

## Pruebas recomendadas para la rúbrica

1. Crear un expediente, cargar un libelo y agregar una segunda versión.
2. Mostrar que ambos hashes/versiones permanecen disponibles.
3. Autorizar la versión como notario y firmarla como juez desde `mobile`.
4. Confirmar que una parte/testigo no puede abrir documentos ajenos ni que el
   móvil ofrece descargas.
5. Mostrar `/api/metrics`, Prometheus, Grafana y el balanceo de HAProxy.
