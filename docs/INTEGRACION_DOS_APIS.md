# Integración de la API web y la API móvil

## Decisión arquitectónica

Expediente Íntegro utiliza dos APIs separadas y una sola base documental:

```text
Flask web ─────────> API web ──────┐
                                   ├──> MySQL
Expo móvil ────────> API móvil ────┤
                                   └──> MinIO privado
```

Los procesos son independientes, pero comparten módulos de dominio dentro de
`sistema_nulidad_api/src`. Esto mantiene una única implementación para hashes,
cifrado, versionamiento, políticas documentales y almacenamiento.

## Límites de confianza

- La API web acepta sesiones `web`; administración también puede aceptar una
  sesión `technical`.
- La API móvil exige canal `mobile` y al menos un rol activo `party` o
  `witness`.
- El dispositivo no recibe la API Key del sistema.
- La cabecera del cliente no determina permisos; el canal está firmado en JWT.
- La API móvil aplica propiedad documental de manera explícita, aun cuando una
  cuenta tenga más de un rol.

## Coherencia transaccional

Cada alta documental utiliza el servicio compartido `document-service.js`:

1. Bloquea o consulta el expediente y documento correspondientes.
2. Resuelve la regla vigente del tipo documental.
3. Calcula el siguiente número de versión sin sobrescritura.
4. Copia la política a `document_version_policies`.
5. Registra el origen en `document_version_metadata`.
6. Cifra y guarda el objeto en MinIO.
7. Registra SHA-256, retención y bloqueo legal.
8. Encola análisis sólo cuando lo exige la política.
9. Escribe un evento de auditoría con canal web o móvil.

## Migración 012

`012_mobile_api_channel.sql` incorpora:

- Permiso `workspace.mobile.access`.
- Respuesta a observaciones para partes y testigos.
- Catálogo auditable `mobile_role_document_types`.
- Restricciones contra modificación de identidad y eliminación física.

Los tipos iniciales son:

- Parte: identificación, CURP, acta de nacimiento, RFC, comprobante de
  domicilio y libelo.
- Testigo: identificación de testigo y libelo.

Un administrador podrá ampliar el catálogo posteriormente mediante nuevas
concesiones, sin modificar el código de la aplicación.

## Migración 013

`013_mobile_registration_invitations.sql` incorpora el flujo de consentimiento
para participantes:

1. La persona se registra como parte o testigo y puede iniciar sesión.
2. La cuenta inicia sin expedientes ni documentos visibles.
3. Un secretario o coordinador envía una invitación desde el expediente web.
4. La invitación no concede acceso mientras permanece pendiente.
5. La aceptación móvil crea la participación activa dentro de una transacción.
6. El rechazo, vencimiento o aceptación se conserva; la tabla bloquea `DELETE`.

Las invitaciones vencen después de 30 días. La calidad `witness` exige una
cuenta Testigo; las demás calidades procesales exigen una cuenta Parte.

## Pruebas mínimas de aceptación

1. La parte inicia sesión en 3001; un juez recibe `403` en la misma API.
2. Un JWT móvil recibe `403` al intentar usar `/cases` en la API web.
3. La parte sólo ve expedientes donde participa activamente.
4. Un identificador de documento ajeno devuelve `404`.
5. Una carga móvil crea documento, versión, origen, objeto MinIO y auditoría.
6. Una segunda carga aumenta `version_number` y conserva la primera.
7. Un tipo no concedido al rol devuelve `403`.
8. No existe endpoint móvil de contenido o descarga.
9. La web conserva sus flujos de revisión, decisión y administración.
10. Reiniciar los servicios no elimina datos ni cambia las políticas copiadas.
11. Una cuenta recién registrada obtiene cero expedientes.
12. Una invitación pendiente no concede acceso y sólo la aceptación la convierte en participación activa.
