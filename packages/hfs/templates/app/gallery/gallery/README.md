# {{project}} gallery

Screenshots of every page, grouped by area, before and after each UI fix round (PROJECT-GALLERY-1).

- Put shots in `shots/<area>/<page>__<width>__<before|after>.png` (the width is 1440 or 390), one pair per page and width.
- `npm install && npm run dev` serves it on http://localhost:{{galleryPort}} (the app's base port + 50); `starci app stack up --env dev` starts it with the app. New files appear on reload.
- The PNGs are git-ignored; the gallery app is source, managed by `starci app sync`.
