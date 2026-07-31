# Aplicación móvil

La aplicación móvil sirve para consultar casos permitidos, revisar metadatos e
historiales de versiones y, exclusivamente para el rol `judge`, registrar la
firma de integridad de una versión ya autorizada por notaría. No implementa ni
puede invocar una descarga de archivos.

1. Copia `.env.example` a `.env` en la raíz del repositorio y levanta el stack.
2. Configura en `mobile/.env` una URL pública HTTPS y la llave de aplicación:
   `EXPO_PUBLIC_API_URL=https://dominio.example/api` y `EXPO_PUBLIC_API_KEY=...`.
3. Ejecuta `npm install` y `npx expo start` dentro de `mobile`.

Las variables `EXPO_PUBLIC_*` no son secretos: el control de acceso real lo
aplican JWT, roles y autorización del expediente en el servidor.
