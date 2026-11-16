-- who-we 数据库结构（用于 Supabase 新项目重建）
-- 在 Supabase Dashboard → SQL Editor 里整段执行即可
-- 说明：服务端使用 service_role 访问，无需 RLS 策略；为安全起见启用 RLS（service_role 会绕过）

create extension if not exists "pgcrypto";

-- 用户表
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  password_hash text not null,
  name text,
  settings jsonb,
  created_at timestamptz not null default now()
);

-- 登录会话（HttpOnly Cookie 里的 token 存这里，可随时吊销）
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_token_idx on public.sessions(token);
create index if not exists sessions_user_idx on public.sessions(user_id);

-- 对话记录（每账号一条会话，session_id 唯一）
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  user_id uuid references public.users(id) on delete cascade,
  messages jsonb,
  current_module text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.conversations(user_id);

-- 登录/注册尝试记录（限流防暴力破解）
create table if not exists public.auth_attempts (
  id bigserial primary key,
  ip text,
  phone text,
  action text,
  success boolean,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_ip_idx on public.auth_attempts(ip, action, success, created_at);

-- 开启 RLS（服务端用 service_role，不受影响；防止匿名 key 被滥用）
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.auth_attempts enable row level security;
