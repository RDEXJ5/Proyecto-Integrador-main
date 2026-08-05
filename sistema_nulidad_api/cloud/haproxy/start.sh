#!/bin/sh
set -eu

if [ ! -s /certs/server.pem ]; then
  echo "No se encontro el certificado TLS en /certs/server.pem." >&2
  echo "Monte un archivo PEM que contenga la clave privada y la cadena del certificado." >&2
  exit 1
fi

: "${HAPROXY_GLOBAL_MAXCONN:=4096}"
: "${HAPROXY_REQUESTS_PER_10S:=30}"
: "${HAPROXY_GRAFANA_REQUESTS_PER_10S:=100}"
: "${HAPROXY_CONNECTIONS_PER_IP:=10}"
: "${HAPROXY_WEB_API_MAXCONN:=100}"
: "${HAPROXY_MOBILE_API_MAXCONN:=100}"
: "${HAPROXY_WEB_MAXCONN:=32}"
: "${HAPROXY_GRAFANA_MAXCONN:=50}"
: "${HAPROXY_BACKEND_MAXQUEUE:=100}"

validate_positive_integer() {
  variable_name="$1"
  variable_value="$2"

  case "$variable_value" in
    ''|*[!0-9]*)
      echo "$variable_name debe ser un numero entero positivo." >&2
      exit 1
      ;;
  esac

  if [ "$variable_value" -lt 1 ]; then
    echo "$variable_name debe ser mayor que cero." >&2
    exit 1
  fi
}

validate_positive_integer HAPROXY_GLOBAL_MAXCONN "$HAPROXY_GLOBAL_MAXCONN"
validate_positive_integer HAPROXY_REQUESTS_PER_10S "$HAPROXY_REQUESTS_PER_10S"
validate_positive_integer HAPROXY_GRAFANA_REQUESTS_PER_10S "$HAPROXY_GRAFANA_REQUESTS_PER_10S"
validate_positive_integer HAPROXY_CONNECTIONS_PER_IP "$HAPROXY_CONNECTIONS_PER_IP"
validate_positive_integer HAPROXY_WEB_API_MAXCONN "$HAPROXY_WEB_API_MAXCONN"
validate_positive_integer HAPROXY_MOBILE_API_MAXCONN "$HAPROXY_MOBILE_API_MAXCONN"
validate_positive_integer HAPROXY_WEB_MAXCONN "$HAPROXY_WEB_MAXCONN"
validate_positive_integer HAPROXY_GRAFANA_MAXCONN "$HAPROXY_GRAFANA_MAXCONN"
validate_positive_integer HAPROXY_BACKEND_MAXQUEUE "$HAPROXY_BACKEND_MAXQUEUE"

runtime_config=/tmp/haproxy.cfg
sed \
  -e "s/__HAPROXY_GLOBAL_MAXCONN__/$HAPROXY_GLOBAL_MAXCONN/g" \
  -e "s/__HAPROXY_REQUESTS_PER_10S__/$HAPROXY_REQUESTS_PER_10S/g" \
  -e "s/__HAPROXY_GRAFANA_REQUESTS_PER_10S__/$HAPROXY_GRAFANA_REQUESTS_PER_10S/g" \
  -e "s/__HAPROXY_CONNECTIONS_PER_IP__/$HAPROXY_CONNECTIONS_PER_IP/g" \
  -e "s/__HAPROXY_WEB_API_MAXCONN__/$HAPROXY_WEB_API_MAXCONN/g" \
  -e "s/__HAPROXY_MOBILE_API_MAXCONN__/$HAPROXY_MOBILE_API_MAXCONN/g" \
  -e "s/__HAPROXY_WEB_MAXCONN__/$HAPROXY_WEB_MAXCONN/g" \
  -e "s/__HAPROXY_GRAFANA_MAXCONN__/$HAPROXY_GRAFANA_MAXCONN/g" \
  -e "s/__HAPROXY_BACKEND_MAXQUEUE__/$HAPROXY_BACKEND_MAXQUEUE/g" \
  /usr/local/etc/haproxy/haproxy.cfg > "$runtime_config"

haproxy -c -f "$runtime_config"

if [ "${1:-}" = "--check" ]; then
  exit 0
fi

exec haproxy -W -db -f "$runtime_config"

