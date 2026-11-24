# Changelog

Versioned history starts at beta; earlier history is in git.

## 6.17.11 - 2026-11-25

- App scaffolding, lint, check, sync, stack, secret and database tooling of the StarCi harness; the canon pins name the Grammar family 0.59.0 and @starci/gallery 0.1.24, and R346 admits the one ChatFrame of a chat pane.
- The canon pins name @starci/common 1.0.2, @starci/seed 0.3.1 (which @starci/hfs requires), @starci/heroicons 0.5.0 and the patch of every other @starci package this train releases.
- The test decrypt of a deploy backup on the manager runs as root, over passwordless sudo where the login has it, else in a one-off read-only container of the database image, so a deploy user with the docker group and no sudo deploys with pending migrations and under the urgent floor.
