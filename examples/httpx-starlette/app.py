"""A minimal consumer of Starlette's HTTPX-backed test client."""

from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient


async def home(_request):
    return PlainTextResponse("oriclus-ready")


def response_text():
    app = Starlette(routes=[Route("/", home)])
    with TestClient(app) as client:
        return client.get("/").text
