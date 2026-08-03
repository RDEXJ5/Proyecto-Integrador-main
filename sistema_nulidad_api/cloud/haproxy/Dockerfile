FROM haproxy:3.2-alpine

COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg
COPY start.sh /usr/local/bin/start-haproxy-cloud

USER root
RUN chmod 0555 /usr/local/bin/start-haproxy-cloud

ENTRYPOINT ["/usr/local/bin/start-haproxy-cloud"]

