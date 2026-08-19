// ===== 通用工具 =====

/** 邮箱格式校验(实用型,非完整 RFC) */
export function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(
    email,
  );
}

/** 邮箱规范化:去首尾空格 + 转小写 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** UTC 日期 YYYY-MM-DD */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 模板变量替换:{{name}} / {{ email }} */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/** 收件人可用的模板变量 */
export function recipientTemplateVars(r: {
  name?: string | null;
  email: string;
  remark?: string | null;
}): Record<string, string> {
  return {
    name: r.name ?? "",
    email: r.email,
    remark: r.remark ?? "",
    date: new Date().toISOString().slice(0, 10),
  };
}

/** 把数组按 size 切块 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 睡眠 ms 毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== CSV / 文本导入解析 =====

/**
 * 解析 CSV 文本为行列数组(支持引号包裹、逗号/制表符分隔)。
 */
export function parseCsvRows(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  // 最后一行
  row.push(cell.replace(/\r$/, ""));
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const sample = text.split("\n").slice(0, 5).join("\n");
  if (!sample.includes(",") && sample.includes("\t")) return "\t";
  return ",";
}

export interface ParsedRecipient {
  name: string | null;
  email: string;
  remark: string | null;
}

/**
 * 解析收件人导入文本:
 * - CSV(带表头 name,email,remark 或不带表头)
 * - 每行一个邮箱的纯文本
 */
export function parseRecipientsText(text: string): ParsedRecipient[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 纯邮箱列表模式:没有分隔符,每行一个邮箱
  const delimiter = detectDelimiter(trimmed);
  if (!trimmed.includes(delimiter) && !trimmed.includes('"')) {
    return trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((email) => ({ name: null, email, remark: null }));
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length === 0) return [];

  const header = rows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = header.includes("email") || header.includes("邮箱");
  const col = (name: string, fallback: number) => {
    const idx = header.indexOf(name);
    return idx >= 0 ? idx : fallback;
  };

  const emailIdx = hasHeader ? col("email", -1) : 0;
  if (emailIdx < 0) return [];
  const nameIdx = hasHeader ? header.indexOf("name") >= 0 ? header.indexOf("name") : header.indexOf("姓名") >= 0 ? header.indexOf("姓名") : -1 : rows[0].length >= 2 ? 1 : -1;
  const remarkIdx = hasHeader
    ? header.indexOf("remark") >= 0
      ? header.indexOf("remark")
      : header.indexOf("备注") >= 0
        ? header.indexOf("备注")
        : -1
    : rows[0].length >= 3
      ? 2
      : -1;

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const out: ParsedRecipient[] = [];
  for (const r of dataRows) {
    const email = (r[emailIdx] ?? "").trim();
    if (!email) continue;
    out.push({
      name: nameIdx >= 0 ? (r[nameIdx] ?? "").trim() || null : null,
      email,
      remark: remarkIdx >= 0 ? (r[remarkIdx] ?? "").trim() || null : null,
    });
  }
  return out;
}

/** 从邮箱地址提取默认姓名(user.name@example.com → user name) */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.replace(/[._\-+]+/g, " ").trim().slice(0, 64) || local.slice(0, 64);
}
