// 2.2.x 代码题"测试报告小作文"草稿 (de)serialization。
// 作文文本以 JSON 字符串存在 blanks_draft 的保留键里，复用现有草稿自动保存，
// 后端 _compute_blank_results 按数字下标取值，对该键天然忽略。
export const REPORT_DRAFT_KEY = '__report__';

export function parseReportDraft(blanks) {
  const raw = blanks && blanks[REPORT_DRAFT_KEY];
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch {
    return {};
  }
}

export function serializeReportDraft(sections) {
  const out = {};
  for (const [k, v] of Object.entries(sections || {})) {
    out[k] = (v === null || v === undefined) ? '' : String(v);
  }
  return JSON.stringify(out);
}
