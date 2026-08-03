FROM haproxy:3.2-alpine

USER root
RUN apk add --no-cache openssl
COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg
COPY start.sh /usr/local/bin/start-haproxy
RUN chmod 0555 /usr/local/bin/start-haproxy

ENTRYPOINT ["/usr/local/bin/start-haproxy"]
