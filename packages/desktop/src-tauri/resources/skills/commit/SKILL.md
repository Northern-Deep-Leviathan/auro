---
name: commit
description: Create a well-structured git commit from staged changes.
---

# Commit

Create a git commit for the current changes. Follow these steps:

1. Run `git status --short` to see what files are modified
2. Run `git diff --cached` to see staged changes (if any)
3. Run `git diff` to see unstaged changes
4. Draft a commit message following conventional commit format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for code restructuring
   - `docs:` for documentation changes
   - `test:` for test additions or modifications
   - `chore:` for maintenance tasks
5. Keep the subject line under 72 characters
6. Add a body explaining **why** the change was made, not just what changed
7. Stage the relevant files and create the commit

If there are unstaged changes, ask which files to include before committing.
