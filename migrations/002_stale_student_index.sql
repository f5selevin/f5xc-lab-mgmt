UPDATE students
SET payload = jsonb_set(payload, '{lastSeen}', to_jsonb(created_at::text), true)
WHERE course_id = 'xcspeccore' AND NOT payload ? 'lastSeen';