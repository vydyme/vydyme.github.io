# vydyme.github.io

Minimalist black & white street photography site. The site is fully static
and rebuilds itself automatically whenever you push photos.

## Adding photos (the only thing you need to do)

1. Drop images into a folder under `photos/`, one folder per category/project:

   ```
   photos/
     01 - Street/
       IMG_0001.jpg
       IMG_0002.jpg
     02 - Portraits/
       shot-01.jpg
   ```

2. Commit and push to `main`. GitHub Actions builds the site and deploys it
   to Pages automatically — nothing else to run.

### Folder naming

- The folder name (minus any numeric prefix) becomes the nav label, e.g.
  `01 - Street` → **Street**.
- The leading number controls the order it appears in the nav bar. Folders
  without a number sort alphabetically after the numbered ones.
- Photos within a folder are ordered by filename, so name files so they sort
  the way you want them to appear (most camera exports already sort
  chronologically).
- Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`.

### Adding location and captions (optional)

Drop a `captions.yaml` file inside a category folder, keyed by the image
filename. Any field can be omitted, and photos with no entry just show no
caption:

```
photos/
  01 - Street/
    IMG_0001.jpg
    IMG_0002.jpg
    captions.yaml
```

```yaml
IMG_0001.jpg:
  venue: Markthal
  city: Rotterdam
  country: Netherlands
  date: 2023-09-15
  caption: A quiet corner of the market hall, caught between the morning rush and the first customers of the day.

IMG_0002.jpg:
  city: Rotterdam
  country: Netherlands
```

`date` should be in `YYYY-MM-DD` format and renders as "Sep 15, 2023" next to the
location. Any other format is shown as-is.

Keep captions short — around 200 characters reads best under the photo. The
location line only shows the fields you provide (e.g. just "Rotterdam,
Netherlands" if you skip the venue).

### What the build does automatically

- Generates a square grid thumbnail and a web-optimized full-size version of
  every photo (originals in `photos/` are never served directly).
- Strips EXIF metadata (including GPS location) from the generated images.
- Generates a grid page per category and a full page per photo, with
  prev/next navigation, at clean URLs like `/street/` and `/street/3.html`.

## Local preview

```
npm install
npm run preview   # builds and serves dist/ at http://localhost:3000
```

## One-time repo setup

In GitHub repo Settings → Pages, set **Source** to **GitHub Actions** (instead
of "Deploy from a branch"). After that, every push to `main` builds and
deploys automatically via `.github/workflows/deploy.yml`.
