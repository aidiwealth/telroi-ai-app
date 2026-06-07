// GET /api/policy -> the current policy version + sections for the in-app reader.
import { POLICY_VERSION, POLICY_TITLE, POLICY_SECTIONS } from '~/server/utils/policy';
export default defineEventHandler(() => {
  return { version: POLICY_VERSION, title: POLICY_TITLE, sections: POLICY_SECTIONS };
});
