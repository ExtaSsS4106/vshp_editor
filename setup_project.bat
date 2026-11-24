@echo off
setlocal
chcp 65001 >nul
rem Создаёт каркас Flask API-проекта: config, пустая apps, БД, миграции и свои команды.
rem Запускать в корне проекта: setup_project.bat

if exist config\settings.py (
    echo Структура уже существует, найден config\settings.py. Остановлено.
    exit /b 1
)

rem --- окружение venv ---
if "%VIRTUAL_ENV%"=="" (
    if exist venv\Scripts\activate.bat (
        call venv\Scripts\activate.bat
    ) else if exist .venv\Scripts\activate.bat (
        call .venv\Scripts\activate.bat
    ) else (
        echo Активируйте venv и запустите скрипт снова.
        exit /b 1
    )
)

echo Создание файлов...
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((((Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8) -split ('#PS'+'START'))[1] -split ('#PS'+'END'))[0])"
if errorlevel 1 (
    echo Ошибка при создании файлов.
    exit /b 1
)

echo Установка зависимостей...
python -m pip install flask flask-sqlalchemy flask-migrate python-dotenv
if errorlevel 1 exit /b 1
python -m pip freeze > requirements.txt

echo.
echo Готово. Список команд проекта:
echo.
flask help
echo.
echo Дальше: flask startapp items, затем flask makemigrations -m "init", flask migrate, python run.py
exit /b 0

#PSSTART
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function W([string]$Path, [string]$Text) {
    $full = Join-Path (Get-Location).Path $Path
    $dir = Split-Path $full -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $Text = $Text -replace "`r`n", "`n"
    if ($Text.Length -gt 0) { $Text += "`n" }
    [IO.File]::WriteAllText($full, $Text, $utf8)
}

$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$key = -join ($b | ForEach-Object { $_.ToString('x2') })

W '.env' @"
FLASK_APP=run
SECRET_KEY=$key
DEBUG=true
HOST=127.0.0.1
PORT=5000
"@

W '.env.example' @'
FLASK_APP=run
SECRET_KEY=change-me
DEBUG=true
HOST=127.0.0.1
PORT=5000
'@

W 'apps/__init__.py' ''

W '.gitignore' @'
venv/
.venv/
__pycache__/
*.pyc
.env
db.sqlite3
'@

W 'run.py' @'
from config import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host=app.config["HOST"], port=app.config["PORT"], debug=app.config["DEBUG"])
'@

W 'config/settings.py' @'
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
'@

W 'config/extensions.py' @'
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
migrate = Migrate()
'@

W 'config/commands.py' @'
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
'@

W 'config/__init__.py' @'
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
'@
#PSEND
