FROM haproxy:3.1-alpine

USER root
RUN apk add --no-cache openssl
COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg
COPY start.sh /usr/local/bin/start-haproxy
RUN chmod +x /usr/local/bin/start-haproxy

ENTRYPOINT ["/usr/local/bin/start-haproxy"]
