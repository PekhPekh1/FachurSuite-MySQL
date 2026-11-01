# Release Workflow

## Versioning
Tags drive packaging: `v1.0.0`, `v1.1.0`… Every tag triggers the EXE and APK
builds; every merge to `main` first passes `test` and then, after an approval
gate, runs `deploy-web`.

## Order of operations for a release
1. Develop on a feature branch; CI (`test.yml`) must be green.
2. Merge to `main` → `test` runs → `deploy-web` proposes a production deploy
   (manual approval via the `production` environment).
3. The deploy script takes a pre-migration backup, applies migrations, restarts
   the app, and fails loudly (printing the restore command) on error.
4. Tag the release (`git tag v1.x.y && git push --tags`) → `build-exe` and
   `build-apk` produce the Windows installer and Android APK from that tag.
5. Verify the artifacts in the Actions run, then publish the release.

## Which CI runs what

| Workflow | Trigger | Output |
|---|---|---|
| `test.yml` | push, PR | full test battery (unit, integration, migrations, build) |
| `deploy-web.yml` | push to main | production deploy behind approval gate |
| `build-exe.yml` | tag `v*` / dispatch | signed NSIS Windows installer |
| `build-apk.yml` | tag `v*` / dispatch | signed release APK |

## Rollback
- App version rollback: redeploy the previous tag (deploy is idempotent; migrate
  only applies forward).
- Database rollback: `bash deploy/restore.sh <pre-migrate-backup.dump>` — the
  deploy flow saves one before every migration.
