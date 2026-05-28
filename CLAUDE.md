# ChiliForge — Claude Code Rules

## Before conversation compaction

Before the conversation is compacted, commit all pending changes to `dev` and push:

```
git add -A
git commit -m "<summary of changes made in this session>"
git push origin dev
```

Do this automatically without asking for confirmation when a compaction is about to occur.
