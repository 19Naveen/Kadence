import { AuthSession } from "./types";

const COOKIE_NAME = "Kadence.session";
// 7-day expiry matches a typical "remember me" window
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

function setCookie(name: string, value: string, maxAge: number): void {
  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    `Path=/`,
    `SameSite=Strict`,
    // Uncomment when served over HTTPS:
    // `Secure`,
  ].join("; ");
}

function getCookie(name: string): string | null {
  const key = encodeURIComponent(name) + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trimStart();
    if (trimmed.startsWith(key)) {
      return decodeURIComponent(trimmed.slice(key.length));
    }
  }
  return null;
}

function deleteCookie(name: string): void {
  setCookie(name, "", 0);
}

export function readSession(): AuthSession | null {
  const raw = getCookie(COOKIE_NAME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    deleteCookie(COOKIE_NAME);
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  setCookie(COOKIE_NAME, JSON.stringify(session), COOKIE_MAX_AGE);
}

export function clearSession(): void {
  deleteCookie(COOKIE_NAME);
}
