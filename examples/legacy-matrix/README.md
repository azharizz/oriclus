# Legacy web application matrix

This is a deliberately constructed reproducer, not a real production project.
It combines legacy Flask and SQLAlchemy calls with Werkzeug, MarkupSafe and
Jinja2. Test with `python -m unittest -v`. Select combinations of their listed
versions in Oriclus; dependency conflicts, test failures and repairs must be
reported from actual experiments, not assumed from this example.

The app uses removed or deprecated APIs for the experiment. Never deploy it.
