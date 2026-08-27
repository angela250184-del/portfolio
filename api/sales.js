/**
 * 매출 데이터 조회 (로그인 필요)
 *
 * Supabase 관리자 키는 이 함수 안에서만 쓰이고 브라우저로 나가지 않는다.
 * 쿠키 검사를 통과하지 못하면 데이터를 한 줄도 내보내지 않는다.
 *
 *   GET /api/sales
 */

const auth = require('./_auth');

const COLUMNS = [
  'source_file',
  'period',
  'company_code',
  'posting_date',
  'document_date',
  'gl_account',
  'document_type',
  'document_number',
  'material',
  'quantity',
  'amount_local',
  'local_currency',
  'amount_doc',
  'document_currency',
  'plant',
  'item_text',
  'reference',
  'customer_code',
  'customer_name'
].join(',');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!auth.isAuthorized(req)) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: '서버에 데이터베이스 설정이 없습니다.' });
    return;
  }

  try {
    const rows = [];
    const PAGE = 1000;

    // PostgREST 는 한 번에 돌려주는 행 수에 상한이 있으므로 나눠서 받는다
    for (let from = 0; ; from += PAGE) {
      const r = await fetch(
        `${url}/rest/v1/fbl3n_sales?select=${COLUMNS}&order=posting_date.asc,document_number.asc`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Range: `${from}-${from + PAGE - 1}`,
            'Range-Unit': 'items'
          }
        }
      );
      if (!r.ok) {
        res.status(502).json({ error: '데이터베이스 조회에 실패했습니다.' });
        return;
      }
      const chunk = await r.json();
      rows.push(...chunk);
      if (chunk.length < PAGE) break;
      if (rows.length > 50000) break; // 안전장치
    }

    res.status(200).json({ count: rows.length, rows });
  } catch {
    res.status(502).json({ error: '데이터베이스 조회 중 오류가 발생했습니다.' });
  }
};
