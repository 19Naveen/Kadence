from celery import Celery
from core.config import settings

celery_app = Celery(
    "Kadence",
    broker=settings.RABBITMQ_URL,
    backend="rpc://",
    include=["modules.ingestion.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
)
