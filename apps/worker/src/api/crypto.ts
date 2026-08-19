// ===== 加密与哈希(Web Crypto,Workers 原生支持) =====
import { b64decode, b64encode, b64encodeBytes } from "@panel/shared";

const PBKDF2_ITERATIONS = 100_000;

/** 生成密码哈希:pbkdf2$100000$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64encodeBytes(salt)}$${b64encodeBytes(new Uint8Array(bits))}`;
}

/** 校验密码 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = b64decodeBytes(parts[2]);
  const expected = b64decodeBytes(parts[3]);
  const bits = await pbkdf2(password, salt, iterations);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
}

function b64decodeBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ===== AES-GCM 对称加密(用于 SMTP 密码 / 外部 API Key) =====

async function getAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** 加密文本:v1:ivB64:cipherB64 */
export async function encryptText(secret: string, plain: string): Promise<string> {
  const key = await getAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return `v1:${b64encodeBytes(iv)}:${b64encodeBytes(new Uint8Array(cipher))}`;
}

/** 解密文本 */
export async function decryptText(secret: string, stored: string): Promise<string> {
  const [version, ivB64, cipherB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !cipherB64) throw new Error("加密数据格式无效");
  const key = await getAesKey(secret);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64decodeBytes(ivB64) as BufferSource,
    },
    key,
    b64decodeBytes(cipherB64) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export { b64encode };
