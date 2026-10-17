"""Symmetric encryption helper for secrets stored at rest (e.g. DB source passwords).

Uses Fernet (AES-128-CBC + HMAC) keyed by ``settings.CREDENTIALS_ENCRYPTION_KEY``.
Requires the ``cryptography`` package.
"""

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings

_fernet = Fernet(settings.CREDENTIALS_ENCRYPTION_KEY)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext string, returning a url-safe token string."""
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    """Decrypt a token produced by :func:`encrypt_secret`.

    Raises ``cryptography.fernet.InvalidToken`` if the token is malformed or the
    key doesn't match.
    """
    return _fernet.decrypt(token.encode("utf-8")).decode("utf-8")


__all__ = ["encrypt_secret", "decrypt_secret", "InvalidToken"]
