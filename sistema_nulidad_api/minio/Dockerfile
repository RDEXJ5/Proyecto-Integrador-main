FROM golang:1.24.7-alpine3.22 AS builder

ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
RUN apk add --no-cache git \
    && CGO_ENABLED=0 GOBIN=/out go install github.com/minio/minio@${MINIO_VERSION}

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && addgroup -S minio \
    && adduser -S -G minio -h /data minio \
    && mkdir -p /data \
    && chown minio:minio /data

COPY --from=builder /out/minio /usr/local/bin/minio

USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
