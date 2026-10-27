"""Real Docker execution. This module is the future ConTree migration boundary."""

import asyncio
from dataclasses import asdict, dataclass
from uuid import uuid4

from server.config import ENV, IMAGE, WORKSPACE, BoundaryError


@dataclass
class Result:
    exit_code: int
    output: str
    truncated: bool = False

    def dict(self) -> dict:
        return asdict(self)


async def command(*args: str, stdin: str | None = None, limit: int = 120_000) -> Result:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE
        if stdin is not None
        else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output = bytearray()
    truncated = False

    async def feed():
        if stdin is not None:
            try:
                process.stdin.write(stdin.encode())
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass  # A rejecting git apply may exit before reading the entire patch.
            finally:
                process.stdin.close()

    writer = asyncio.create_task(feed())
    try:
        while chunk := await process.stdout.read(8192):
            output.extend(chunk)
            if len(output) > limit:
                del output[: len(output) - limit]
                truncated = True
        await writer
        code = await process.wait()
    except asyncio.CancelledError:
        writer.cancel()
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    text = output.decode(errors="replace")
    if truncated:
        text = "[Earlier output omitted: storage limit reached]\n" + text
    return Result(code, text, truncated)


async def docker(*args: str, stdin: str | None = None) -> str:
    result = await command("docker", *args, stdin=stdin)
    if result.exit_code:
        raise BoundaryError(f"Docker {args[0]} failed: {result.output[-4000:]}")
    return result.output.strip()


async def cleanup(run_id: str | None = None) -> None:
    filters = ["--filter", f"label=oriclus.workspace={WORKSPACE}"]
    if run_id:
        filters += ["--filter", f"label=oriclus.run={run_id}"]
    containers = (await docker("ps", "-aq", *filters)).split()
    if containers:
        await docker("rm", "-f", *containers)
    images = sorted(set((await docker("image", "ls", "-q", *filters)).split()))
    if images:
        await docker("image", "rm", "-f", *images)


class Sandbox:
    def __init__(self, run_id: str):
        self.run_id = run_id

    async def create(self, image: str = IMAGE, network: bool = False) -> str:
        return await docker(
            "run",
            "-d",
            "--init",
            "--name",
            f"oriclus-{uuid4().hex[:16]}",
            "--label",
            f"oriclus.workspace={WORKSPACE}",
            "--label",
            f"oriclus.run={self.run_id}",
            "--memory",
            ENV.get("SANDBOX_MEMORY") or "2g",
            "--cpus",
            ENV.get("SANDBOX_CPUS") or "2",
            "--pids-limit",
            "256",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--network",
            "bridge" if network else "none",
            "--user",
            "1000:1000",
            image,
            "sleep",
            "infinity",
        )

    async def run(
        self,
        container: str,
        shell: str,
        cwd: str = "/work",
        stdin: str | None = None,
        limit: int = 120_000,
    ) -> Result:
        return await command(
            "docker",
            "exec",
            "-i",
            "-w",
            cwd,
            container,
            "/bin/sh",
            "-c",
            shell,
            stdin=stdin,
            limit=limit,
        )

    async def require(self, container: str, shell: str, cwd: str = "/work") -> str:
        result = await self.run(container, shell, cwd)
        if result.exit_code:
            raise BoundaryError(result.output[-8000:])
        return result.output.strip()

    async def snapshot(self, container: str) -> str:
        return await docker(
            "commit",
            "--change",
            f"LABEL oriclus.workspace={WORKSPACE}",
            "--change",
            f"LABEL oriclus.run={self.run_id}",
            container,
        )

    async def remove(self, container: str) -> None:
        await docker("rm", "-f", container)
