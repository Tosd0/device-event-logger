FROM denoland/deno:latest
EXPOSE 8000
WORKDIR /app
COPY deno.json .
# bust cache v2
COPY src/ src/
COPY entry/deno.ts entry/
RUN deno cache entry/deno.ts
CMD ["deno", "task", "start"]
