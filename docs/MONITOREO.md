# Monitoreo integral del sistema

Esta guía describe el monitoreo de la versión 2.0 del Sistema Integral de Gestión Documental. La implementación cubre disponibilidad, rendimiento HTTP, base de datos, almacenamiento, contenedores, proxy HTTPS, registros centralizados, tableros y alertas.

El diseño utiliza un único proxy de entrada, HAProxy. Nginx no se ejecuta porque duplicaría el enrutamiento y la terminación TLS sin aportar una función necesaria al entorno actual.

## Arquitectura

```text
Navegador o cliente
        |
        v
HAProxy: HTTP 8088 -> HTTPS 8443
   |            |              |                 |
   v            v              v                 v
Flask       API web        API móvil          Grafana
   |            |              |                 |
   +------------+--------------+-----------------+
                            |
                       Prometheus
           +----------------+----------------+
           |                |                |
        Exportadores     Blackbox         Alertmanager
      MySQL/cAdvisor      HTTP/TLS              |
                                             receptor
                                              local

Contenedores -> Alloy -> Loki -> Grafana
```

## Cobertura implementada

| Área | Componente | Qué se comprueba |
| --- | --- | --- |
| Entrada segura | HAProxy | HTTPS, redirección desde HTTP, estado de backends y métricas del proxy |
| APIs | `prom-client` | solicitudes, códigos HTTP, latencia y métricas del proceso Node.js |
| Web | `prometheus-flask-exporter` | solicitudes, códigos HTTP, latencia y proceso Flask/Gunicorn |
| Experiencia real | Blackbox Exporter | respuestas HTTP de API web, API móvil, Flask, MinIO y HAProxy |
| Base de datos | MySQL Exporter | disponibilidad, conexiones y estadísticas internas con usuario de solo lectura |
| Archivos | MinIO | salud y métricas del clúster por su ruta oficial de Prometheus |
| Contenedores | cAdvisor | CPU, memoria, red, reinicios y límites de los contenedores |
| Métricas | Prometheus | recopilación cada 15 segundos y retención predeterminada de 15 días |
| Registros | Alloy y Loki | recolección por contenedor y servicio, limitada a este proyecto |
| Visualización | Grafana | tablero aprovisionado y consultas a Prometheus y Loki |
| Alertas | Alertmanager | agrupación, inhibición y entrega al receptor interno auditable por logs |

Las etiquetas HTTP no contienen correos, usuarios, expedientes ni identificadores reales. Las rutas variables se normalizan a `:id` para evitar alta cardinalidad y exposición de datos personales. Alloy descarta líneas que aparenten contener contraseñas, tokens o secretos antes de enviarlas a Loki.

## Inicio

Ejecute desde `sistema_nulidad_api`:

```powershell
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml ps -a
```

Los servicios auxiliares de migración, configuración de MinIO y creación del usuario exportador terminan con estado `Exited (0)`; es el comportamiento correcto. Los servicios permanentes deben permanecer en `Up` y las APIs, MySQL, MinIO y cAdvisor deben aparecer saludables.

## Acceso local

| Recurso | Dirección |
| --- | --- |
| Sistema web | `https://localhost:8443/login` |
| API web mediante proxy | `https://localhost:8443/api/health` |
| API móvil mediante proxy | `https://localhost:8443/mobile-api/health` |
| Grafana | `https://localhost:8443/grafana/` |
| Redirección HTTP | `http://localhost:8088` |

El certificado de desarrollo es autofirmado, dura 30 días y se conserva en un volumen de Docker. El navegador puede mostrar una advertencia local. En producción debe sustituirse por un certificado emitido para el dominio real.

Credenciales de Grafana para desarrollo:

```text
Usuario: admin
Contraseña: 2318
```

El tablero se encuentra en la carpeta **Monitoreo del sistema** con el nombre **Sistema Integral de Gestión Documental**. Prometheus, Loki y Alertmanager permanecen en la red interna; Grafana es la interfaz normal para consultar métricas, logs y alertas.

## Alertas incluidas

- Servicio principal sin métricas durante dos minutos.
- Comprobación HTTP sintética fallida durante dos minutos.
- Certificado TLS con menos de siete días de vigencia.
- Más del 5 % de respuestas HTTP `5xx` durante cinco minutos.
- Percentil 95 de latencia superior a dos segundos durante cinco minutos.
- Aumento sostenido de inicios de sesión fallidos.
- Uso superior al 80 % de conexiones MySQL.
- Uso superior al 85 % de la capacidad utilizable de MinIO.
- Contenedor por encima del 90 % de su límite de memoria.
- Fallo al evaluar reglas de Prometheus.

Alertmanager entrega las notificaciones al servicio interno `alert-receiver`. Este receptor registra únicamente nombre, severidad, servicio y resumen; nunca imprime el cuerpo íntegro ni secretos. Para enviar correo, Teams o Slack en producción todavía deben proporcionarse credenciales reales y una política de destinatarios.

## Comprobación operativa

Pruebas HTTPS:

```powershell
curl.exe -k https://localhost:8443/__proxy_health
curl.exe -k https://localhost:8443/api/health
curl.exe -k https://localhost:8443/mobile-api/health
curl.exe -k https://localhost:8443/grafana/api/health
```

Comprobar el circuito de alertas:

```powershell
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail 100 alertmanager alert-receiver
```

Comprobar recolección de logs:

```powershell
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml logs --tail 100 alloy loki
```

Comprobar destinos de Prometheus sin publicar su puerto:

```powershell
docker exec sistema_nulidad_api-prometheus-1 wget -qO- http://127.0.0.1:9090/api/v1/targets
```

Comprobar la sintaxis de la configuración:

```powershell
docker exec sistema_nulidad_api-prometheus-1 promtool check config /etc/prometheus/prometheus.yml
docker exec sistema_nulidad_api-prometheus-1 promtool check rules /etc/prometheus/rules/system-alerts.yml
docker exec sistema_nulidad_api-alertmanager-1 amtool check-config /etc/alertmanager/alertmanager.yml
docker exec sistema_nulidad_api-haproxy-1 haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg
docker exec sistema_nulidad_api-alloy-1 alloy validate /etc/alloy/config.alloy
```

## Archivos principales

```text
sistema_nulidad_api/docker-compose.monitoring.yml
sistema_nulidad_api/monitoring/haproxy/
sistema_nulidad_api/monitoring/prometheus/
sistema_nulidad_api/monitoring/alertmanager/
sistema_nulidad_api/monitoring/blackbox/
sistema_nulidad_api/monitoring/alloy/
sistema_nulidad_api/monitoring/loki/
sistema_nulidad_api/monitoring/grafana/
sistema_nulidad_api/src/observability/metrics.js
sistema_nulidad_api/src/observability/alert-receiver.js
```

## Retención y capacidad

- Prometheus conserva métricas durante `15d` por defecto. Se cambia con `PROMETHEUS_RETENTION`.
- Loki conserva logs durante 15 días.
- Los datos de Grafana, Prometheus, Loki y Alertmanager usan volúmenes independientes.
- La retención de monitoreo no modifica la regla jurídica que impide borrar expedientes, usuarios, documentos o auditoría de la base principal.

## Detener sin borrar

```powershell
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml down
```

No agregue `-v`: esa opción elimina los volúmenes de monitoreo y también puede eliminar datos persistentes del sistema principal.

## Consideraciones para producción

Antes de exponer el sistema fuera del equipo local:

1. Cambiar todas las contraseñas de desarrollo y generar secretos criptográficos independientes.
2. Usar un certificado TLS real y publicar únicamente los puertos necesarios.
3. Definir destinatarios y credenciales para notificaciones externas de Alertmanager.
4. Ajustar retención y límites de almacenamiento de acuerdo con la capacidad disponible.
5. Implementar respaldos de volúmenes y una restauración probada.
6. Incorporar métricas del anfitrión Windows mediante Windows Exporter si se necesita vigilar el equipo físico, no solamente los contenedores de Docker Desktop.
7. Establecer responsables, horarios de atención y procedimientos por severidad.

El stack actual constituye monitoreo funcional e integral del entorno local y de integración. La alta disponibilidad, el monitoreo de sedes externas y las notificaciones a terceros dependen de infraestructura y credenciales que no deben guardarse en el repositorio.
