-- plain-reads: shared comments for the annotated pages.
--
-- Run once in the Supabase SQL Editor. Safe to run again.
--
-- Model: anyone can read comments. Writing goes only through the three
-- plain_reads_* functions below; the tables themselves accept no direct
-- insert, update or delete from the API. Each browser keeps a random secret;
-- only its hash is stored, and it is what lets an author edit or delete
-- their own comment later.

create table if not exists public.plain_reads_comments (
  id uuid primary key default gen_random_uuid(),
  page text not null check (char_length(page) between 1 and 200),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  quote text not null check (char_length(quote) between 1 and 4000),
  prefix text not null default '' check (char_length(prefix) <= 64),
  suffix text not null default '' check (char_length(suffix) <= 64),
  body text not null check (char_length(body) between 1 and 2000),
  author_name text not null check (char_length(author_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (end_offset > start_offset)
);

create index if not exists plain_reads_comments_page_idx
  on public.plain_reads_comments (page, created_at);

create index if not exists plain_reads_comments_created_idx
  on public.plain_reads_comments (created_at);

-- Who wrote which comment. Never readable through the API.
create table if not exists public.plain_reads_comment_owners (
  comment_id uuid primary key references public.plain_reads_comments (id) on delete cascade,
  owner_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists plain_reads_comment_owners_hash_idx
  on public.plain_reads_comment_owners (owner_hash, created_at);

alter table public.plain_reads_comments enable row level security;
alter table public.plain_reads_comment_owners enable row level security;

revoke all on public.plain_reads_comments from anon, authenticated;
revoke all on public.plain_reads_comment_owners from anon, authenticated;
grant select on public.plain_reads_comments to anon, authenticated;

drop policy if exists "plain_reads_comments: anyone can read" on public.plain_reads_comments;
create policy "plain_reads_comments: anyone can read"
  on public.plain_reads_comments
  for select
  to anon, authenticated
  using (true);

-- Add a comment. Returns the stored row.
create or replace function public.plain_reads_add_comment(
  p_page text,
  p_start integer,
  p_end integer,
  p_quote text,
  p_prefix text,
  p_suffix text,
  p_body text,
  p_author text,
  p_secret text
)
returns public.plain_reads_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_recent integer;
  v_row public.plain_reads_comments;
begin
  if p_secret is null or char_length(p_secret) not between 16 and 200 then
    raise exception 'invalid secret';
  end if;
  v_hash := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');

  -- A light brake on flooding from one browser.
  select count(*) into v_recent
    from public.plain_reads_comment_owners o
   where o.owner_hash = v_hash
     and o.created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    raise exception 'too many comments, try again later';
  end if;

  -- And on flooding from many browsers at once: it bounds how fast the table can grow.
  select count(*) into v_recent
    from public.plain_reads_comments c
   where c.created_at > now() - interval '1 hour';
  if v_recent >= 300 then
    raise exception 'too many comments, try again later';
  end if;

  insert into public.plain_reads_comments
    (page, start_offset, end_offset, quote, prefix, suffix, body, author_name)
  values
    (btrim(p_page), p_start, p_end, p_quote,
     coalesce(p_prefix, ''), coalesce(p_suffix, ''),
     btrim(p_body), coalesce(nullif(btrim(p_author), ''), '匿名'))
  returning * into v_row;

  insert into public.plain_reads_comment_owners (comment_id, owner_hash)
  values (v_row.id, v_hash);

  return v_row;
end;
$$;

-- Edit your own comment. Returns the updated row.
create or replace function public.plain_reads_edit_comment(
  p_id uuid,
  p_secret text,
  p_body text
)
returns public.plain_reads_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plain_reads_comments;
begin
  update public.plain_reads_comments c
     set body = btrim(p_body),
         updated_at = now()
   where c.id = p_id
     and exists (
       select 1
         from public.plain_reads_comment_owners o
        where o.comment_id = c.id
          and o.owner_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
     )
  returning c.* into v_row;

  if v_row.id is null then
    raise exception 'comment not found or not yours';
  end if;
  return v_row;
end;
$$;

-- Delete your own comment. Returns true when a row was removed.
create or replace function public.plain_reads_delete_comment(
  p_id uuid,
  p_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.plain_reads_comments c
   where c.id = p_id
     and exists (
       select 1
         from public.plain_reads_comment_owners o
        where o.comment_id = c.id
          and o.owner_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
     );
  return found;
end;
$$;

revoke all on function public.plain_reads_add_comment(text, integer, integer, text, text, text, text, text, text) from public;
revoke all on function public.plain_reads_edit_comment(uuid, text, text) from public;
revoke all on function public.plain_reads_delete_comment(uuid, text) from public;

grant execute on function public.plain_reads_add_comment(text, integer, integer, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.plain_reads_edit_comment(uuid, text, text) to anon, authenticated;
grant execute on function public.plain_reads_delete_comment(uuid, text) to anon, authenticated;

-- Make the new table and functions visible to the API right away.
notify pgrst, 'reload schema';
