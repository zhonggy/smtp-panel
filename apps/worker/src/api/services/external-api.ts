/**
 * 对外 API 调用服务
 * 对接 outlookEmail 项目的 /api/external/accounts 接口
 */

export interface ExternalAccount {
  id: number;
  email: string;
  status: string;
  group_name?: string | null;
  remark?: string | null;
  aliases?: string[];
}

export interface ExternalFetchOptions {
  baseUrl: string;
  apiKey: string;
  groupId?: number;
  tagIds?: string;
  maxTotal?: number;
  onlyActive?: boolean;
}

export interface ExternalFetchResult {
  accounts: ExternalAccount[];
  total: number;
  pages: number;
  truncated: boolean;
}

/**
 * 分页拉取外部账号,最多 40 页 × 250 = 10000 条
 */
export async function fetchExternalAccounts(
  opts: ExternalFetchOptions,
): Promise<ExternalFetchResult> {
  const { baseUrl, apiKey, groupId, tagIds, maxTotal = 1000 } = opts;
  const pageSize = 250;
  const maxPages = 40;
  const all: ExternalAccount[] = [];
  let offset = 0;
  let pages = 0;
  let total = 0;

  for (let i = 0; i < maxPages; i++) {
    const url = new URL("/api/external/accounts", baseUrl);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    if (groupId) url.searchParams.set("group_id", String(groupId));
    if (tagIds) url.searchParams.set("tag_ids", tagIds);

    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`外部 API 返回 HTTP ${res.status}`);
    }
    const data: any = await res.json();
    if (data.success === false) {
      const errMsg = data.error?.message || data.error || "外部 API 返回失败";
      throw new Error(errMsg);
    }
    const list: any[] = data.accounts ?? [];
    total = data.total ?? 0;
    for (const a of list) {
      all.push({
        id: a.id,
        email: a.email,
        status: a.status ?? "active",
        group_name: a.group_name ?? null,
        remark: a.remark ?? null,
        aliases: a.aliases ?? [],
      });
    }
    offset += list.length;
    pages++;
    if (list.length < pageSize) break;
    if (total > 0 && offset >= total) break;
    if (all.length >= maxTotal) break;
  }

  return {
    accounts: all.slice(0, maxTotal),
    total,
    pages,
    truncated: pages >= maxPages && all.length < total,
  };
}