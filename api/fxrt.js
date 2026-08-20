/**
 * 환율 중계 (Vercel 서버리스 함수)
 *
 * 브라우저는 두 기관 API 를 직접 호출할 수 없다. CORS 가 막혀 있고,
 * 인증키를 정적 페이지에 넣으면 누구나 볼 수 있기 때문이다.
 * 이 함수가 서버에서 대신 호출하고, 키는 환경변수에만 머문다.
 *
 * 출처 두 가지
 *   1. 한국수출입은행 매매기준율 — 영업일마다 갱신. EXIM_KEY 필요.
 *   2. 관세청 관세환율        — 매주 일요일 고시. DATA_KEY 필요.
 *
 * EXIM_KEY 가 있으면 매매기준율을, 없으면 관세환율을 돌려준다.
 * 응답의 source 필드로 어느 쪽인지 구분한다.
 *
 *   GET /api/fxrt              기본 (매매기준율 우선)
 *   GET /api/fxrt?source=tariff  관세환율 강제
 *   GET /api/fxrt?type=1       관세환율의 수출 구분
 */

const EXIM_ENDPOINT =
  'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';
const TARIFF_ENDPOINT =
  'https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo';

/* ── 날짜 ─────────────────────────────────────────── */

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function daysBefore(yyyymmdd, n) {
  const y = +yyyymmdd.slice(0, 4);
  const m = +yyyymmdd.slice(4, 6) - 1;
  const d = +yyyymmdd.slice(6, 8);
  return ymd(new Date(y, m, d - n));
}

/** 기준일이 속한 주의 일요일 — 관세환율은 매주 일요일자로 고시된다 */
function weekStart(base) {
  const d = new Date(base);
  d.setDate(d.getDate() - d.getDay());
  return ymd(d);
}

function weeksBefore(yyyymmdd, n) {
  return weekStart(
    new Date(
      +yyyymmdd.slice(0, 4),
      +yyyymmdd.slice(4, 6) - 1,
      +yyyymmdd.slice(6, 8) - n * 7
    )
  );
}

/* ── 한국수출입은행 매매기준율 ─────────────────────── */

// 수출입은행은 통화 코드를 조금 다르게 쓴다.
//   JPY(100) = 100엔당,  CNH = 위안화
const EXIM_ALIAS = { 'JPY(100)': 'JPY', CNH: 'CNY' };
const PER_100 = { 'JPY(100)': true };

function toNumber(v) {
  return Number(String(v == null ? '' : v).replace(/,/g, ''));
}

async function fetchExim(key, date) {
  // 주말·공휴일에는 빈 배열이 오므로 최대 7일 거슬러 올라간다
  for (let i = 0; i <= 7; i++) {
    const target = i === 0 ? date : daysBefore(date, i);
    const res = await fetch(
      `${EXIM_ENDPOINT}?authkey=${key}&searchdate=${target}&data=AP01`
    );
    if (!res.ok) continue;

    let rows;
    try {
      rows = await res.json();
    } catch {
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;

    // result: 1=성공, 2=DATA코드 오류, 3=인증코드 오류, 4=일일제한 초과
    const bad = rows.find((r) => r && r.result && r.result !== 1);
    if (bad) {
      const reason =
        bad.result === 3
          ? 'EXIM_KEY 가 유효하지 않습니다.'
          : bad.result === 4
            ? '수출입은행 일일 호출 한도를 넘었습니다.'
            : `수출입은행 오류 (result=${bad.result})`;
      const err = new Error(reason);
      err.fatal = bad.result === 3;
      throw err;
    }

    const rates = rows
      .filter((r) => r && r.cur_unit)
      .map((r) => {
        const raw = r.cur_unit.trim();
        return {
          currency: EXIM_ALIAS[raw] || raw,
          unitName: r.cur_nm ? r.cur_nm.trim() : raw,
          rate: toNumber(r.deal_bas_r),
          per: PER_100[raw] ? 100 : 1
        };
      })
      .filter((r) => Number.isFinite(r.rate) && r.rate > 0);

    if (rates.length) return { source: 'exim', date: target, rates };
  }
  return null;
}

/* ── 관세청 관세환율 ───────────────────────────────── */

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1].trim() : '';
}

async function fetchTariff(key, start, type) {
  for (let i = 0; i <= 4; i++) {
    const target = i === 0 ? start : weeksBefore(start, i);
    const res = await fetch(
      `${TARIFF_ENDPOINT}?serviceKey=${key}&aplyBgnDt=${target}&weekFxrtTpcd=${type}`
    );
    const text = await res.text();

    if (/<errMsg>/.test(text)) throw new Error('관세청 오픈API 가 오류를 반환했습니다.');

    const code = tag(text, 'resultCode');
    if (code && code !== '00') throw new Error(`관세청 조회 실패 (${code})`);

    const rates = (text.match(/<item>[\s\S]*?<\/item>/g) || []).map((b) => ({
      currency: tag(b, 'currSgn'),
      unitName: tag(b, 'mtryUtNm'),
      rate: Number(tag(b, 'fxrt')),
      per: 1
    }));

    if (rates.length) return { source: 'tariff', date: target, type, rates };
  }
  return null;
}

/* ── 핸들러 ───────────────────────────────────────── */

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const today = ymd(new Date());
  const wantTariff = q.source === 'tariff';
  const eximKey = process.env.EXIM_KEY;
  const dataKey = process.env.DATA_KEY;

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');

  try {
    if (!wantTariff && eximKey) {
      const out = await fetchExim(eximKey, /^\d{8}$/.test(q.date || '') ? q.date : today);
      if (out) {
        res.status(200).json(out);
        return;
      }
    }

    if (!dataKey) {
      res.status(500).json({ error: '서버에 환율 인증키가 설정되지 않았습니다.' });
      return;
    }

    const start = /^\d{8}$/.test(q.date || '') ? q.date : weekStart(new Date());
    const out = await fetchTariff(dataKey, start, q.type === '1' ? '1' : '2');
    if (out) {
      // 매매기준율을 요청했는데 키가 없어 관세환율로 대체한 경우를 알려준다
      if (!wantTariff && !eximKey) out.fallback = 'EXIM_KEY 미설정';
      res.status(200).json(out);
      return;
    }

    res.status(404).json({ error: '고시된 환율을 찾지 못했습니다.' });
  } catch (e) {
    // 예외 메시지에 URL(=키)이 섞여 나가지 않도록 우리가 만든 문구만 내보낸다
    const safe = e && e.message && !/authkey|serviceKey/i.test(e.message)
      ? e.message
      : '환율 API 호출에 실패했습니다.';
    res.status(502).json({ error: safe });
  }
};
