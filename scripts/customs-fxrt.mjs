/**
 * 관세청 관세환율정보 (공공데이터포털)
 *
 *   서비스  https://www.data.go.kr/data/15101230/openapi.do
 *   엔드포인트  https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo
 *
 * 필수 요청변수
 *   serviceKey    인증키 (.env 의 DATA_KEY)
 *   aplyBgnDt     적용시작일자 YYYYMMDD — 관세환율은 매주 일요일자로 고시된다
 *   weekFxrtTpcd  1=수출, 2=수입
 *
 * 사용 예
 *   node scripts/customs-fxrt.mjs                  이번 주 수입환율
 *   node scripts/customs-fxrt.mjs --type=1         이번 주 수출환율
 *   node scripts/customs-fxrt.mjs --date=20260816  특정 주차
 *   node scripts/customs-fxrt.mjs --json           JSON 으로 출력
 *   node scripts/customs-fxrt.mjs --currency=USD,JPY,EUR
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENDPOINT =
  'https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo';

/** .env 를 읽어 키/값 객체로 돌려준다. 값에 = 가 들어 있어도 안전하다. */
export function loadEnv(path) {
  const file = path || join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`.env 를 읽을 수 없습니다: ${file}`);
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** 기준일이 속한 주의 일요일을 YYYYMMDD 로 돌려준다. */
export function weekStart(base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() - d.getDay());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** YYYYMMDD 에서 n주 전 날짜 */
function weeksBefore(yyyymmdd, n) {
  const y = +yyyymmdd.slice(0, 4);
  const m = +yyyymmdd.slice(4, 6) - 1;
  const d = +yyyymmdd.slice(6, 8);
  return weekStart(new Date(y, m, d - n * 7));
}

/** 응답 XML 에서 필요한 필드만 뽑는다. 의존성 없이 쓰려고 정규식으로 처리한다. */
function parseItems(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const pick = (block, tag) => {
    const m = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
    return m ? m[1].trim() : '';
  };
  return items.map((b) => ({
    aplyBgnDt: pick(b, 'aplyBgnDt'),
    country: pick(b, 'cntySgn'),
    currency: pick(b, 'currSgn'),
    unitName: pick(b, 'mtryUtNm'),
    rate: Number(pick(b, 'fxrt')),
    imexTp: pick(b, 'imexTp')
  }));
}

/**
 * 관세환율을 조회한다.
 *
 * @param {object} opts
 * @param {string}  opts.serviceKey  인코딩된 인증키
 * @param {string} [opts.date]       적용시작일자 YYYYMMDD (기본: 이번 주 일요일)
 * @param {'1'|'2'} [opts.type]      1=수출, 2=수입 (기본: 2)
 * @param {number} [opts.fallbackWeeks]  데이터가 없을 때 거슬러 올라갈 주 수 (기본: 4)
 * @returns {Promise<{date: string, type: string, rates: Array}>}
 */
export async function fetchRates(opts) {
  const key = opts.serviceKey;
  if (!key) throw new Error('serviceKey 가 없습니다. .env 의 DATA_KEY 를 확인하세요.');

  const type = opts.type ?? '2';
  const back = opts.fallbackWeeks ?? 4;
  let date = opts.date ?? weekStart();

  for (let i = 0; i <= back; i++) {
    const target = i === 0 ? date : weeksBefore(date, i);
    // 인증키는 이미 URL 인코딩된 값이므로 다시 인코딩하지 않는다
    const url =
      `${ENDPOINT}?serviceKey=${key}` +
      `&aplyBgnDt=${target}&weekFxrtTpcd=${type}`;

    const res = await fetch(url);
    const text = await res.text();

    const svcErr = text.match(/<errMsg>([\s\S]*?)<\/errMsg>/);
    if (svcErr) {
      const reason = (text.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/) || [])[1];
      throw new Error(`오픈API 오류: ${svcErr[1]}${reason ? ' — ' + reason : ''}`);
    }

    const code = (text.match(/<resultCode>([\s\S]*?)<\/resultCode>/) || [])[1];
    const msg = (text.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/) || [])[1];
    if (code && code !== '00') throw new Error(`조회 실패 (${code}): ${msg ?? '사유 없음'}`);

    const rates = parseItems(text);
    if (rates.length) return { date: target, type, rates };
  }

  throw new Error(`최근 ${back + 1}주 안에 고시된 환율이 없습니다.`);
}

/* ── CLI ─────────────────────────────────────────────── */

function isMain() {
  return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
}

if (isMain()) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const asJson = process.argv.includes('--json');
  const only = arg('currency', '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    const env = loadEnv();
    const result = await fetchRates({
      serviceKey: env.DATA_KEY,
      date: arg('date', undefined),
      type: arg('type', '2')
    });

    let rows = result.rates;
    if (only.length) rows = rows.filter((r) => only.includes(r.currency));

    if (asJson) {
      console.log(JSON.stringify({ ...result, rates: rows }, null, 2));
    } else {
      const label = result.type === '1' ? '수출' : '수입';
      console.log(`관세환율 ${label} · 적용시작일 ${result.date} · ${rows.length}건\n`);
      console.log('통화   국가  환율          화폐단위');
      console.log('─'.repeat(52));
      for (const r of rows) {
        console.log(
          `${r.currency.padEnd(6)} ${r.country.padEnd(5)} ` +
            `${String(r.rate).padStart(10)}  ${r.unitName}`
        );
      }
    }
  } catch (e) {
    console.error(`오류: ${e.message}`);
    process.exit(1);
  }
}
