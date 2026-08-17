import { clearAdminSession } from '~/server/utils/session';
export default defineEventHandler(async (event) => { await clearAdminSession(event); return { ok: true }; });
