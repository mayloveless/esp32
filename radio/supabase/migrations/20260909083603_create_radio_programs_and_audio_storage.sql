-- Applied to Supabase project lhiojnqooreavzmkrzji on 2026-09-09.
-- Migration version: 20260909083603.
-- This is a historical copy of the already-applied migration. Do not apply it again.
create table public.radio_programs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued','generating','ready','failed')),
  format text not null check (format in ('news','chat','music')),
  title text not null default '',
  recipe jsonb not null default '{}'::jsonb check (jsonb_typeof(recipe) = 'object'),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  captions jsonb not null default '[]'::jsonb check (jsonb_typeof(captions) = 'array'),
  audio_path text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radio_programs_ready_audio check (status <> 'ready' or (audio_path is not null and length(audio_path) > 0))
);
create index radio_programs_created_at_idx on public.radio_programs (created_at desc);
create index radio_programs_status_created_at_idx on public.radio_programs (status, created_at desc);
alter table public.radio_programs enable row level security;
revoke all on table public.radio_programs from anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('radio-audio', 'radio-audio', false, 52428800, array['audio/mpeg','audio/wav','audio/ogg','audio/mp4','audio/aac']);
