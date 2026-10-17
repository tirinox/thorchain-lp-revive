.DEFAULT_GOAL := help
SHELL := /bin/bash

C_RESET := \033[0m
C_BOLD  := \033[1m
C_GREEN := \033[38;5;48m
C_TEAL  := \033[38;5;44m
C_GRAY  := \033[38;5;245m
C_YELL  := \033[38;5;214m

say = @printf "$(C_GREEN)ᛞ$(C_RESET) $(C_BOLD)%s$(C_RESET)\n" "$(1)"

VENV := backend/.venv
PY   := $(VENV)/bin/python

##@ Помощь
help: ## Показать это меню
	@printf "\n$(C_GREEN)$(C_BOLD)ᛞ LP Revive$(C_RESET) $(C_GRAY)— THORChain LP break-even checker$(C_RESET)\n"
	@awk 'BEGIN {FS = ":.*##"} \
		/^##@/ { printf "\n$(C_YELL)%s$(C_RESET)\n", substr($$0, 5) } \
		/^[a-zA-Z_-]+:.*?##/ { printf "  $(C_TEAL)%-12s$(C_RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

##@ Локальная разработка
env: ## Создать .env из .env.example (если нет)
	@if [ -f .env ]; then printf "$(C_GRAY).env уже есть$(C_RESET)\n"; else cp .env.example .env && printf "$(C_GREEN)создан .env$(C_RESET) — впишите свои ноды\n"; fi

install: env ## Поставить зависимости бэка (uv) и фронта (npm)
	$(call say,backend deps)
	@[ -d $(VENV) ] || uv venv -q $(VENV)
	@uv pip install -q -p $(VENV) -r backend/requirements.txt
	$(call say,frontend deps)
	@cd frontend && npm install --silent

api: ## Запустить FastAPI-прокси на :8000 (с .env)
	$(call say,api → http://127.0.0.1:8000)
	@set -a; [ -f .env ] && . ./.env; set +a; cd backend && .venv/bin/uvicorn app:app --reload --port 8000

web: ## Запустить Vite dev-сервер на :5173
	$(call say,web → http://127.0.0.1:5173)
	@cd frontend && npm run dev -- --host 127.0.0.1

dev: ## API + фронт параллельно (Ctrl+C останавливает оба)
	@$(MAKE) --no-print-directory -j2 api web

test: ## Тесты: модель (node --test) и allowlist прокси
	$(call say,model tests)
	@cd frontend && npm test --silent
	$(call say,proxy tests)
	@cd backend && .venv/bin/python test_app.py

##@ Docker
build: ## Собрать образы
	$(call say,docker compose build)
	@docker compose build

up: ## Поднять всё в фоне
	@docker compose up -d --build
	@set -a; [ -f .env ] && . ./.env; set +a; printf "$(C_GREEN)готово:$(C_RESET) http://localhost:$${WEB_PORT:-8088}\n"

down: ## Остановить
	@docker compose down

restart: down up ## Перезапустить

logs: ## Логи (follow)
	@docker compose logs -f --tail=100

ps: ## Статус контейнеров
	@docker compose ps

##@ Уборка
clean: ## Удалить node_modules, dist, venv
	@rm -rf frontend/node_modules frontend/dist $(VENV)
	@printf "$(C_GRAY)чисто$(C_RESET)\n"

.PHONY: help env install api web dev test build up down restart logs ps clean
