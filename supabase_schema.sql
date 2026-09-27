-- CJ'S COLLEGE TRACKER: SINGLE-FAMILY SECURE SCHEMA
-- Run this in Supabase > SQL Editor > New query.
-- IMPORTANT: After users exist in Authentication > Users, add each user's UUID
-- to public.family_members using the INSERT examples at the bottom.

create extension if not exists pgcrypto;

create table if not exists public.family_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_family_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members fm where fm.user_id = auth.uid()
  );
$$;

create table if not exists public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  interest_level int check (interest_level between 1 and 5),
  application_deadline date,
  intended_major text,
  location text,
  annual_cost numeric,
  scholarship_amount numeric,
  estimated_aid numeric,
  application_status text default 'Not Started',
  visit_status text default 'Not Scheduled',
  portal_url text,
  admissions_url text,
  notes text,
  ratings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_name text,
  status text not null default 'Not Started',
  category text,
  due_date date,
  priority text default 'Medium',
  notes text,
  college_id uuid references public.colleges(id) on delete set null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  body text not null,
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.recruiting_contacts (
  id uuid primary key default gen_random_uuid(),
  coach_name text not null,
  school_name text,
  college_id uuid references public.colleges(id) on delete set null,
  email text,
  phone text,
  questionnaire_url text,
  roster_url text,
  status text default 'Active',
  last_contact_date date,
  follow_up_date date,
  cj_benchmarks text,
  program_benchmarks text,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recruiting_interactions (
  id uuid primary key default gen_random_uuid(),
  recruiting_contact_id uuid not null references public.recruiting_contacts(id) on delete cascade,
  interaction_date date not null default current_date,
  interaction_type text,
  summary text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.scholarships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric,
  deadline date,
  owner_name text,
  status text default 'Not Started',
  eligibility text,
  requirements text,
  url text,
  college_id uuid references public.colleges(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

-- Update timestamps
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists set_colleges_updated_at on public.colleges;
create trigger set_colleges_updated_at before update on public.colleges for each row execute function public.set_updated_at();
drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists set_recruiting_updated_at on public.recruiting_contacts;
create trigger set_recruiting_updated_at before update on public.recruiting_contacts for each row execute function public.set_updated_at();
drop trigger if exists set_scholarships_updated_at on public.scholarships;
create trigger set_scholarships_updated_at before update on public.scholarships for each row execute function public.set_updated_at();

-- ROW LEVEL SECURITY
alter table public.family_members enable row level security;
alter table public.colleges enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.recruiting_contacts enable row level security;
alter table public.recruiting_interactions enable row level security;
alter table public.scholarships enable row level security;
alter table public.activity_log enable row level security;

-- Members may see their own membership row.
drop policy if exists "members read own row" on public.family_members;
create policy "members read own row" on public.family_members for select to authenticated using (user_id = auth.uid());

-- Equal permissions for all family members.
-- family_members itself is intentionally NOT editable from the browser.
do $$
declare t text;
begin
  foreach t in array array['colleges','tasks','task_comments','recruiting_contacts','recruiting_interactions','scholarships','activity_log']
  loop
    execute format('drop policy if exists "family select" on public.%I', t);
    execute format('drop policy if exists "family insert" on public.%I', t);
    execute format('drop policy if exists "family update" on public.%I', t);
    execute format('drop policy if exists "family delete" on public.%I', t);
    execute format('create policy "family select" on public.%I for select to authenticated using (public.is_family_member())', t);
    execute format('create policy "family insert" on public.%I for insert to authenticated with check (public.is_family_member())', t);
    execute format('create policy "family update" on public.%I for update to authenticated using (public.is_family_member()) with check (public.is_family_member())', t);
    execute format('create policy "family delete" on public.%I for delete to authenticated using (public.is_family_member())', t);
  end loop;
end $$;

-- Data API privileges. RLS still controls which rows are accessible.
grant usage on schema public to authenticated;
grant select on public.family_members to authenticated;
grant select, insert, update, delete on public.colleges to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_comments to authenticated;
grant select, insert, update, delete on public.recruiting_contacts to authenticated;
grant select, insert, update, delete on public.recruiting_interactions to authenticated;
grant select, insert, update, delete on public.scholarships to authenticated;
grant select, insert, update, delete on public.activity_log to authenticated;
grant execute on function public.is_family_member() to authenticated;

-- BOOTSTRAP EXAMPLES
-- After you invite/create accounts in Authentication > Users, copy each UUID and run:
-- insert into public.family_members (user_id, display_name) values
-- ('PASTE-LEONARD-UUID', 'Dad'),
-- ('PASTE-CJ-UUID', 'CJ'),
-- ('PASTE-KRISTEN-UUID', 'Kristen');
