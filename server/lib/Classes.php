<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Teaching: classes, assignments and submissions.
 *
 * Anyone can create a class and becomes its teacher; students join with the class code.
 * An assignment is a copy of one of the teacher's scores with instructions and an optional due
 * date. When a student starts it, they get their own copy in their library, and the teacher
 * is made an editor of that copy, so they can open it, comment on bars and even co-edit live.
 * The student submits; the teacher returns it with feedback.
 */
final class Classes
{
    private const MAX_CLASSES = 50;
    private const MAX_MEMBERS = 200;

    public function __construct(private PDO $db, private Scores $scores, private ?Notify $notify = null)
    {
    }

    /** Classes the user teaches or is in. */
    public function list(int $userId): array
    {
        $st = $this->db->prepare(
            "SELECT c.id, c.name, c.join_code, c.created_at, 'teacher' AS role, u.name AS teacher,
                    (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS students
             FROM classes c JOIN users u ON u.id = c.owner_id WHERE c.owner_id = ?
             UNION ALL
             SELECT c.id, c.name, '' AS join_code, c.created_at, 'student' AS role, u.name AS teacher, 0 AS students
             FROM classes c JOIN class_members m ON m.class_id = c.id JOIN users u ON u.id = c.owner_id WHERE m.user_id = ?
             ORDER BY 4 DESC",  // created_at, by position: SQLite only accepts result columns here
        );
        $st->execute([$userId, $userId]);
        return array_map(fn ($r) => $this->classRow($r), $st->fetchAll());
    }

    public function create(int $userId, string $name): array
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 80) {
            throw new HttpError(422, 'Give the class a name (up to 80 characters).');
        }
        $count = $this->db->prepare('SELECT COUNT(*) FROM classes WHERE owner_id = ?');
        $count->execute([$userId]);
        if ((int) $count->fetchColumn() >= self::MAX_CLASSES) {
            throw new HttpError(403, 'You already teach the most classes allowed.');
        }
        $code = $this->uniqueCode();
        $this->db->prepare('INSERT INTO classes (owner_id, name, join_code, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $name, $code, Http::now()]);
        return $this->get((int) $this->db->lastInsertId(), $userId);
    }

    public function join(int $userId, string $code): array
    {
        $st = $this->db->prepare('SELECT id, owner_id FROM classes WHERE join_code = ?');
        $st->execute([strtoupper(trim($code))]);
        $class = $st->fetch();
        if (!$class) {
            throw new HttpError(404, 'No class uses that code. Check it with your teacher.');
        }
        if ((int) $class['owner_id'] === $userId) {
            throw new HttpError(422, 'You teach this class.');
        }
        $count = $this->db->prepare('SELECT COUNT(*) FROM class_members WHERE class_id = ?');
        $count->execute([$class['id']]);
        if ((int) $count->fetchColumn() >= self::MAX_MEMBERS) {
            throw new HttpError(403, 'This class is full.');
        }
        $exists = $this->db->prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?');
        $exists->execute([$class['id'], $userId]);
        if (!$exists->fetch()) {
            $this->db->prepare('INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)')
                ->execute([$class['id'], $userId, Http::now()]);
        }
        return $this->get((int) $class['id'], $userId);
    }

    /** A class with its assignments; the teacher also sees the students and how far each assignment is. */
    public function get(int $id, int $userId): array
    {
        $class = $this->access($id, $userId);
        $teacher = $class['role'] === 'teacher';
        $out = $this->classRow($class);
        $st = $this->db->prepare('SELECT id, title, instructions, rubric, due_at, created_at FROM assignments WHERE class_id = ? ORDER BY id DESC');
        $st->execute([$id]);
        $assignments = $st->fetchAll();
        $mine = $this->db->prepare('SELECT id, score_id, status, feedback, grade, marks, submitted_at, returned_at FROM submissions WHERE assignment_id = ? AND user_id = ?');
        $counts = $this->db->prepare('SELECT status, COUNT(*) AS n FROM submissions WHERE assignment_id = ? GROUP BY status');
        $out['assignments'] = array_map(function ($a) use ($teacher, $userId, $mine, $counts) {
            $row = [
                'id' => (int) $a['id'],
                'title' => $a['title'],
                'instructions' => $a['instructions'],
                'rubric' => self::criteria($a['rubric'] ?? null),
                'due_at' => $a['due_at'],
                'created_at' => $a['created_at'],
            ];
            if ($teacher) {
                $counts->execute([$a['id']]);
                $row['counts'] = ['working' => 0, 'submitted' => 0, 'returned' => 0];
                foreach ($counts->fetchAll() as $c) {
                    $row['counts'][$c['status']] = (int) $c['n'];
                }
            } else {
                $mine->execute([$a['id'], $userId]);
                $sub = $mine->fetch();
                $row['submission'] = $sub ? $this->submissionRow($sub) : null;
            }
            return $row;
        }, $assignments);
        if ($teacher) {
            $m = $this->db->prepare('SELECT u.id, u.name, u.email, m.joined_at FROM class_members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? ORDER BY u.name');
            $m->execute([$id]);
            $out['members'] = array_map(fn ($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email'], 'joined_at' => $r['joined_at']], $m->fetchAll());
        }
        return $out;
    }

    /** The teacher removes a student, or a student leaves. */
    public function removeMember(int $id, int $userId, int $memberId): void
    {
        $class = $this->access($id, $userId);
        if ($class['role'] !== 'teacher' && $memberId !== $userId) {
            throw new HttpError(403, 'Only the teacher can remove students.');
        }
        $this->db->prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?')->execute([$id, $memberId]);
    }

    public function deleteClass(int $id, int $userId): void
    {
        $class = $this->access($id, $userId);
        if ($class['role'] !== 'teacher') {
            throw new HttpError(403, 'Only the teacher can delete the class.');
        }
        $this->db->prepare('DELETE FROM classes WHERE id = ?')->execute([$id]);
    }

    /** The teacher sets one of their scores as an assignment (a copy: later edits to theirs do not change it). */
    public function assign(int $classId, int $userId, array $in): array
    {
        $class = $this->access($classId, $userId);
        if ($class['role'] !== 'teacher') {
            throw new HttpError(403, 'Only the teacher can set assignments.');
        }
        $title = trim((string) ($in['title'] ?? ''));
        if ($title === '' || mb_strlen($title) > 120) {
            throw new HttpError(422, 'Give the assignment a title (up to 120 characters).');
        }
        $instructions = mb_substr(trim((string) ($in['instructions'] ?? '')), 0, 4000);
        $due = $in['due_at'] ?? null;
        if ($due !== null && $due !== '' && strtotime((string) $due) === false) {
            throw new HttpError(422, 'The due date is not a date.');
        }
        // marking criteria: up to 8 short lines
        $rubric = array_values(array_slice(array_filter(array_map(
            fn ($c) => mb_substr(trim((string) $c), 0, 80),
            is_array($in['rubric'] ?? null) ? $in['rubric'] : [],
        ), fn ($c) => $c !== ''), 0, 8));
        $score = $this->scores->get((int) ($in['score_id'] ?? 0), $userId);
        $this->db->prepare('INSERT INTO assignments (class_id, title, instructions, rubric, data, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$classId, $title, $instructions, json_encode($rubric, JSON_UNESCAPED_UNICODE), json_encode($score['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $due ?: null, Http::now()]);
        $members = $this->db->prepare('SELECT user_id FROM class_members WHERE class_id = ?');
        $members->execute([$classId]);
        foreach ($members->fetchAll(PDO::FETCH_COLUMN) as $m) {
            $this->notify?->send((int) $m, 'assignment', ['class' => $class['name'], 'title' => $title], "app.html?class=$classId");
        }
        return $this->get($classId, $userId);
    }

    /** A student starts an assignment: their own copy, which the teacher can open and edit too. */
    public function start(int $assignmentId, array $user): array
    {
        $a = $this->assignment($assignmentId, (int) $user['id']);
        if ($a['role'] !== 'student') {
            throw new HttpError(403, 'Only students start assignments.');
        }
        $existing = $this->db->prepare('SELECT id, score_id, status, feedback, grade, marks, submitted_at, returned_at FROM submissions WHERE assignment_id = ? AND user_id = ?');
        $existing->execute([$assignmentId, $user['id']]);
        if ($row = $existing->fetch()) {
            return $this->submissionRow($row);
        }
        $data = json_decode($a['data'], true);
        $data['title'] = mb_substr($a['title'] . ' · ' . $user['name'], 0, 200);
        $meta = $this->scores->create((int) $user['id'], $data);
        // the teacher may open, comment on and edit the student's copy
        $this->db->prepare('INSERT INTO score_editors (score_id, user_id, created_at) VALUES (?, ?, ?)')
            ->execute([$meta['id'], $a['owner_id'], Http::now()]);
        $this->db->prepare("INSERT INTO submissions (assignment_id, user_id, score_id, status) VALUES (?, ?, ?, 'working')")
            ->execute([$assignmentId, $user['id'], $meta['id']]);
        $existing->execute([$assignmentId, $user['id']]);
        return $this->submissionRow($existing->fetch());
    }

    public function submit(int $assignmentId, int $userId): array
    {
        $this->assignment($assignmentId, $userId);
        $st = $this->db->prepare("UPDATE submissions SET status = 'submitted', submitted_at = ? WHERE assignment_id = ? AND user_id = ?");
        $st->execute([Http::now(), $assignmentId, $userId]);
        if (!$st->rowCount()) {
            throw new HttpError(404, 'Start the assignment before handing it in.');
        }
        $info = $this->db->prepare(
            'SELECT a.title, c.owner_id, u.name, s.score_id FROM submissions s JOIN assignments a ON a.id = s.assignment_id
             JOIN classes c ON c.id = a.class_id JOIN users u ON u.id = s.user_id WHERE s.assignment_id = ? AND s.user_id = ?',
        );
        $info->execute([$assignmentId, $userId]);
        if ($i = $info->fetch()) {
            $this->notify?->send((int) $i['owner_id'], 'handed-in', ['actor' => $i['name'], 'title' => $i['title']], "app.html?open={$i['score_id']}", $userId);
        }
        $row = $this->db->prepare('SELECT id, score_id, status, feedback, grade, marks, submitted_at, returned_at FROM submissions WHERE assignment_id = ? AND user_id = ?');
        $row->execute([$assignmentId, $userId]);
        return $this->submissionRow($row->fetch());
    }

    /** Every student of the class with their work on this assignment (teacher only). */
    public function submissions(int $assignmentId, int $userId): array
    {
        $a = $this->assignment($assignmentId, $userId);
        if ($a['role'] !== 'teacher') {
            throw new HttpError(403, 'Only the teacher sees everyone’s work.');
        }
        $st = $this->db->prepare(
            'SELECT u.id AS user_id, u.name, s.id, s.score_id, s.status, s.feedback, s.grade, s.marks, s.submitted_at, s.returned_at
             FROM class_members m JOIN users u ON u.id = m.user_id
             LEFT JOIN submissions s ON s.user_id = u.id AND s.assignment_id = ?
             WHERE m.class_id = ? ORDER BY u.name',
        );
        $st->execute([$assignmentId, $a['class_id']]);
        return array_map(fn ($r) => ['student' => ['id' => (int) $r['user_id'], 'name' => $r['name']]] + ($r['id'] ? $this->submissionRow($r) : ['status' => 'not started']), $st->fetchAll());
    }

    /**
     * The teacher hands work back: written feedback, an optional grade (free text such as
     * "8/10" or "B+") and a mark from 0 to 4 for each of the assignment's criteria.
     */
    public function giveBack(int $submissionId, int $userId, string $feedback, string $grade = '', array $marks = []): array
    {
        $st = $this->db->prepare(
            'SELECT s.id, s.assignment_id, a.rubric FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN classes c ON c.id = a.class_id
             WHERE s.id = ? AND c.owner_id = ?',
        );
        $st->execute([$submissionId, $userId]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpError(404, 'Submission not found.');
        }
        $criteria = self::criteria($row['rubric']);
        $clean = [];
        foreach ($criteria as $k => $_) {
            $v = $marks[$k] ?? null;
            $clean[] = is_numeric($v) ? max(0, min(4, (int) $v)) : null;
        }
        $this->db->prepare("UPDATE submissions SET status = 'returned', feedback = ?, grade = ?, marks = ?, returned_at = ? WHERE id = ?")
            ->execute([mb_substr(trim($feedback), 0, 4000), mb_substr(trim($grade), 0, 20), json_encode($clean), Http::now(), $submissionId]);
        $info = $this->db->prepare('SELECT s.user_id, s.score_id, a.title FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.id = ?');
        $info->execute([$submissionId]);
        if ($i = $info->fetch()) {
            $this->notify?->send((int) $i['user_id'], 'returned', ['title' => $i['title']], "app.html?open={$i['score_id']}", $userId);
        }
        $row = $this->db->prepare('SELECT id, score_id, status, feedback, grade, marks, submitted_at, returned_at FROM submissions WHERE id = ?');
        $row->execute([$submissionId]);
        return $this->submissionRow($row->fetch());
    }

    /** If this score is someone's work on an assignment: the assignment, for the banner in the editor. */
    public function forScore(int $scoreId, int $userId): ?array
    {
        $this->scores->info($scoreId, $userId); // access check
        $st = $this->db->prepare(
            'SELECT a.id, a.title, a.instructions, a.rubric, a.due_at, a.class_id, c.name AS class_name, s.id AS sid, s.score_id, s.status, s.feedback, s.grade, s.marks,
                    s.submitted_at, s.returned_at, s.user_id, u.name AS student
             FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN classes c ON c.id = a.class_id JOIN users u ON u.id = s.user_id
             WHERE s.score_id = ?',
        );
        $st->execute([$scoreId]);
        $r = $st->fetch();
        if (!$r) {
            return null;
        }
        return [
            'id' => (int) $r['id'],
            'title' => $r['title'],
            'instructions' => $r['instructions'],
            'due_at' => $r['due_at'],
            'class' => $r['class_name'],
            'class_id' => (int) $r['class_id'],
            'rubric' => self::criteria($r['rubric']),
            'student' => $r['student'],
            'mine' => (int) $r['user_id'] === $userId,
            'submission' => $this->submissionRow(['id' => $r['sid']] + $r),
        ];
    }

    // ------------------------------------------------------------------ helpers

    private function access(int $id, int $userId): array
    {
        $st = $this->db->prepare(
            "SELECT c.*, u.name AS teacher, CASE WHEN c.owner_id = ? THEN 'teacher' ELSE 'student' END AS role,
                    (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS students
             FROM classes c JOIN users u ON u.id = c.owner_id
             WHERE c.id = ? AND (c.owner_id = ? OR EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = c.id AND m.user_id = ?))",
        );
        $st->execute([$userId, $id, $userId, $userId]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpError(404, 'Class not found.');
        }
        return $row;
    }

    private function assignment(int $id, int $userId): array
    {
        $st = $this->db->prepare('SELECT a.*, c.owner_id FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ?');
        $st->execute([$id]);
        $a = $st->fetch();
        if (!$a) {
            throw new HttpError(404, 'Assignment not found.');
        }
        $class = $this->access((int) $a['class_id'], $userId); // 404 for outsiders
        $a['role'] = $class['role'];
        return $a;
    }

    private function classRow(array $r): array
    {
        $teacher = $r['role'] === 'teacher';
        return [
            'id' => (int) $r['id'],
            'name' => $r['name'],
            'role' => $r['role'],
            'teacher' => $r['teacher'],
            'created_at' => $r['created_at'],
        ] + ($teacher ? ['join_code' => $r['join_code'], 'students' => (int) $r['students']] : []);
    }

    /** Marking criteria stored as JSON. */
    private static function criteria(?string $json): array
    {
        $list = $json ? json_decode($json, true) : [];
        return is_array($list) ? array_values(array_filter($list, 'is_string')) : [];
    }

    /**
     * Everything with a due date in the user's classes, soonest first: for students their own
     * status, for teachers how many have handed in.
     */
    public function calendar(int $userId): array
    {
        $st = $this->db->prepare(
            "SELECT a.id, a.title, a.due_at, c.id AS class_id, c.name AS class_name, 'teacher' AS role,
                    (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status <> 'working') AS done,
                    (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS total, NULL AS status
             FROM assignments a JOIN classes c ON c.id = a.class_id WHERE c.owner_id = ? AND a.due_at IS NOT NULL
             UNION ALL
             SELECT a.id, a.title, a.due_at, c.id AS class_id, c.name AS class_name, 'student' AS role, 0 AS done, 0 AS total,
                    (SELECT s.status FROM submissions s WHERE s.assignment_id = a.id AND s.user_id = ?) AS status
             FROM assignments a JOIN classes c ON c.id = a.class_id JOIN class_members m ON m.class_id = c.id
             WHERE m.user_id = ? AND a.due_at IS NOT NULL
             ORDER BY 3 ASC",  // due_at, by position (SQLite needs a result column here)
        );
        $st->execute([$userId, $userId, $userId]);
        return array_map(fn ($r) => [
            'id' => (int) $r['id'],
            'title' => $r['title'],
            'due_at' => $r['due_at'],
            'class_id' => (int) $r['class_id'],
            'class' => $r['class_name'],
            'role' => $r['role'],
        ] + ($r['role'] === 'teacher'
            ? ['done' => (int) $r['done'], 'total' => (int) $r['total']]
            : ['status' => $r['status'] ?? 'not started']), $st->fetchAll());
    }

    private function submissionRow(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'score_id' => (int) $r['score_id'],
            'status' => $r['status'],
            'feedback' => $r['feedback'] ?? '',
            'grade' => $r['grade'] ?? '',
            'marks' => isset($r['marks']) && $r['marks'] ? (json_decode($r['marks'], true) ?: []) : [],
            'submitted_at' => $r['submitted_at'] ?? null,
            'returned_at' => $r['returned_at'] ?? null,
        ];
    }

    private function uniqueCode(): string
    {
        $st = $this->db->prepare('SELECT 1 FROM classes WHERE join_code = ?');
        do {
            // no 0/O or 1/I, so a code read out loud or copied by hand works
            $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            $code = '';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            $st->execute([$code]);
        } while ($st->fetch());
        return $code;
    }
}
