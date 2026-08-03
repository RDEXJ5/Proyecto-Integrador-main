# Aplicación móvil · Sistema Integral de Gestión Documental

Aplicación Expo 54 exclusiva para partes interesadas (`party`) y testigos
(`witness`). Consume la API móvil en el puerto 3001; no utiliza la API Key de
sistema ni llama las rutas profesionales de la API web.

## Funciones disponibles

- Inicio de sesión con JWT de canal `mobile`.
- Autorregistro como parte interesada o testigo.
- Inicio personalizado con métricas, accesos rápidos, asuntos recientes y una
  guía inicial para las cuentas que todavía no pertenecen a un expediente.
- Navegación inferior entre Inicio, Expedientes o Casos, Pendientes y Perfil.
- Menú con iconos y etiquetas que respeta la barra superior, la isla dinámica y
  los controles inferiores del dispositivo mediante áreas seguras nativas.
- Logotipo institucional local en el acceso y en el encabezado de todas las
  pantallas autenticadas.
- Bandeja de pendientes que reúne invitaciones y documentos con observaciones.
- Invitaciones con aceptación o rechazo explícito.
- Expedientes en los que la persona participa activamente, con búsqueda y
  filtros por estado o asuntos pendientes.
- Documentos registrados a nombre del usuario.
- Indicadores de observaciones pendientes y prioridad visual para los
  documentos que requieren atención.
- Historial inmutable de versiones y huellas SHA-256.
- Alta de documentos con un tipo permitido por rol.
- Nueva versión desde un archivo existente.
- Captura de documentos con la cámara.
- Consulta y respuesta de observaciones.
- Sin descarga ni entrega del archivo original.
- Diseño adaptable para teléfonos, tabletas y cambios de orientación.
- Formularios desplazables que conservan visible el campo activo al abrir el
  teclado.
- Teclado, autocompletado y acción de avance configurados según el tipo de
  dato de cada campo.
- Perfil con datos de la cuenta, controles de seguridad aplicados y permisos
  móviles explicados en lenguaje claro.
- Edición auditable del nombre visible. El correo, rol, permisos y estado
  permanecen protegidos y requieren atención de soporte.

## Navegación por perfil

La parte interesada ve sus **Expedientes** y el testigo sus **Casos**. En ambos
perfiles el contenido se limita a las participaciones aceptadas y a los
documentos asociados a la propia persona. Una cuenta recién registrada muestra
el flujo de incorporación y permanece sin expedientes hasta aceptar una
invitación válida.

La barra inferior se oculta mientras el teclado está abierto para no reducir el
espacio útil del formulario. Al cerrarlo, el menú agrega automáticamente el
margen inferior que reporta Android o iOS. Las invitaciones y observaciones
pendientes se concentran en un solo apartado y su contador también aparece en
la navegación.

## Configuración

```powershell
Copy-Item .env.example .env
npm install
npx expo install --check
npx expo start
```

Si Metro conservó referencias de una ejecución anterior, reinícielo una vez con
la caché limpia:

```powershell
npx expo start -c
```

El directorio `assets` forma parte del proyecto para evitar solicitudes fallidas
del empaquetador incluso cuando no se configura un icono personalizado.

En Android se utiliza el modo `resize`: la ventana reduce su altura cuando se
abre el teclado en lugar de ocultar el formulario. En iOS se ajustan
automáticamente los márgenes del área desplazable. Arrastrar el formulario
hacia abajo oculta el teclado en ambas plataformas.

Configure `EXPO_PUBLIC_MOBILE_API_URL` según el dispositivo:

| Ejecución | URL habitual |
| --- | --- |
| Expo Web o simulador iOS local | `http://127.0.0.1:3001` |
| Emulador Android | `http://10.0.2.2:3001` |
| Teléfono físico | `http://IP_LAN_DEL_EQUIPO:3001` |

En desarrollo la aplicación intenta obtener automáticamente la IP del servidor
Metro. `EXPO_PUBLIC_MOBILE_API_URL` sigue teniendo prioridad cuando se define.

Para un teléfono físico también establezca `MOBILE_API_BIND_ADDRESS=0.0.0.0`
en `sistema_nulidad_api/.env`, limite el firewall a la red privada y use HTTPS
fuera de una prueba local.

Las variables `EXPO_PUBLIC_*` son públicas dentro del paquete compilado. Nunca
coloque ahí `API_APPLICATION_KEY`, credenciales de MySQL, claves de MinIO ni
secretos JWT.

## Tipos y archivos

La API admite PDF, JPG y PNG válidos de hasta 25 MB. El tipo no se confía
al nombre del archivo: el servidor inspecciona sus bytes. La cámara genera un
origen `mobile_camera`; el selector genera `mobile_file`.

La política vigente del tipo documental se copia a cada versión. Por ello un
documento que no requiere firma no se envía a detección de firmas.

## Cuentas locales de demostración

Después de cargar `seed_workspace_users.sql` y
`seed_case_assignment_demo.sql`:

| Perfil | Correo | Contraseña |
| --- | --- | --- |
| Parte | `mobile.parte.20260731@example.test` | `2318` |
| Testigo | `mobile.testigo.20260731@example.test` | `2318` |

Estas cuentas son únicamente para desarrollo.

## Registro e invitaciones

Una cuenta creada desde la aplicación recibe solamente el rol móvil elegido y
puede iniciar sesión inmediatamente. No recibe acceso a ningún expediente por
el hecho de registrarse.

El secretario o coordinador abre un expediente en la web y selecciona
**Invitar participante**. La invitación permanece pendiente durante 30 días. Al
aceptarla en el móvil se crea la participación activa; al rechazarla se conserva
la respuesta sin crear acceso. Ninguno de estos registros se elimina.
