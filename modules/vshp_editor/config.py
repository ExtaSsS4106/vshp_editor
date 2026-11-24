"""Единая конфигурация: пути, доступы, тайминги, настройки логирования.

Приоритет значения: переменная окружения -> .env -> значение по умолчанию.
Ни один модуль не хранит пароль и URL — всё берётся отсюда.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------- пути
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
QUESTIONS_DIR = DATA_DIR / "questions"
LOG_DIR = BASE_DIR / "logs"
LEGACY_DIR = BASE_DIR / "legacy"

for _dir in (DATA_DIR, QUESTIONS_DIR, LOG_DIR):
    _dir.mkdir(parents=True, exist_ok=True)


def _load_dotenv(path: Path) -> None:
    """Минимальный .env-парсер — без сторонних зависимостей."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BASE_DIR / ".env")


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _flag(name: str, default: bool = False) -> bool:
    return _env(name, "1" if default else "0").strip().lower() in {"1", "true", "yes", "on"}


def _ms(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


# --------------------------------------------------------------------- сайт / доступы
BASE_URL = _env("VSHP_URL", "https://erp.vshp.online").rstrip("/")
EMAIL = _env("VSHP_EMAIL", "v.gornostaev@siil.ch")
PASSWORD = _env("VSHP_PASSWORD", "bW6XynFFKUZVS86")

# ------------------------------------------------------------------------- браузер
HEADLESS = _flag("VSHP_HEADLESS", False)
BLOCK_MEDIA = _env("VSHP_BLOCK_MEDIA", "1").strip().lower() in {"1", "true", "yes", "on"}
WAIT_TIMEOUT = _ms("VSHP_WAIT_TIMEOUT", 30000)

# --------------------------------------------------------------------- логирование
LOG_LEVEL = _env("VSHP_LOG_LEVEL", "INFO").upper()
LOG_FILE = LOG_DIR / "vshp_editor.log"
LOG_MAX_BYTES = _ms("VSHP_LOG_MAX_BYTES", 5_000_000)
LOG_BACKUPS = _ms("VSHP_LOG_BACKUPS", 5)


# ------------------------------------------------------------------------ тайминги
@dataclass(frozen=True)
class Timing:
    """Паузы между действиями в миллисекундах.

    Правило: минимум 1-2 с между созданием поля и записью в него,
    и столько же после каждого заполненного варианта.
    """

    form_ready: int = 1800        # форма создана -> начало заполнения
    question_settle: int = 2000   # текст вопроса введён -> добавление вариантов
    field_settle: int = 1500      # новое поле варианта создано -> запись текста
    variant_settle: int = 1500    # вариант заполнен -> проверка страницы
    after_save: int = 1200        # вопрос сохранён -> следующая форма
    short: int = 400              # мелкая техническая пауза


TIMING = Timing(
    form_ready=_ms("VSHP_T_FORM", Timing.form_ready),
    question_settle=_ms("VSHP_T_QUESTION", Timing.question_settle),
    field_settle=_ms("VSHP_T_FIELD", Timing.field_settle),
    variant_settle=_ms("VSHP_T_VARIANT", Timing.variant_settle),
    after_save=_ms("VSHP_T_SAVE", Timing.after_save),
    short=_ms("VSHP_T_SHORT", Timing.short),
)
