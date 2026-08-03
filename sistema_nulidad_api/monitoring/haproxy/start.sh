#!/bin/sh
set -eu

if [ ! -s /certs/server.pem ]; then
  mkdir -p /certs
  openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 30 \
    -keyout /tmp/server.key -out /tmp/server.crt \
    -subj "/CN=localhost/O=Sistema Integral de Gestion Documental" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  cat /tmp/server.key /tmp/server.crt > /certs/server.pem
  chmod 0600 /certs/server.pem
fi

exec haproxy -W -db -f /usr/local/etc/haproxy/haproxy.cfg
