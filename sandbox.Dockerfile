FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 runner \
    && mkdir /work && chown runner:runner /work
USER runner
ENV PATH="/home/runner/.local/bin:$PATH" PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONUNBUFFERED=1 GIT_TERMINAL_PROMPT=0
WORKDIR /work
CMD ["sleep", "infinity"]
