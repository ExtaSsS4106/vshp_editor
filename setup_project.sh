#!/usr/bin/env bash
# Создаёт каркас Flask API-проекта: config/, пустую apps/, БД, миграции и свои команды.
# Запускать в корне проекта:  bash setup_project.sh
set -euo pipefail

if [ -e config/settings.py ]; then
    echo "Структура уже существует (найден config/settings.py). Остановлено." >&2
    exit 1
fi

# --- окружение venv ---
if [ -z "${VIRTUAL_ENV:-}" ]; then
    if [ -f venv/bin/activate ]; then
        source venv/bin/activate
    elif [ -f .venv/bin/activate ]; then
        source .venv/bin/activate
    else
        echo "Активируйте venv (source venv/bin/activate) и запустите скрипт снова." >&2
        exit 1
    fi
fi

mkdir -p config apps

# --- зависимости ---
python -m pip install flask flask-sqlalchemy flask-migrate python-dotenv && python -m pip freeze > requirements.txt

# --- .env / .env.example ---
SECRET=$(python -c 'import secrets; print(secrets.token_hex(32))')
cat > .env <<ENVEOF
FLASK_APP=run
SECRET_KEY=$SECRET
DEBUG=true
HOST=127.0.0.1
PORT=5000
ENVEOF
sed 's/^SECRET_KEY=.*/SECRET_KEY=change-me/' .env > .env.example

# --- .gitignore ---
cat > .gitignore <<'EOF'
venv/
.venv/
__pycache__/
*.pyc
.env
db.sqlite3
EOF

# --- run.py ---
cat > run.py <<'EOF'
from config import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host=app.config["HOST"], port=app.config["PORT"], debug=app.config["DEBUG"])
EOF

# --- apps/ (пусто) ---
touch apps/__init__.py

# --- config/settings.py ---
cat > config/settings.py <<'EOF'
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", 5000))

# База данных (по умолчанию SQLite-файл в корне проекта)
SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}")
SQLALCHEMY_TRACK_MODIFICATIONS = False

APPS_DIR = BASE_DIR / "apps"
MIGRATIONS_DIR = BASE_DIR / "migrations"

# Подключённые приложения. Команда "flask startapp" дописывает сюда сама.
INSTALLED_APPS = [
]
EOF

# --- config/extensions.py ---
cat > config/extensions.py <<'EOF'
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
migrate = Migrate()
EOF

# --- config/commands.py ---
cat > config/commands.py <<'EOF'
import re
from pathlib import Path

import click
import flask_migrate as fm

from .settings import APPS_DIR, MIGRATIONS_DIR

SETTINGS_FILE = Path(__file__).resolve().parent / "settings.py"

# Шаблоны файлов нового приложения (__NAME__ заменяется на имя приложения)
APP_FILES = {
    "__init__.py": "",
    "models.py": '''from config.extensions import db

# Пример модели:
# class Item(db.Model):
#     id = db.Column(db.Integer, primary_key=True)
#     name = db.Column(db.String(255), nullable=False)
''',
    "views.py": '''from flask import jsonify


def index():
    return jsonify({"app": "__NAME__"})
''',
    "urls.py": '''from flask import Blueprint

from . import views

bp = Blueprint("__NAME__", __name__, url_prefix="/api/__NAME__")

bp.add_url_rule("/", view_func=views.index, methods=["GET"])
''',
}


def _register_in_settings(name: str) -> bool:
    """Дописать приложение в INSTALLED_APPS в settings.py."""
    entry = f'"apps.{name}"'
    text = SETTINGS_FILE.read_text(encoding="utf-8")
    if entry in text:
        return False
    new_text, count = re.subn(
        r"(INSTALLED_APPS\s*=\s*\[)(.*?)(\n?\])",
        lambda m: f"{m.group(1)}{m.group(2).rstrip()}\n    {entry},\n]",
        text,
        count=1,
        flags=re.S,
    )
    if count == 0:
        return False
    SETTINGS_FILE.write_text(new_text, encoding="utf-8")
    return True


def _require_migrations():
    if not MIGRATIONS_DIR.exists():
        raise click.ClickException("Миграций ещё нет. Сначала выполните: flask makemigrations")


def register_commands(app):
    @app.cli.command("startapp")
    @click.argument("name")
    def startapp(name):
        """Создать приложение: flask startapp items"""
        name = name.lower()
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
            raise click.ClickException("Имя: латинские буквы, цифры и _, не с цифры.")
        app_dir = APPS_DIR / name
        if app_dir.exists():
            raise click.ClickException(f"Приложение apps/{name} уже существует.")
        app_dir.mkdir(parents=True)
        for filename, content in APP_FILES.items():
            (app_dir / filename).write_text(content.replace("__NAME__", name), encoding="utf-8")
        added = _register_in_settings(name)
        click.echo(f"Создано apps/{name}")
        click.echo("Добавлено в INSTALLED_APPS" if added else "Добавьте приложение в INSTALLED_APPS вручную")

    @app.cli.command("makemigrations")
    @click.option("-m", "--message", default="auto", help="Описание миграции")
    def makemigrations(message):
        """Создать файл миграции по изменениям в моделях (папка migrations создаётся сама)"""
        if not MIGRATIONS_DIR.exists():
            fm.init()
        fm.migrate(message=message)

    @app.cli.command("migrate")
    def migrate_cmd():
        """Применить все миграции к базе"""
        _require_migrations()
        fm.upgrade()

    @app.cli.command("rollback")
    @click.option("--steps", default=1, show_default=True, help="Сколько миграций откатить")
    def rollback(steps):
        """Откатить последние миграции"""
        _require_migrations()
        fm.downgrade(revision=f"-{steps}")

    @app.cli.command("showmigrations")
    def showmigrations():
        """Показать список миграций (текущая помечена)"""
        _require_migrations()
        fm.history(indicate_current=True)

    # help должна оставаться последней: в список попадают команды, объявленные выше
    @app.cli.command("help")
    def help_cmd():
        """Показать список команд проекта"""
        own = sorted(
            ((n, c) for n, c in app.cli.commands.items()
             if getattr(c.callback, "__module__", None) == __name__),
            key=lambda x: x[0],
        )
        click.echo("Команды проекта:\n")
        for name, cmd in own:
            args = " ".join(
                f"<{p.name}>" if isinstance(p, click.Argument) else f"[{p.opts[-1]}]"
                for p in cmd.params
            )
            click.echo(f"  flask {name} {args}".rstrip())
            click.echo(f"      {cmd.get_short_help_str(limit=100)}")
        click.echo("\nВстроенные: flask run, flask shell, flask routes, flask db --help")
EOF

# --- config/__init__.py ---
cat > config/__init__.py <<'EOF'
import importlib

from flask import Flask

from .commands import register_commands
from .extensions import db, migrate
from .settings import MIGRATIONS_DIR


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object("config.settings")
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
    return app
EOF

echo
echo "Готово. Список команд проекта:"
echo
flask help || true
echo
echo "Дальше:  flask startapp items  ->  flask makemigrations -m \"init\"  ->  flask migrate  ->  python run.py"
