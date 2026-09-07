-- Kjør denne i Supabase SQL Editor (én gang)

create extension if not exists "uuid-ossp";

create table if not exists visits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null default auth.uid(),
  customer text,
  date timestamptz,
  location text,
  tekniker text,
  status text default 'planlagt',
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default uuid_generate_v4(),
  visit_id uuid not null references visits(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  text text,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default uuid_generate_v4(),
  visit_id uuid not null references visits(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  storage_path text not null,
  caption text,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audio_clips (
  id uuid primary key default uuid_generate_v4(),
  visit_id uuid not null references visits(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  storage_path text not null,
  duration int,
  label text,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table visits enable row level security;
alter table notes enable row level security;
alter table photos enable row level security;
alter table audio_clips enable row level security;

drop policy if exists "own visits" on visits;
create policy "own visits" on visits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own notes" on notes;
create policy "own notes" on notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own photos" on photos;
create policy "own photos" on photos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own audio" on audio_clips;
create policy "own audio" on audio_clips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "own media read" on storage.objects;
create policy "own media read" on storage.objects for select
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own media write" on storage.objects;
create policy "own media write" on storage.objects for insert
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own media delete" on storage.objects;
create policy "own media delete" on storage.objects for delete
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
