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
DATA_DIR = BASE_DIR / "data"
LIBRARY_DIR = DATA_DIR / "library"
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
def ensure_directories():
    for directory in [DATA_DIR, LIBRARY_DIR]:
        if not directory.exists():
            directory.mkdir(parents=True, exist_ok=True)

# Подключённые приложения. Команда "flask startapp" дописывает сюда сама.
INSTALLED_APPS = [
    "apps.main",
    "apps.frontend",
]

CORS_ALLOWED_ORIGINS = [
    '*'
]
