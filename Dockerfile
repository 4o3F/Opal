# Opal Host - Multi-stage Dockerfile
# Runtime: Deno

FROM denoland/deno:latest AS deps

WORKDIR /app

ENV DENO_DIR=/deno-dir
ENV DENO_NO_UPDATE_CHECK=1
ENV DENO_NO_PROMPT=1

COPY deno.json deno.lock ./
COPY apps/ ./apps/
COPY packages/ ./packages/

RUN mkdir -p /deno-dir \
    && deno cache --lock=deno.lock --frozen apps/host/src/main.ts

FROM denoland/deno:latest AS runtime

WORKDIR /app

ENV DENO_DIR=/deno-dir
ENV DENO_NO_UPDATE_CHECK=1
ENV DENO_NO_PROMPT=1

COPY --from=deps /app /app
COPY --from=deps /deno-dir /deno-dir

RUN mkdir -p /app/plugins

VOLUME ["/app/plugins"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD deno eval --allow-net=127.0.0.1:8080,localhost:8080 \
    "try { const r = await fetch('http://127.0.0.1:8080/health'); if (!r.ok) Deno.exit(1); const b = await r.json(); Deno.exit(b.ok === true ? 0 : 1); } catch { Deno.exit(1); }"

CMD ["deno", "run", \
    "--config=/app/deno.json", \
    "--lock=/app/deno.lock", \
    "--frozen", \
    "--no-prompt", \
    "--allow-net", \
    "--allow-read=/app,/deno-dir", \
    "--allow-run=deno", \
    "apps/host/src/main.ts"]
