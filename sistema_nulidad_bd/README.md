# Base de datos de Expediente Íntegro

Esquema MySQL 8.4+ para una plataforma general de gestión documental jurídica.
Admite materias familiares, penales, civiles, mercantiles, laborales,
administrativas, constitucionales y tipos configurables.

## Principios

- Expedientes, usuarios, asignaciones, documentos y eventos no se eliminan.
- Los cambios de visibilidad y estado son lógicos y conservan motivo y actor.
- Cada corrección documental crea una versión nueva.
- La política de firma, autorización, certificación y análisis se captura por versión.
- Los archivos nuevos residirán en MinIO; MySQL conserva metadatos, hashes y trazabilidad.
- Los binarios históricos existentes permanecen protegidos dentro de MySQL.
- Los folios nuevos se reservan mediante una secuencia anual y transaccional por materia.

## Instalación nueva

Docker ejecuta en orden:

1. `schema.sql`
2. `migrations/002_generalizacion_plataforma.sql`

Para una instalación manual:

```powershell
Get-Content -Raw .\schema.sql | mysql -u root -p
Get-Content -Raw .\migrations\002_generalizacion_plataforma.sql | mysql -u root -p
```

## Actualizar una instalación existente

La migración `002` es aditiva y repetible. No elimina ni renombra tablas,
columnas o registros existentes:

```powershell
Get-Content -Raw .\migrations\002_generalizacion_plataforma.sql |
  mysql -u root -p juzgado_nulidad_documental
```

Después se debe ejecutar su verificación:

```powershell
Get-Content -Raw .\migrations\002_verify_generalization.sql |
  mysql -u root -p juzgado_nulidad_documental
```

La verificación compara versiones contra políticas, origen y almacenamiento;
también comprueba dentro de transacciones reversibles que los triggers impidan
eliminar expedientes u objetos y modificar políticas históricas.

## Modelo generalizado

- `legal_areas`, `case_types`, `organizational_units`: clasificación jurídica.
- `case_profiles`: extensión general de los expedientes históricos.
- `case_folio_sequences`: numeración automática por materia y año sin colisiones concurrentes.
- `case_assignments`: responsables explícitos con revocación lógica.
- `case_participant_roles`: participantes con funciones configurables.
- `case_stage_definitions`, `case_stage_transitions`, `case_deadlines`: operación procesal.
- `user_role_grants`, `role_permission_grants`: RBAC revocable sin borrar concesiones.
- `document_type_rules`: reglas vigentes por tipo, asunto y etapa.
- `document_version_policies`: instantánea inmutable de la regla aplicada.
- `document_version_metadata`: origen `web_file`, `mobile_file`, `mobile_camera` o legado.
- `storage_objects`: ubicación, versión, SHA-256, cifrado y retención de MinIO/S3.
- `document_analysis_jobs`, `document_analysis_results`: OCR y análisis de firmas.
- `document_actions`, `document_signature_records`: decisiones y firmas generalizadas.

## Datos de prueba

`seed_test_data.sql` corresponde al esquema original y se conserva para pruebas
de compatibilidad. Las cuentas funcionales de todos los espacios se crearán con
el script de credenciales de desarrollo posterior a la migración `002`.

La contraseña corta `2318` solamente está permitida cuando la API se ejecuta con
`NODE_ENV=development`.

## Retención

Los triggers bloquean `DELETE` en las tablas probatorias originales y nuevas.
Cerrar, cancelar, archivar, revocar u ocultar significa cambiar el estado y
registrar el motivo; nunca eliminar físicamente la fila.
