/**
 * 관세청 관세환율정보 중계 (Vercel 서버리스 함수)
 *
 * 브라우저는 data.go.kr 을 직접 호출할 수 없다. CORS 가 막혀 있고,
 * 인증키를 정적 페이지에 넣으면 누구나 볼 수 있기 때문이다.
 * 이 함수가 서버에서 대신 호출하고, 키는 환경변수 DATA_KEY 에만 머문다.
 *
 *   GET /api/fxrt              이번 주 수입환율
 *   GET /api/fxrt?type=1       수출환율
 *   GET /api/fxrt?date=20260816
 */

const ENDPOINT =
  'https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo';

/** 기준일이 속한 주의 일요일 — 관세환율은 매주 일요일자로 고시된다 */
function weekStart(base) {
  const d = new Date(base);
  d.setDate(d.getDate() - d.getDay());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function weeksBefore(yyyymmdd, n) {
  const y = +yyyymmdd.slice(0, 4);
  const m = +yyyymmdd.slice(4, 6) - 1;
  const d = +yyyymmdd.slice(6, 8);
  return weekStart(new Date(y, m, d - n * 7));
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1].trim() : '';
}

function parseItems(xml) {
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((b) => ({
    aplyBgnDt: tag(b, 'aplyBgnDt'),
    country: tag(b, 'cntySgn'),
    currency: tag(b, 'currSgn'),
    unitName: tag(b, 'mtryUtNm'),
    rate: Number(tag(b, 'fxrt'))
  }));
}

module.exports = async function handler(req, res) {
  const key = process.env.DATA_KEY;
  if (!key) {
    res.status(500).json({ error: '서버에 DATA_KEY 가 설정되지 않았습니다.' });
    return;
  }

  const q = req.query || {};
  const type = q.type === '1' ? '1' : '2';
  const start = /^\d{8}$/.test(q.date || '') ? q.date : weekStart(new Date());

  try {
    // 이번 주 고시가 아직 없을 수 있으므로 최대 4주 전까지 거슬러 찾는다
    for (let i = 0; i <= 4; i++) {
      const target = i === 0 ? start : weeksBefore(start, i);
      const url =
        `${ENDPOINT}?serviceKey=${key}&aplyBgnDt=${target}&weekFxrtTpcd=${type}`;

      const upstream = await fetch(url);
      const text = await upstream.text();

      // 오픈API 게이트웨이 수준의 오류 (경로/키 문제)
      if (/<errMsg>/.test(text)) {
        res.status(502).json({ error: '관세청 오픈API 가 오류를 반환했습니다.' });
        return;
      }

      const code = tag(text, 'resultCode');
      if (code && code !== '00') {
        res.status(502).json({ error: `조회 실패 (${code})` });
        return;
      }

      const rates = parseItems(text);
      if (rates.length) {
        // 주 단위로 갱신되는 값이라 캐시를 넉넉히 둔다
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        res.status(200).json({ date: target, type, rates });
        return;
      }
    }

    res.status(404).json({ error: '최근 5주 안에 고시된 환율이 없습니다.' });
  } catch {
    // 예외 메시지에 URL(=키)이 섞여 나가지 않도록 고정 문구만 돌려준다
    res.status(502).json({ error: '관세청 API 호출에 실패했습니다.' });
  }
};
