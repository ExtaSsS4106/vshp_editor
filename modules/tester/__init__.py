"""Заливка вопросов в тесты ERP: движки + сценарии."""

from __future__ import annotations

from .beta import BetaActions
from .release import Actions, VerifyError, norm

ENGINES: dict[str, type[Actions]] = {
    "release": Actions,          # стабильный: ждёт CKEditor и навигацию
    "beta": BetaActions,         # быстрый: та же логика, ускоренная навигация
}

ENGINE_CHOICES = [
    ("release — стабильный (жёсткие ожидания)", "release"),
    ("beta — быстрый (та же проверка, commit-навигация)", "beta"),
]

__all__ = ["Actions", "BetaActions", "ENGINES", "ENGINE_CHOICES", "VerifyError", "norm"]
