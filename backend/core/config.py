from pydantic import Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    JWT_SECRET: str = Field(..., env="JWT_SECRET")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(..., env="ACCESS_TOKEN_EXPIRE_MINUTES")
    TOKEN_ISSUER: str = "knowledge-representation-api"
    TOKEN_AUDIENCE: str = "knowledge-representation-frontend"
    DATABASE_URL: str = Field(..., env="DATABASE_URL")
    LOG_LEVEL: str = "info" 
    MINIO_ENDPOINT: str = Field(..., env="MINIO_ENDPOINT")
    MINIO_ACCESS_KEY: str = Field(..., env="MINIO_ACCESS_KEY")
    MINIO_SECRET_KEY: str = Field(..., env="MINIO_SECRET_KEY")
    RABBITMQ_URL: str = Field(..., env="RABBITMQ_URL")
    CREDENTIALS_ENCRYPTION_KEY: str = Field(..., env="CREDENTIALS_ENCRYPTION_KEY")
    # Staging files larger than this (bytes) use the streaming DuckDB transform
    # engine instead of the in-memory pandas engine. Default 500 MiB.
    TRANSFORM_ENGINE_THRESHOLD_BYTES: int = 524288000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()