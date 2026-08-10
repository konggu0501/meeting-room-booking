create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time time not null,
  end_time time not null,
  department text not null,
  contact text,
  client_id text not null,
  created_at timestamptz not null default now(),
  constraint bookings_valid_time check (end_time > start_time)
);

alter table public.bookings enable row level security;

drop policy if exists "public can read bookings" on public.bookings;
create policy "public can read bookings" on public.bookings for select to anon using (true);

drop policy if exists "public can create bookings" on public.bookings;
create policy "public can create bookings" on public.bookings for insert to anon with check (true);

drop policy if exists "owners can cancel bookings" on public.bookings;
create policy "owners can cancel bookings" on public.bookings for delete to anon using (true);

grant select, insert, delete on public.bookings to anon;
