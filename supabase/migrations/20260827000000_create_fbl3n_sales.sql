-- SAP FBL3N 매출 전표 내역을 담는 표
--
-- 월별 엑셀(106_fbl3n_HQ_매출 N월.XLSX)을 계속 쌓아 비교하기 위한 것이다.
-- 같은 파일을 다시 넣을 때는 source_file 기준으로 지우고 다시 넣으면 된다.

create table if not exists public.fbl3n_sales (
  id                bigint generated always as identity primary key,

  -- 어느 파일에서 왔는지 (재수입 시 이 값으로 지운다)
  source_file       text not null,
  period            text not null,          -- 예: '2026-07'

  company_code      text,
  entry_date        date,
  posting_date      date,
  document_date     date,
  gl_account        text,
  document_type     text,
  document_number   text,
  tax_code          text,
  material          text,
  quantity          numeric,
  amount_local      numeric,                -- Amount in local currency
  local_currency    text,
  amount_doc        numeric,                -- Amount in doc. curr.
  document_currency text,
  plant             text,
  cost_center       text,
  item_text         text,                   -- 원본 열 이름은 Text
  reference         text,
  reversed_with     text,
  order_no          text,                   -- 원본 열 이름은 Order (예약어라 변경)
  customer_code     text,
  customer_name     text,
  vendor_code       text,
  vendor_name       text,
  clearing_date     date,
  clearing_document text,

  created_at        timestamptz not null default now()
);

comment on table public.fbl3n_sales is 'SAP FBL3N 매출 전표 내역 (월별 누적)';

create index if not exists fbl3n_sales_period_idx        on public.fbl3n_sales (period);
create index if not exists fbl3n_sales_source_file_idx   on public.fbl3n_sales (source_file);
create index if not exists fbl3n_sales_posting_date_idx  on public.fbl3n_sales (posting_date);
create index if not exists fbl3n_sales_customer_idx      on public.fbl3n_sales (customer_code);
create index if not exists fbl3n_sales_material_idx      on public.fbl3n_sales (material);

-- ── 접근 차단 ──────────────────────────────────────────
-- 회사 내부 재무 데이터이므로 기본적으로 아무도 읽지 못하게 한다.
-- RLS 를 켜고 정책을 하나도 만들지 않으면, anon/authenticated 키로는
-- 조회도 입력도 불가능하다. 관리자(service_role)만 접근할 수 있다.
alter table public.fbl3n_sales enable row level security;
alter table public.fbl3n_sales force row level security;

-- 공개 API(PostgREST)에서 이 표에 대한 권한 자체를 회수한다.
revoke all on public.fbl3n_sales from anon, authenticated;
