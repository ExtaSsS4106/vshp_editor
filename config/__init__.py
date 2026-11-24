import importlib

from flask import Flask

from .commands import register_commands
from .extensions import db, migrate
from .settings import MIGRATIONS_DIR, ensure_directories
from apps.frontend.config import *
from flask_cors import CORS

def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__,
                    template_folder=str(TEMPLATES),
                    static_folder=str(STATIC))
    CORS(app, resources={r"*": {"origins": [
        *settings.CORS_ALLOWED_ORIGINS
    ]}})
    app.config.from_object("config.settings")
    app.config["MAX_CONTENT_LENGTH"] = settings.MAX_UPLOAD_MB * 1024 * 1024
    if test_config:
        app.config.update(test_config)
    app.json.ensure_ascii = False        # кириллица в JSON без \uXXXX
    app.url_map.strict_slashes = False   # /api/items и /api/items/ одинаково

    db.init_app(app)
    migrate.init_app(app, db, directory=str(MIGRATIONS_DIR))

    # Подключение приложений из INSTALLED_APPS
    for name in app.config["INSTALLED_APPS"]:
        try:
            importlib.import_module(f"{name}.models")   # чтобы миграции видели модели
        except ModuleNotFoundError as e:
            if e.name != f"{name}.models":
                raise
        app.register_blueprint(importlib.import_module(f"{name}.urls").bp)

    register_commands(app)
    ensure_directories()
    return app
