---
name: code-review
description: Review code changes for quality, security, and best practices.
---

# Code Review

Review the current code changes thoroughly. Focus on:

1. **Correctness** - Logic errors, edge cases, off-by-one errors
2. **Security** - Input validation, injection risks, credential exposure
3. **Performance** - Unnecessary allocations, N+1 queries, blocking calls
4. **Readability** - Naming, structure, comments for non-obvious logic
5. **Testing** - Missing test coverage for new or changed behavior

When reviewing, provide feedback in this format:

- **File**: path to the file
- **Line(s)**: specific line numbers
- **Severity**: critical / warning / suggestion
- **Issue**: what the problem is
- **Fix**: how to resolve it

Start by examining the current diff to understand what changed.
