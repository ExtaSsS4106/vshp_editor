"""Единое логирование: консоль + файл с ротацией (logs/vshp_editor.log).

Все модули пишут через get_logger(__name__) — одинаковый формат везде:
    2026-10-28 12:00:00 [INFO ] modules.tester.release: сообщение
"""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler

from . import config

FMT = "%(asctime)s [%(levelname)-5s] %(name)s: %(message)s"
DATE = "%Y-%m-%d %H:%M:%S"

_INSTALLED = False


def setup_logging(level: str | None = None) -> None:
    """Настраивает корневой логгер (вызывается автоматически из get_logger)."""
    global _INSTALLED
    if _INSTALLED:
        return

    root = logging.getLogger()
    lvl = getattr(logging, (level or config.LOG_LEVEL).upper(), logging.INFO)
    root.setLevel(lvl)
    formatter = logging.Formatter(FMT, datefmt=DATE)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    console.setLevel(lvl)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        config.LOG_FILE,
        maxBytes=config.LOG_MAX_BYTES,
        backupCount=config.LOG_BACKUPS,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(lvl)
    root.addHandler(file_handler)

    _INSTALLED = True


def get_logger(name: str) -> logging.Logger:
    """Логгер модуля: name обычно передаётся как __name__."""
    setup_logging()
    return logging.getLogger("app" if name == "__main__" else name)


def tail(path=None, lines: int = 40) -> str:
    """Последние строки журнала (для пункта меню «Показать журнал»)."""
    path = path or config.LOG_FILE
    try:
        content = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return f"(журнал ещё не создан: {path})"
    return "\n".join(content[-lines:])
