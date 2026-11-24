@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ===== Установка окружения =====
echo.

rem --- ищем Python: сначала лаунчер py, затем python
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo [ОШИБКА] Python не найден. Установите Python 3 и отметьте галочку Add python.exe to PATH.
    pause
    exit /b 1
)

if not exist requirements.txt (
    echo [ОШИБКА] Рядом с установщиком нет файла requirements.txt.
    pause
    exit /b 1
)

rem --- создаём окружение, если его ещё нет
if not exist venv\Scripts\python.exe (
    echo Создаю окружение venv...
    %PY% -m venv venv
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось создать окружение.
        pause
        exit /b 1
    )
) else (
    echo Окружение venv уже существует, создание пропущено.
)

call venv\Scripts\activate.bat

echo.
echo Обновляю pip...
python -m pip install --upgrade pip

echo.
echo Устанавливаю зависимости из requirements.txt...
pip install -r requirements.txt
if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить зависимости.
    pause
    exit /b 1
)

rem --- если используется Playwright, ему нужен браузер
pip show playwright >nul 2>nul
if not errorlevel 1 (
    echo.
    echo Устанавливаю браузер для Playwright...
    python -m playwright install chromium
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось установить браузер для Playwright.
        pause
        exit /b 1
    )
)

echo.
echo ===== Готово. Запускайте приложение через start.bat =====
pause
endlocal
