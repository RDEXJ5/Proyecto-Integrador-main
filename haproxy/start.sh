#!/bin/sh
set -eu

# A self-signed certificate keeps the development topology functional. Replace
# /certs/server.pem with a certificate issued for the production domain.
if [ ! -s /certs/server.pem ]; then
  mkdir -p /certs
  openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days 30 \
    -keyout /tmp/server.key -out /tmp/server.crt \
    -subj "/CN=localhost/O=Control Documental Development"
  cat /tmp/server.key /tmp/server.crt > /certs/server.pem
  chmod 600 /certs/server.pem
fi

exec haproxy -W -db -f /usr/local/etc/haproxy/haproxy.cfg
