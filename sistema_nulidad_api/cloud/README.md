# Despliegue dividido en Google Cloud

Esta configuración publica la versión web y la API móvil. La aplicación móvil
se ejecuta en los dispositivos de desarrollo, pero consume la información
compartida de Cloud mediante HTTPS. No reemplaza los archivos
`docker-compose.yml` y `docker-compose.monitoring.yml` del entorno local.

## Arquitectura

| Servidor | Servicios principales | Exposición |
|---|---|---|
| Público `gdi-edge` | HAProxy y Grafana | Internet: `80` y `443`. VPC: métricas de Grafana, HAProxy, cAdvisor y Node Exporter. |
| Privado `gdi-private` | Flask, API web, API móvil, MySQL, MinIO, Prometheus, Loki, Alertmanager y exportadores | Sin IP pública. Web, APIs, Prometheus y Loki escuchan únicamente en la IP interna reservada. |

Alloy y los exportadores del servidor público son agentes auxiliares. No
atienden usuarios y solo envían registros y métricas al servidor privado.

HAProxy publica la API móvil exclusivamente bajo `/mobile-api` y elimina ese
prefijo antes de reenviar la solicitud al puerto privado `3001`. MySQL y MinIO
permanecen inaccesibles desde Internet.

## Archivos

- `docker-compose.private.yml`: servidor privado.
- `docker-compose.edge.yml`: servidor público.
- `private.env.example` y `private.storage.env.example`: variables privadas.
- `edge.env.example`: variables del borde público.
- `haproxy/`: proxy HTTPS que exige un certificado real.
- `prometheus/`: objetivos y alertas adaptados a los servicios de ambos servidores.
- `grafana/`: orígenes privados de Prometheus y Loki.
- `alloy/`: recolección de registros del servidor público.

## Requisitos previos

1. Proyecto de Google Cloud con facturación habilitada.
2. Una región y zona elegidas para ambos servidores.
3. VPC y subred propias; no usar reglas abiertas de la red predeterminada.
4. IP externa estática para el servidor público.
5. IP interna reservada para cada servidor.
6. Dominio dirigido a la IP externa del servidor público.
7. Docker Engine y el complemento Docker Compose instalados en ambas VM.
8. Certificado TLS emitido para el dominio.
9. Secretos de producción independientes guardados en Secret Manager.

## Reglas mínimas de red

Use cuentas de servicio o etiquetas distintas, por ejemplo `gdi-edge` y
`gdi-private`.

| Destino | Origen permitido | Puertos TCP | Motivo |
|---|---|---|---|
| Público | Internet | `80`, `443` | Redirección HTTPS y sistema web. |
| Privado | Público | `3000`, `3001`, `5000` | API web, API móvil y Flask mediante HAProxy. |
| Privado | Público | `9090`, `3100` | Consultas de Grafana y envío de logs de Alloy. |
| Público | Privado | `3000`, `8080`, `8405`, `9100` | Métricas de Grafana, contenedores, HAProxy y host. |
| Ambos | Rango IAP `35.235.240.0/20` | `22` | Administración SSH mediante IAP. |

No abra a Internet `3000`, `3001`, `5000`, `9090`, `3100`, `3306`, `9000`, `9001`,
`8080`, `8405` ni `9100`. MySQL y MinIO no se publican ni siquiera en la VPC;
solo sus contenedores autorizados pueden alcanzarlos.

El servidor privado puede obtener salida para descargar imágenes mediante Cloud
NAT. Cloud NAT no permite conexiones entrantes iniciadas desde Internet.

## Secretos

No reutilice `2318`, `12345678` ni los secretos del entorno local. Cree valores
independientes para:

- usuarios root y de aplicación de MySQL;
- usuario de métricas de MySQL;
- JWT, API interna, firma de plataforma y sesión Flask;
- usuarios root y de aplicación de MinIO;
- cifrado documental;
- administración y firma interna de Grafana.

Cada VM debe usar una cuenta de servicio con acceso únicamente a las versiones
de Secret Manager que necesita. Descargue los valores durante el despliegue y
cree los archivos `private.env`, `private.storage.env` y `edge.env` con permisos
`0600`. No los copie al repositorio ni a una imagen Docker.

Para generar una clave de cifrado documental de 32 bytes en Linux:

```bash
openssl rand -base64 32
```

Para secretos textuales:

```bash
openssl rand -base64 48
```

## Certificado de HAProxy

`TLS_CERT_FILE` debe apuntar a un PEM legible únicamente por el administrador.
El archivo debe contener primero la clave privada y después la cadena completa
del certificado:

```bash
install -d -m 0700 secrets
sh -c 'cat /ruta/privkey.pem /ruta/fullchain.pem > secrets/server.pem'
chmod 0600 secrets/server.pem
```

El contenedor cloud se detiene si el certificado no existe. No genera un
certificado autofirmado ni sustituye silenciosamente el certificado real.
Automatice la renovación y reinicie o recargue HAProxy después de renovarlo.

## Preparar el servidor privado

Copie el repositorio al servidor privado y ejecute desde
`sistema_nulidad_api/cloud`:

```bash
cp private.env.example private.env
cp private.storage.env.example private.storage.env
chmod 0600 private.env private.storage.env
```

Sustituya todos los valores y establezca:

- `PRIVATE_BIND_ADDRESS`: IP interna reservada del servidor privado.
- `EDGE_PRIVATE_IP`: IP interna reservada del servidor público.
- `CORS_ORIGINS`: dominio HTTPS definitivo.

Valide y arranque:

```bash
docker compose --env-file private.env -f docker-compose.private.yml config --quiet
docker compose --env-file private.env -f docker-compose.private.yml up --build -d
docker compose --env-file private.env -f docker-compose.private.yml ps -a
```

No utilice el perfil de datos de demostración en producción. En una instalación
nueva, cree la primera cuenta administradora mediante el procedimiento de
bootstrap protegido. Para trasladar datos existentes se requiere un respaldo
consistente de MySQL y una copia verificable de los objetos de MinIO; no copie
los directorios de los volúmenes mientras los servicios están escribiendo.

## Preparar el servidor público

Copie el repositorio al servidor público y ejecute desde
`sistema_nulidad_api/cloud`:

```bash
cp edge.env.example edge.env
chmod 0600 edge.env
```

Configure el dominio, ambas IP internas, las credenciales de Grafana y la ruta
del certificado. Después valide y arranque:

```bash
docker compose --env-file edge.env -f docker-compose.edge.yml config --quiet
docker compose --env-file edge.env -f docker-compose.edge.yml up --build -d
docker compose --env-file edge.env -f docker-compose.edge.yml ps -a
```

## Protección contra saturación

El HAProxy público limita las ráfagas antes de que alcancen Flask o las API. Los
valores iniciales se encuentran en `edge.env.example`:

- `HAPROXY_REQUESTS_PER_10S`: solicitudes permitidas por IP en diez segundos;
- `HAPROXY_GRAFANA_REQUESTS_PER_10S`: límite independiente para el panel de Grafana;
- `HAPROXY_CONNECTIONS_PER_IP`: conexiones simultáneas permitidas por IP;
- `HAPROXY_*_MAXCONN`: conexiones enviadas simultáneamente a cada backend;
- `HAPROXY_BACKEND_MAXQUEUE`: solicitudes que pueden esperar por backend.

El endpoint `/__proxy_health` no consume la cuota y Grafana dispone de un límite
independiente. Cuando un cliente excede su límite, HAProxy responde `429`; cuando un backend y su cola están saturados,
responde `503`. Los backends se comprueban cada cinco segundos, se retiran tras
tres fallos consecutivos y regresan después de dos comprobaciones correctas.

No aumente los límites sin comprobar antes CPU, memoria, conexiones de MySQL y
latencia. Para validar la configuración generada sin publicar puertos:

```bash
docker compose --env-file edge.env -f docker-compose.edge.yml build haproxy
docker compose --env-file edge.env -f docker-compose.edge.yml run --rm --no-deps haproxy --check
```

Después de desplegar, confirme el estado del contenedor y el proxy:

```bash
docker compose --env-file edge.env -f docker-compose.edge.yml ps haproxy
curl --fail https://DOMINIO/__proxy_health
```

## Comprobaciones

Desde el servidor público:

```bash
curl --fail http://PRIVATE_IP:3000/health
curl --fail http://PRIVATE_IP:3001/health
curl --fail http://PRIVATE_IP:5000/health
curl --fail http://PRIVATE_IP:9090/-/ready
curl --fail http://PRIVATE_IP:3100/ready
```

Desde el servidor privado:

```bash
curl --fail http://EDGE_PRIVATE_IP:8405/metrics
curl --fail http://EDGE_PRIVATE_IP:8080/metrics
curl --fail http://EDGE_PRIVATE_IP:9100/metrics
```

Desde Internet:

```bash
curl --fail https://DOMINIO/__proxy_health
curl --fail https://DOMINIO/api/health
curl --fail https://DOMINIO/mobile-api/health
curl --fail --head https://DOMINIO/login
```

Confirme después:

- inicio de sesión de los espacios web y de administración;
- registro e inicio de sesión desde la aplicación móvil;
- aislamiento de expedientes y permisos;
- carga, visualización y versionamiento de un PDF de prueba;
- los objetivos de Prometheus en estado `UP`;
- métricas y registros de ambos servidores en Grafana;
- disparo controlado de una alerta;
- restauración de un respaldo de prueba.

## Aplicación móvil

El cliente Expo continúa ejecutándose localmente, mientras que la API móvil de
producción utiliza la base de datos y el almacenamiento del servidor privado.
Configure el cliente con una URL HTTPS que contenga el dominio, nunca la IP
interna ni el puerto `3001`:

```env
EXPO_PUBLIC_MOBILE_API_URL=https://DOMINIO/mobile-api
```

Para trabajar con una API completamente local se mantienen los comandos:

```powershell
cd C:\Users\britz\Downloads\Proyecto-Integrador-main\Proyecto-Integrador-main\sistema_nulidad_api
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up --build -d
```

También puede levantar únicamente el backend necesario para la aplicación móvil
y sus dependencias:

```powershell
docker compose up --build -d mobile-api
```

La base cloud y una base local siguen siendo entornos independientes y no se
sincronizan automáticamente. Para trabajar con los datos en línea, el cliente
debe utilizar `/mobile-api`. Nunca se debe abrir MySQL o MinIO directamente a
los teléfonos.

## Respaldos

Asocie MySQL, MinIO, Prometheus y Loki a discos persistentes. Programe
instantáneas, pero compleméntelas con respaldos consistentes de MySQL y pruebas
de restauración. Una instantánea del disco sin coordinación con la aplicación no
garantiza por sí sola la consistencia lógica de la base.
