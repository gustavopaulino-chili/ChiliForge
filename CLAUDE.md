# ChiliForge — Claude Code Rules

## Before conversation compaction

Before the conversation is compacted, commit all pending changes to `dev` and push:

```
git add -A
git commit -m "<summary of changes made in this session>"
git push origin dev
```

Do this automatically without asking for confirmation when a compaction is about to occur.

## SQL changes

Whenever a task requires changes to the database schema or seed data (new tables, columns, indexes, seed rows, etc.), always output the complete SQL snippet at the end of the response — even if the change was already applied in `database.sql`. Format it as a fenced SQL code block so the user can copy and run it directly on the server.
