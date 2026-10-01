import fs from 'node:fs';
import path from 'node:path';

/**
 * `--out <dir>`: A KEPT CLASS WRITTEN INTO A CONTENT FOLDER, the way the site
 * ships its own lessons (`content/<id>/lesson.json`, `assets.json`,
 * `generated/…`, and a row in `content/index.json`). The same files the keep
 * posts to `/api/class` — class-prep's `saveable` chose them — so a class
 * written here is the class the catalogue would hold, served from the site
 * itself with no publish step.
 *
 * `as` puts it in the place of an existing lesson: the lesson's id, its
 * picture paths and its index row all take that id, so everything that
 * already names the lesson (a link, a test, the knowledge graph) now opens
 * the new class. The row keeps the title and subtitle it had.
 *
 * Returns the id it was written under.
 */
export function writeClassTo(dir, saved, as) {
  const id = as ?? saved.id;
  const root = path.resolve(dir, id);
  for (const file of saved.files) {
    const target = path.resolve(root, file.path);
    if (!target.startsWith(root + path.sep)) throw new Error(`${file.path} would be written outside ${root}`);
    let body = file.body;
    if (file.path === 'lesson.json' && id !== saved.id) {
      const lesson = JSON.parse(body);
      lesson.id = id;
      for (const el of lesson.elements ?? []) {
        if (typeof el.src === 'string' && el.src.startsWith(`/${saved.id}/`)) {
          el.src = `/${id}/${el.src.slice(saved.id.length + 2)}`;
        }
      }
      body = JSON.stringify(lesson, null, 2);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.encoding === 'base64' ? Buffer.from(body, 'base64') : body);
  }

  const indexPath = path.join(dir, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { lessons: [] };
  const at = index.lessons.findIndex((l) => l.id === id);
  // In an existing lesson's place, the catalogue keeps the name it already
  // shows in every menu; the lesson file carries the planner's own title.
  const kept = at >= 0 ? index.lessons[at] : null;
  const entry = {
    ...saved.entry,
    id,
    path: `${id}/lesson.json`,
    ...(kept?.title ? { title: kept.title } : {}),
    ...(kept?.subtitle ? { subtitle: kept.subtitle } : {}),
  };
  if (at >= 0) index.lessons[at] = entry;
  else index.lessons.push(entry);
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return id;
}
