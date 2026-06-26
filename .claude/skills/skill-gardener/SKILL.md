---
name: skill-gardener
description: >-
  Keep this repo's skill set healthy as development continues: fold fresh
  learnings into existing skills, prune what's gone stale, and propose NEW skills
  when a repeatable pattern emerges. Use this at the end of a work session or
  feature, after you hit a non-obvious gotcha worth recording, after a skill's
  instructions led you wrong or referenced something now removed, or when asked
  to "improve the skills", "update the skills", "should this be a skill?", or
  "review our skills". It's the maintenance loop for `.claude/skills/` — run it
  periodically the way you'd run a linter, not just when explicitly asked.
---

# Skill Gardener

Skills are living docs. Code changes out from under them, and every session
produces lessons that belong in a skill instead of being relearned next time.
This skill is the routine that keeps `.claude/skills/` accurate and growing.

Skills here live in `.claude/skills/<name>/SKILL.md` (+ optional `scripts/`),
with YAML frontmatter (`name`, `description`) and are listed in the repo root
[`CLAUDE.md`](../../../CLAUDE.md) under **## Skills**.

## When to garden

Do a pass whenever any of these is true — don't wait to be asked:

- You learned something non-obvious that will recur (a gotcha, a working
  pattern, a constraint). → fold it into the relevant skill.
- A skill's instructions misled you, or named a file / function / flag / id
  that's since been **removed or renamed**. → fix the skill so it can't mislead
  again.
- You did the same multi-step thing two or three times by hand. → that's a
  candidate for a new skill or a script.
- You finished a feature or a work session. → quick health check of the set.

## A. Improve existing skills

1. **Capture the learning where it'll be found.** Add it to the most specific
   skill, in a short "Lessons learned" or "Gotchas" note — concrete, with the
   *why*. (Example already banked in [[uv-validation]]: don't measure sub-second
   animation timing via async Playwright polling — verify the constant in source
   instead.)
2. **Keep examples real.** Skills drift when the code they cite changes. If a
   skill references a class / id / variable / file, verify it still exists:

   ```bash
   # for each concrete token a SKILL.md cites, confirm it's still in the code
   grep -rn "tokenTheSkillMentions" /Users/brad/Documents/blueline/{game.js,data.js,index.html,style.css}
   ```

   Replace dead examples with current ones (this is how the bubble-era examples
   in `uv-validation` got swapped for the cast-meter ones).
3. **Cross-link.** Point related skills at each other with `[[skill-name]]` so a
   reader lands on the companion skill (validation ↔ cleanup ↔ this one).
4. **Tighten the `description`.** It's the trigger. If you found yourself wanting
   a skill but it didn't surface, its description was too narrow — broaden the
   "use this when…" phrasing toward the words a user would actually type.

## B. Propose new skills

When a repeatable pattern emerges, surface it rather than silently re-doing it.
A good new-skill candidate is: **repeated** (done by hand more than once),
**non-trivial** (more than one step or a real gotcha), and **reusable** (will
come up again). One-offs and things already covered by an existing skill are
not candidates.

When you spot one, **tell the user** — briefly: what the skill would cover, why
it clears the bar, and which existing skill it complements or extends. Only
scaffold it if they agree (or if they already asked you to create skills).

To scaffold one:

- `mkdir -p .claude/skills/<name>/` and write `SKILL.md` with `name` +
  `description` frontmatter. Match the voice of the existing skills: lead with
  *when to use*, keep it concrete to this repo, prefer pointing at a script over
  re-explaining a pipeline.
- If it automates work, add `scripts/` and run Python via `uv` per the repo
  rules (see [[uv-validation]]) — never `pip`, deps via PEP 723 / `uv run --with`.
- **Register it** in root `CLAUDE.md` under **## Skills** (one bullet, same style
  as the others) so it's discoverable and documented.

## C. Prune

If a skill is obsolete (the workflow's gone, or it's been absorbed into another),
remove the folder and its `CLAUDE.md` bullet rather than leaving a misleading
doc. Stale guidance is worse than none. This is the skill-level twin of
[[cruft-cleanup]] — same instinct, applied to the skills themselves.

## Health-check checklist

- [ ] Each `SKILL.md`'s cited files / ids / functions still exist.
- [ ] Each `description` would trigger on the phrasing a user would actually use.
- [ ] New recurring patterns from recent work are captured or proposed.
- [ ] Related skills cross-link with `[[name]]`.
- [ ] Every skill folder has a matching bullet in root `CLAUDE.md`, and vice
      versa (no orphans either direction).
