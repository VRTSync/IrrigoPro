# Git History Purge Runbook

This runbook describes how to permanently remove `uploads/photo_*` blobs
(~44 MB of customer iPhone photos captured by IrrigoPro field techs) and the
stale `.env.security` file from **all** git history.

These paths were untracked previously via `git rm --cached`, so they no longer
appear in the working tree or new commits. However, the blobs still live in
prior commits, which means:

- `.git/` is still bloated by ~44 MB.
- Anyone cloning or fetching still receives the customer photos and the old
  security config.

A history rewrite is destructive (it changes every commit SHA on the affected
branches) and must be coordinated with the whole team. It cannot be performed
by the agent because version control is platform-managed; a human operator
must run it on a local clone with push access.

## Pre-flight

1. Announce the rewrite to every contributor. Anyone with a working clone
   must stop pushing, then re-clone after the rewrite lands.
2. Confirm there are no open PRs / branches you need to preserve. Branches
   based on the old history will need to be rebased onto the rewritten
   history.
3. Take a fresh backup clone (mirror) so the rewrite is reversible:
   ```bash
   git clone --mirror <repo-url> repo-backup.git
   ```
4. Install `git-filter-repo` (https://github.com/newren/git-filter-repo). Do
   not use the deprecated `git filter-branch` or BFG for this — `filter-repo`
   is the supported tool.

## Rewrite

From a fresh, full clone (not a shallow clone):

```bash
# 1. Make sure you're on a clean tree with all branches/tags fetched.
git fetch --all --tags
git remote -v   # confirm origin

# 2. Run the purge. This rewrites every branch and tag.
git filter-repo \
  --invert-paths \
  --path .env.security \
  --path-glob 'uploads/photo_*'

# 3. Verify the blobs are gone.
git log --all --oneline -- .env.security        # should print nothing
git log --all --oneline -- 'uploads/photo_*'    # should print nothing

# 4. Check size dropped (~44 MB smaller .git/).
du -sh .git
git gc --prune=now --aggressive
du -sh .git
```

Note: `git filter-repo` removes the `origin` remote by design. Re-add it:

```bash
git remote add origin <repo-url>
```

## Force-push

```bash
git push --force --all origin
git push --force --tags origin
```

If the host blocks force-push to protected branches, temporarily lift
protection on `main` (and any other long-lived branches), push, then
re-enable protection.

## Post-flight

1. Notify the team: every contributor must delete their local clone and
   `git clone` fresh. Rebasing existing local branches onto the rewritten
   history is possible but error-prone — re-cloning is safer.
2. Invalidate / rotate anything that ever lived in `.env.security`. Treat
   those values as compromised: they were in public-ish history.
3. Ask the hosting provider (e.g. GitHub) to run gc / drop stale refs so the
   server-side repo also shrinks. On GitHub this typically requires opening
   a support request; pushed force-updates do not immediately reclaim
   server-side storage.
4. Confirm `.gitignore` still lists `uploads/` and `.env.*` (it does as of
   this writing) so the same blobs cannot be re-introduced.

## Why the agent did not run this

The Replit agent is not permitted to run git commands or rewrite history;
version control is platform-managed. A human operator with push credentials
must perform the steps above, on a local machine, with the team coordinated
in advance.
