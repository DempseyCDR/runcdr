-- Feature 079 (research R2): what an event's check-ins said, kept after the 90-day purge deletes them.
--
-- An event's attendance breakdown needs two figures that only the check-in rows carry: how many children
-- came, and which booked performers were checked in (a performer is subtracted from paying dancers only
-- when checked in). Everything else it needs already outlives the rows — `events.attendance_count` and the
-- door record's comp, open-band and gift-card counts.
--
-- The breakdown is this rollup PLUS what the rows still present say. Only `purgeOldAttendance` writes it,
-- inside its own transaction and before it deletes, and it ADDS rather than overwrites: an evening's
-- check-ins span hours, so one event's rows can be purged across two runs. With a single writer there is
-- nothing to drift. One row per event, created the first time any of its check-ins are purged.

CREATE TABLE IF NOT EXISTS event_attendance_rollups (
  event_id          uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  children_count    integer NOT NULL DEFAULT 0 CHECK (children_count >= 0),
  caller_count      integer NOT NULL DEFAULT 0 CHECK (caller_count >= 0),
  band_count        integer NOT NULL DEFAULT 0 CHECK (band_count >= 0),
  sound_tech_count  integer NOT NULL DEFAULT 0 CHECK (sound_tech_count >= 0),
  instructor_count  integer NOT NULL DEFAULT 0 CHECK (instructor_count >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
