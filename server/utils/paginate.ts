// server/utils/paginate.ts
// One way of paging a list, so thirty-four tables don't each invent their own.
//
// Offset paging rather than cursors: these are lists somebody reads and audits,
// where "812 entries" and "page 3" are the useful facts. A cursor is better for
// an infinite stream and worse for everything here.
import type { H3Event } from 'h3';

export const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

export interface PageParams { page: number; perPage: number; limit: number; offset: number; }

/** Read page and perPage from the query, bounded so a hand-written URL can't
 *  ask for a million rows. */
export function pageParams(event: H3Event, fallbackPerPage = DEFAULT_PER_PAGE): PageParams {
  const q = getQuery(event);
  const page = Math.max(1, Number(q.page) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(q.perPage) || fallbackPerPage));
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}

/** The envelope every paged endpoint returns.
 *
 *  total is what makes this worth the trouble: a list that can only say "here
 *  are fifty" leaves you unable to tell a quiet week from a broken query. */
export function paged<T>(items: T[], total: number, p: PageParams) {
  return {
    items,
    total,
    page: p.page,
    perPage: p.perPage,
    pages: Math.max(1, Math.ceil(total / p.perPage))
  };
}
