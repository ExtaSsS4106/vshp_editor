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
                f"<{p.name}>" if isinstance(p, click.Argument) else f"[{p.opts[0]}]"
                for p in cmd.params
            )
            click.echo(f"  flask {name} {args}".rstrip())
            click.echo(f"      {cmd.get_short_help_str(limit=100)}")
        click.echo("\nВстроенные: flask run, flask shell, flask routes, flask db --help")
