@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo [ОШИБКА] Окружение не найдено. Сначала запустите install.bat.
    pause
    exit /b 1
)

rem русские символы в логах консоли
set PYTHONUTF8=1

call venv\Scripts\activate.bat

echo Запускаю приложение...
python run.py
set "CODE=%errorlevel%"

if not "%CODE%"=="0" (
    echo.
    echo Приложение завершилось с кодом %CODE%.
    pause
)
exit /b %CODE%
