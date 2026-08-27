-- FBL3N 추출 화면에 따라 'Cleared/open items symbol' 열이 포함되는 경우가 있다.
-- (예: 1-5월 humax 용역매출.xlsx) 없는 파일도 있으므로 null 을 허용한다.

alter table public.fbl3n_sales
  add column if not exists cleared_open_symbol text;

comment on column public.fbl3n_sales.cleared_open_symbol is 'FBL3N의 Cleared/open items symbol (미결/반제 표시)';
