"""A deliberately old-style application for dependency upgrade experiments."""

from flask import Flask
from markupsafe import escape
from sqlalchemy import create_engine

app = Flask(__name__)
engine = create_engine("sqlite:///:memory:")


@app.before_first_request
def prepare():
    engine.execute("CREATE TABLE greeting (message TEXT)")
    engine.execute("INSERT INTO greeting VALUES ('hello')")


@app.get("/")
def home():
    return str(escape(engine.execute("SELECT message FROM greeting").scalar()))
