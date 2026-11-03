-- identity-refresh-raced-successors: forward-only, for an app whose baseline holds identity-sessions.sql of @starci/auth 0.2.0.
-- A refresh token presented again within the grace window after its rotation (a racing request, or a browser whose earlier Set-Cookie
-- never arrived) gets a successor of its own, set as the cookie, instead of an access token that leaves the browser on a spent token.
-- raced_count bounds how many such successors one rotated token may obtain; beyond it the replay is reuse and ends the session.
-- Expand only: one column with a default, nothing existing altered. A baseline rendered from @starci/auth 0.2.1 already holds it.

alter table public.identity_refresh_tokens add column raced_count integer not null default 0;
