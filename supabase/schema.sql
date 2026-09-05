-- 알림 구독 테이블 (CLAUDE.md 절대규칙 4 예외 항목)
--
-- 저장하는 값은 기한 계산 입력과 발송에 필요한 최소값뿐이다.
-- 이름·상속인 구성·미성년 여부·금액·기관·부채는 저장하지 않는다.
--
-- Supabase 대시보드 > SQL Editor 에 붙여 넣어 한 번 실행한다.

create table if not exists notification_subscriptions (
  case_id              text primary key,
  email                text        not null,
  death_date           date        not null,
  awareness_date       date,
  fss_application_date date,
  has_real_estate      boolean     not null default false,
  has_insurance        boolean     not null default false,
  -- 호칭('아버님'). 이름이 아니다.
  decedent_label       text        not null default '피상속인',
  unsubscribe_token    text        not null unique,
  -- 같은 날 두 번 보내지 않기 위한 표시
  last_sent_on         date,
  created_at           timestamptz not null default now()
);

create index if not exists notification_subscriptions_token_idx
  on notification_subscriptions (unsubscribe_token);

-- 이 테이블은 service_role 키를 쓰는 서버에서만 접근한다.
-- 익명 키로는 한 줄도 읽거나 쓸 수 없도록 RLS를 켜고 정책을 두지 않는다.
alter table notification_subscriptions enable row level security;

-- 서버(서비스 역할)에 이 테이블 권한을 명시적으로 준다.
--
-- SQL Editor로 만든 테이블은 기본 권한이 붙지 않는 경우가 있어 REST 요청이
-- 403 permission denied 로 막힌다. 이미 권한이 있으면 아무 일도 하지 않는다.
grant all privileges on table notification_subscriptions to service_role;

-- 익명 키로는 여전히 한 줄도 읽거나 쓸 수 없다(정책을 두지 않았다).
revoke all on table notification_subscriptions from anon, authenticated;
