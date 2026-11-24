import os
from playwright.sync_api import sync_playwright
from web_modules import auth
from library_repair.actions import Actions
import json
import time
import questionary
lecture_links = [
    "https://erp.vshp.online/material_sources?q=Базовый+английский+язык&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Конспект%3A&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=основы+бухгалтерского+учета&organization[]=4&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=дизайн+продукта+класса+люкс&organization[]=4&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Управление+инновациями&organization[]=4&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Углублённое+машинное+обучение+и+применение+искусственного+интеллекта&organization[]=4&section=&s=&l=&missed=1",
    "https://erp.vshp.online/material_sources?q=введение+в+программирование&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Теория+международных+отношений&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=международные+финансы&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=история+и+будущее+бизнеса&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=визуализация+данных&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Введение+в+системы+баз+данных&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=кейтеринг&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Business+Ethics&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Поведенческие+финансы+и+когнитивные+искажения&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Введение+в+искусственный+интеллект&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Виды+моделей+искусственного+интеллекта+и+особенности+применения&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Прикладные+области+применения+искусственного+интеллекта&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Инструменты+и+платформы+искусственного+интеллекта&section=&s=&l=",
    "https://erp.vshp.online/material_sources?q=Оценка+и+оптимизация+моделей+ИИ%3A+Метрики%2C+Практика+и+Этика&section=&s=&l=",
]
urls_edit = []
materials_input = "materials_input.json"
email = "v.gornostaev@siil.ch"
password = "bW6XynFFKUZVS86"


def block_heavy_resources(route):
    # Режем только то, что скриптам точно не нужно
    if route.request.resource_type in {"image", "media"}:
        route.abort()
    else:
        route.continue_()
def login(page, link):
    if "/login" in page.url or page.locator('input[type="password"]').is_visible():
        Actions.log(f"login: нужна авторизация (текущий url: {page.url}), вхожу как {email}")
        auth.Auth(email, password)._login(page)
        page.goto(link, wait_until="domcontentloaded") 
        print("Успешный вход:", page.url)
        Actions.log(f"login: успешный вход, перешёл на {page.url}")
def collect(lecture_links, urls_edit):
    Actions.log(f"collect: старт, поисковых ссылок: {len(lecture_links)}",start=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(accept_downloads=True)
        context.route("**/*", block_heavy_resources)
        page = context.new_page()
        Actions.log("collect: браузер запущен")
        # collecting urls
        for n, link in enumerate(lecture_links, start=1):
            Actions.log(f"collect: [{n}/{len(lecture_links)}] открываю {link}")
            page.goto(link, wait_until="commit")   # не ждём загрузку ресурсов

            login(page=page, link=link)

            found = Actions.getLinksForEdit(page)
            Actions.log(f"collect: [{n}/{len(lecture_links)}] найдено ссылок для правки: {len(found)}")
            for href in found:
                urls_edit.append(href)
                print(href)
        print(f"[FILES FOR EDIT]:{len(urls_edit)}")
        Actions.log(f"collect: всего ссылок для правки: {len(urls_edit)}")
        materials = []
        # collecting titles and file names fron urls
        for i, url in enumerate(urls_edit, start=1):
            Actions.log(f"collect: [{i}/{len(urls_edit)}] открываю {url}")
            page.goto(url, wait_until="commit")   # не ждём загрузку ресурсов
            login(page=page, link=url)

            material_source_file_name, material_source_title = Actions.getFileName(page=page)
            if material_source_file_name is None and material_source_title is None:
                Actions.log(f"collect: [{i}/{len(urls_edit)}] данные не получены: {url}", "WARN")
            materials.append({
                "material_source_file_name": material_source_file_name,
                "material_source_title": material_source_title,
                "url": url
                            })
            print(i)
        with open("materials_out.json", "w", encoding="utf-8") as f:
            json.dump(materials, f, ensure_ascii=False, indent=2)
        Actions.log(f"collect: записано {len(materials)} материалов в materials_out.json")
        browser.close()
        Actions.log("collect: браузер закрыт, готово")


def exchange_files(file_data):
    Actions.log("exchange_files: старт, читаю materials_out.json",start=True)
    with open(file_data, "r", encoding="utf-8") as f:
        materials = json.load(f)
    if not materials:
        Actions.log(f"Файл пуст","ERROR")
        return
    Actions.log(f"exchange_files: прочитано материалов: {len(materials)}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(accept_downloads=True)
        context.route("**/*", block_heavy_resources)
        page = context.new_page()
        Actions.log("exchange_files: браузер запущен")
        for m in materials:
            file_path = m["file_path"]
            url = m["url"]
            Actions.log(f"exchange_files: открываю {url}, файл для загрузки: {file_path}")
            page.goto(url, wait_until="commit")   # не ждём загрузку ресурсов
            
            login(page=page, link=url)

            ok = Actions.setFile(page, file_path)
            Actions.log(f"exchange_files: результат загрузки: {ok} ({url})", "INFO" if ok else "ERROR")
        browser.close()
        Actions.log("collect: браузер закрыт, готово")
def scan_library(link):
    Actions.log("scan_library: старт, читаю materials_out.json", start=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        context.route("**/*", block_heavy_resources)
        page = context.new_page()
        Actions.log("exchange_files: браузер запущен")
        page.goto(link, wait_until="commit")
        countP = 1
        while True:
            login(page=page, link=link)
            found = Actions.getLinksForEdit(page)
            Actions.log(f"collect: [{countP}/{len(lecture_links)}] найдено ссылок для правки: {len(found)}")
            countP += 1
            for href in found:
                urls_edit.append(href)
                print(href)
            status = Actions.goToNextPage(page=page)
            if status == False:
                break                     # было return — иначе JSON не запишется

    

        # --- собираем JSON: каждая ссылка + сколько раз встретилась ---
        from collections import Counter
        counts = Counter(urls_edit)           # dict: url -> сколько раз

        links = []
        for url, cnt in counts.items():
            links.append({
                "url":   url,
                "count": cnt,
            })

        result = {
            "count":  len(links),             # сколько уникальных ссылок
            "total":  len(urls_edit),         # сколько всего вхождений
            "links":  links,                  # все ссылки с количеством
        }

        with open("library_out.json", "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        Actions.log(f"scan_library: сохранено {len(links)} уникальных ссылок")
        Actions.log(f"collect: всего ссылок для правки: {len(urls_edit)}")
        materials = []
        answer = questionary.select(
            "[TASK COMPLITE]: what to do next?",
            choices=[
                "collect all files",
                "<=== go back",
            ],
        ).ask()
        if answer == "collect all files":
            pass
        else: 
            return
        # collecting titles and file names fron urls
        for i, url in enumerate(urls_edit, start=1):
            Actions.log(f"collect: [{i}/{len(urls_edit)}] открываю {url}")
            page.goto(url, wait_until="commit")   # не ждём загрузку ресурсов
            login(page=page, link=url)
            material_source_file_name, material_source_title = Actions.getFileName(page=page)
            if material_source_file_name is None and material_source_title is None:
                Actions.log(f"collect: [{i}/{len(urls_edit)}] данные не получены: {url}", "WARN")
            materials.append({
                "material_source_file_name": material_source_file_name,
                "material_source_title": material_source_title,
                "url": url
                            })
            print(i)
        with open("materials_out.json", "w", encoding="utf-8") as f:
            json.dump(materials, f, ensure_ascii=False, indent=2)
        Actions.log(f"collect: записано {len(materials)} материалов в materials_out.json")
    browser.close()
    Actions.log("collect: браузер закрыт, готово")
    return result


if __name__ == '__main__':
    while True:
        answer = questionary.select(
            "[SELECT OPTION]",
            choices=[
                "collect urls",
                "exchange files",
                "scan_library",
                "exit",
            ],
        ).ask()

        if answer == "collect urls":
            collect(lecture_links, urls_edit)
        elif answer == "exchange files":
            exchange_files(materials_input)
        elif answer == "scan_library":
            scan_library(link="https://erp.vshp.online/material_sources")
        else:               # exit или Ctrl+C (тогда ask() вернёт None)
            break