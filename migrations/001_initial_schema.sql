CREATE TABLE courses (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
    course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_hash text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, student_hash)
);

CREATE INDEX students_course_id_idx ON students(course_id);
