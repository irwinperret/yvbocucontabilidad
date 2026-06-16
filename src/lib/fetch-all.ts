// Paginate through any Supabase query without the 1000-row default cap.
// Pass a factory that builds the query with the given .range(from, to).

export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Safety ceiling to avoid infinite loops in degenerate cases (10M rows).
  for (let i = 0; i < 10000; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await makeQuery(from, to);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
