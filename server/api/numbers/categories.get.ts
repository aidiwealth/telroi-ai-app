// GET /api/numbers/categories
//
// What a number may be declared for, and which of those need the indemnity.
// Served rather than shipped in each client: a copy in an app is a copy that
// can drift, and a client holding six categories when the server knows seven
// would skip the indemnity for the seventh without anybody noticing.
import { requireTenant } from '~/server/utils/api';
import { USE_CATEGORIES } from '~/server/utils/number-categories';

export default defineEventHandler(async (event) => {
  await requireTenant(event);
  return { categories: USE_CATEGORIES };
});
