/**
 * 生成 PBKDF2 密码哈希(Wrangler 种子脚本)。
 * 输出格式与 Worker 的 hashPassword 相同。
 * 使用: node scripts/hash-password.mjs <password>
 */
import { webcrypto } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await webcrypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const bits = await webcrypto.subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
  key,
  256,
);

function b64(u) {
  return btoa(String.fromCharCode(...u));
}

console.log(`pbkdf2$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`);