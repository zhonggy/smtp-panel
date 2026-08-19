// ===== 通用编码工具(base64,浏览器与 Workers 通用) =====

/** UTF-8 字符串 → base64 */
export function b64encode(str: string): string {
  return b64encodeBytes(new TextEncoder().encode(str));
}

/** Uint8Array → base64 */
export function b64encodeBytes(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → UTF-8 字符串 */
export function b64decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** URL-safe 随机 token */
export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return b64encodeBytes(bytes).replace(/[+/=]/g, "").slice(0, length * 1.5);
}
