#!/bin/sh
set -eu

if [ ! -s /certs/server.pem ]; then
  echo "No se encontro el certificado TLS en /certs/server.pem." >&2
  echo "Monte un archivo PEM que contenga la clave privada y la cadena del certificado." >&2
  exit 1
fi

exec haproxy -W -db -f /usr/local/etc/haproxy/haproxy.cfg

