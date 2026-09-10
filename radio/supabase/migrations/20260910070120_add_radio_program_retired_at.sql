alter table public.radio_programs
add column retired_at timestamptz null;

create index radio_programs_receiver_inventory_idx
on public.radio_programs (created_at desc)
where status = 'ready'
  and retired_at is null
  and audio_path is not null;
