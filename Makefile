.PHONY: run docker-up docker-down backend frontend help

help:
	@echo "Available targets:"
	@echo "  make run           - Start docker, backend, and frontend"
	@echo "  make docker-up     - Start docker containers only"
	@echo "  make docker-down   - Stop docker containers"
	@echo "  make backend       - Start backend server only"
	@echo "  make frontend      - Start frontend dev server only"

run: docker-up
	@echo "Applying database migrations..."
	cd backend && uv run alembic upgrade head
	@echo "Starting backend, celery worker, and frontend... (Ctrl+C to stop all)"
	@trap 'kill 0; docker compose down' INT TERM; \
	(cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload 2>&1 | sed "s/^/[backend]  /") & \
	(cd backend && uv run celery -A celery_app worker --loglevel=info 2>&1 | sed "s/^/[celery]   /") & \
	(cd frontend && npm run dev 2>&1 | sed "s/^/[frontend] /") & \
	wait

docker-up:
	@echo "Starting Docker services and waiting for healthchecks..."
	-docker compose down 2>/dev/null
	docker compose up -d --wait --wait-timeout 60
	@echo "Docker services ready"

docker-down:
	@echo "Stopping Docker services..."
	docker compose down
	@echo "Docker services stopped"

backend: docker-up
	@echo "Applying database migrations..."
	cd backend && uv run alembic upgrade head
	@echo "Starting backend server and celery worker... (Ctrl+C to stop all)"
	@trap 'kill 0; docker compose down' INT TERM; \
	(cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload 2>&1 | sed "s/^/[backend] /") & \
	(cd backend && uv run celery -A celery_app worker --loglevel=info 2>&1 | sed "s/^/[celery]  /") & \
	wait

frontend:
	@echo "Starting frontend dev server..."
	cd frontend && npm run dev
