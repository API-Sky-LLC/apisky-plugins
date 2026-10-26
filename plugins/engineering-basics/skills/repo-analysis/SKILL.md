---
name: repo-analysis
description: Разбор незнакомого репозитория — структура, стек, точки входа. Load before answering questions about an unfamiliar codebase.
---

# Repository analysis

1. Прочитай `README`, манифест пакета и скрипты (`Makefile`, `package.json`, `pyproject.toml`).
2. Найди точки входа: `main`, `index`, `bin`, конфиг фреймворка, docker-compose.
3. Составь карту модулей: что импортирует что, где циклы, где границы слоёв.
4. Перечисли, чего в репозитории нет: тестов, миграций, CI, линтера.

Отвечай списком файлов с путями (`src/app/main.ts:12`), а не пересказом.
