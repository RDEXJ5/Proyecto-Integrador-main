FROM node:24-alpine AS pdfjs-assets

WORKDIR /assets

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt \
    && useradd --create-home --uid 10001 webapp

COPY --chown=webapp:webapp app.py ./
COPY --chown=webapp:webapp templates ./templates
COPY --chown=webapp:webapp static ./static
COPY --from=pdfjs-assets --chown=webapp:webapp /assets/node_modules/pdfjs-dist/build/pdf.min.mjs ./static/vendor/pdfjs/pdf.min.mjs
COPY --from=pdfjs-assets --chown=webapp:webapp /assets/node_modules/pdfjs-dist/build/pdf.worker.min.mjs ./static/vendor/pdfjs/pdf.worker.min.mjs
COPY --from=pdfjs-assets --chown=webapp:webapp /assets/node_modules/pdfjs-dist/cmaps ./static/vendor/pdfjs/cmaps
COPY --from=pdfjs-assets --chown=webapp:webapp /assets/node_modules/pdfjs-dist/standard_fonts ./static/vendor/pdfjs/standard_fonts
COPY --from=pdfjs-assets --chown=webapp:webapp /assets/node_modules/pdfjs-dist/LICENSE ./static/vendor/pdfjs/LICENSE

USER webapp
EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "30", "--access-logfile", "-", "--error-logfile", "-", "app:create_app()"]
