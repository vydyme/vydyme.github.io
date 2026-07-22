// Static site generator for the photography portfolio.
// Reads photos/<Category>/*.jpg|jpeg|png|webp and emits a fully static
// site into dist/: one grid page per category and one page per photo.
//
// Folder convention:
//   photos/Street/*.jpg          -> nav label "Street"
//   photos/02 - Portraits/*.jpg  -> nav label "Portraits", sorted after prefix 01, etc.
// Numeric prefixes ("NN " / "NN-" / "NN_" / "NN.") control nav order; folders
// without a prefix sort alphabetically after any prefixed ones.

import { existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "..");
const PHOTOS_DIR = path.join(ROOT, "photos");
const DIST_DIR = path.join(ROOT, "dist");
const SITE_DIR = path.join(ROOT, "site");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SITE_TITLE = "VYDYME";
const THUMB_SIZE = 800; // square grid thumbnail, px
const FULL_MAX = 2000; // longest edge of the full-size photo, px

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "category";
}

function parsePrefix(folderName) {
  const match = folderName.match(/^(\d+)[\s._-]+(.+)$/);
  if (match) {
    return { order: Number(match[1]), displayName: match[2].trim() };
  }
  return { order: Number.POSITIVE_INFINITY, displayName: folderName.trim() };
}

function readCaptions(dirPath) {
  for (const name of ["captions.yaml", "captions.yml"]) {
    const captionsPath = path.join(dirPath, name);
    if (!existsSync(captionsPath)) continue;
    try {
      return parseYaml(readFileSync(captionsPath, "utf8")) || {};
    } catch (err) {
      throw new Error(`Failed to parse ${captionsPath}: ${err.message}`);
    }
  }
  return {};
}

function formatDate(value) {
  if (!value) return "";
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return str;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function locationLine({ venue, city, country, date }) {
  const place = [venue, city, country].filter(Boolean).join(", ");
  return [place, formatDate(date)].filter(Boolean).join(" · ");
}

function readCategories() {
  if (!existsSync(PHOTOS_DIR)) return [];

  const entries = readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."));

  const categories = entries.map((entry) => {
    const { order, displayName } = parsePrefix(entry.name);
    const dirPath = path.join(PHOTOS_DIR, entry.name);
    const files = readdirSync(dirPath)
      .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort(collator.compare);
    const captions = readCaptions(dirPath);
    const captionsByLowerName = Object.fromEntries(
      Object.entries(captions).map(([name, meta]) => [name.toLowerCase(), meta])
    );

    return {
      folderName: entry.name,
      dirPath,
      displayName,
      slug: slugify(displayName),
      order,
      photos: files.map((file, i) => {
        const meta = captionsByLowerName[file.toLowerCase()] || {};
        return {
          index: i + 1,
          srcPath: path.join(dirPath, file),
          srcFile: file,
          country: meta.country || "",
          city: meta.city || "",
          venue: meta.venue || "",
          date: meta.date || "",
          caption: meta.caption || "",
        };
      }),
    };
  });

  return categories
    .filter((c) => c.photos.length > 0)
    .sort((a, b) => (a.order - b.order) || collator.compare(a.displayName, b.displayName));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderNav(categories, activeSlug) {
  const links = categories.map((c) => {
    const isActive = c.slug === activeSlug;
    return `<a class="nav__link${isActive ? " nav__link--active" : ""}" href="/${c.slug}/">${escapeHtml(c.displayName)}</a>`;
  }).join("\n        ");

  return `<header class="site-header">
    <a class="site-logo" href="/"><img src="/logo.png" alt="vydy.me" class="site-logo__img"></a>
    <nav class="nav">
      ${links}
    </nav>
  </header>`;
}

function renderPage({ title, description, activeSlug, categories, body, bodyClass }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="/styles.css">
</head>
<body class="${bodyClass || ""}">
  ${renderNav(categories, activeSlug)}
  <main>
    ${body}
  </main>
  <script src="/script.js"></script>
</body>
</html>
`;
}

function renderGridBody(category) {
  const tiles = category.photos.map((p) => {
    const alt = p.caption || `${category.displayName} photo ${p.index}`;
    return `
      <a class="grid__item" href="/${category.slug}/${p.index}.html">
        <img src="/assets/${category.slug}/thumb/${p.index}.jpg" alt="${escapeHtml(alt)}" loading="lazy">
        <span class="grid__corner grid__corner--tl" aria-hidden="true"></span>
        <span class="grid__corner grid__corner--br" aria-hidden="true"></span>
      </a>`;
  }).join("");

  return `<h1 class="category-title">${escapeHtml(category.displayName)}</h1>
    <div class="grid">${tiles}
    </div>`;
}

function renderPhotoBody(category, photo, total) {
  const prev = category.photos[(photo.index - 2 + total) % total];
  const next = category.photos[photo.index % total];
  const location = locationLine(photo);
  const alt = photo.caption || `${category.displayName} photo ${photo.index}`;

  const caption = (location || photo.caption) ? `
    <div class="photo-caption">
      ${location ? `<div class="photo-caption__location">${escapeHtml(location)}</div>` : ""}
      ${photo.caption ? `<p class="photo-caption__text">${escapeHtml(photo.caption)}</p>` : ""}
    </div>` : "";

  return `<div class="photo-view">
      <div class="photo-view__frame">
        <img class="photo-view__image" src="/assets/${category.slug}/full/${photo.index}.jpg" alt="${escapeHtml(alt)}">
        <span class="photo-view__corner photo-view__corner--tl" aria-hidden="true"></span>
        <span class="photo-view__corner photo-view__corner--br" aria-hidden="true"></span>
      </div>
    </div>
    <div class="photo-nav">
      <a class="photo-nav__arrow photo-nav__arrow--prev" href="/${category.slug}/${prev.index}.html" aria-label="Previous photo">&#8249;</a>
      <span class="photo-nav__counter">${photo.index} / ${total}</span>
      <a class="photo-nav__arrow photo-nav__arrow--next" href="/${category.slug}/${next.index}.html" aria-label="Next photo">&#8250;</a>
    </div>${caption}`;
}

function renderEmptyBody() {
  return `<div class="empty-state">
      <p>New work is on its way.</p>
    </div>`;
}

async function processImages(category) {
  const thumbDir = path.join(DIST_DIR, "assets", category.slug, "thumb");
  const fullDir = path.join(DIST_DIR, "assets", category.slug, "full");
  mkdirSync(thumbDir, { recursive: true });
  mkdirSync(fullDir, { recursive: true });

  await Promise.all(category.photos.map(async (photo) => {
    const thumbPath = path.join(thumbDir, `${photo.index}.jpg`);
    const fullPath = path.join(fullDir, `${photo.index}.jpg`);

    await sharp(photo.srcPath)
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(thumbPath);

    await sharp(photo.srcPath)
      .rotate()
      .resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(fullPath);
  }));
}

function copyStaticFiles() {
  for (const file of ["styles.css", "script.js", "logo.png"]) {
    copyFileSync(path.join(SITE_DIR, file), path.join(DIST_DIR, file));
  }
}

async function build() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });
  copyStaticFiles();

  const categories = readCategories();

  if (categories.length === 0) {
    const html = renderPage({
      title: SITE_TITLE,
      description: "Street photography.",
      activeSlug: null,
      categories: [],
      body: renderEmptyBody(),
      bodyClass: "empty",
    });
    await writeFile(path.join(DIST_DIR, "index.html"), html);
    console.log("No categories found in photos/. Wrote placeholder homepage.");
    return;
  }

  for (const category of categories) {
    await processImages(category);

    const gridHtml = renderPage({
      title: `${category.displayName} — ${SITE_TITLE}`,
      description: `${category.displayName} — street photography by ${SITE_TITLE}.`,
      activeSlug: category.slug,
      categories,
      body: renderGridBody(category),
    });

    const catDir = path.join(DIST_DIR, category.slug);
    mkdirSync(catDir, { recursive: true });
    await writeFile(path.join(catDir, "index.html"), gridHtml);

    const total = category.photos.length;
    for (const photo of category.photos) {
      const photoLocation = locationLine(photo);
      const photoDescription = photo.caption
        || (photoLocation ? `${photoLocation} — ${category.displayName}, street photography by ${SITE_TITLE}.` : `${category.displayName} — street photography by ${SITE_TITLE}.`);
      const photoHtml = renderPage({
        title: `${category.displayName} #${photo.index} — ${SITE_TITLE}`,
        description: photoDescription,
        activeSlug: category.slug,
        categories,
        body: renderPhotoBody(category, photo, total),
        bodyClass: "photo-page",
      });
      await writeFile(path.join(catDir, `${photo.index}.html`), photoHtml);
    }
  }

  // Homepage mirrors the first category's grid.
  const home = categories[0];
  const homeHtml = renderPage({
    title: SITE_TITLE,
    description: `Street photography by ${SITE_TITLE}.`,
    activeSlug: home.slug,
    categories,
    body: renderGridBody(home),
  });
  await writeFile(path.join(DIST_DIR, "index.html"), homeHtml);

  console.log(`Built ${categories.length} categories, ${categories.reduce((n, c) => n + c.photos.length, 0)} photos.`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
