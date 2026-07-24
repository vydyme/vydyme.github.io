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

function formatAperture(value) {
  if (!value) return "";
  const str = String(value).trim();
  return /^f\//i.test(str) ? str : `f/${str}`;
}

function formatFocal(value) {
  if (!value) return "";
  const str = String(value).trim();
  return /mm$/i.test(str) ? str : `${str}mm`;
}

function formatShutter(value) {
  if (!value) return "";
  const str = String(value).trim();
  return /s$/i.test(str) ? str : `${str}s`;
}

function formatIso(value) {
  if (!value) return "";
  const str = String(value).trim();
  return /^iso/i.test(str) ? str : `ISO ${str}`;
}

function exifLine({ camera, lens, mm, aperture, shutter, iso }) {
  const focalAperture = [formatFocal(mm), formatAperture(aperture)].filter(Boolean).join(" ");
  return [camera, lens, focalAperture, formatShutter(shutter), formatIso(iso)].filter(Boolean).join(" · ");
}

function readPhotosInDir(dirPath, files) {
  const captions = readCaptions(dirPath);
  const captionsByLowerName = Object.fromEntries(
    Object.entries(captions).map(([name, meta]) => [name.toLowerCase(), meta])
  );

  return files.map((file, i) => {
    const meta = captionsByLowerName[file.toLowerCase()] || {};
    return {
      index: i + 1,
      srcPath: path.join(dirPath, file),
      srcFile: file,
      country: meta.country || "",
      city: meta.city || "",
      venue: meta.venue || "",
      date: meta.date || "",
      camera: meta.camera || "",
      lens: meta.lens || "",
      aperture: meta.aperture || "",
      mm: meta.mm || "",
      shutter: meta.shutter || "",
      iso: meta.iso || "",
      caption: meta.caption || "",
    };
  });
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

    return {
      folderName: entry.name,
      dirPath,
      displayName,
      slug: slugify(displayName),
      order,
      photos: readPhotosInDir(dirPath, files),
    };
  });

  return categories
    .filter((c) => c.photos.length > 0)
    .sort((a, b) => (a.order - b.order) || collator.compare(a.displayName, b.displayName));
}

// Photos dropped directly in photos/ (not inside a category subfolder) have
// no nav label of their own and are shown uncategorized on the homepage.
function readRootPhotos() {
  if (!existsSync(PHOTOS_DIR)) return null;

  const files = readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(collator.compare);

  if (files.length === 0) return null;

  return {
    folderName: "",
    dirPath: PHOTOS_DIR,
    displayName: "",
    slug: "",
    order: -Infinity,
    photos: readPhotosInDir(PHOTOS_DIR, files),
  };
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
  const base = category.slug ? `${category.slug}/` : "";
  const tiles = category.photos.map((p) => {
    const alt = p.caption || `${category.displayName || SITE_TITLE} photo ${p.index}`;
    return `
      <a class="grid__item" href="/${base}${p.index}.html">
        <img src="/assets/${base}thumb/${p.index}.jpg" alt="${escapeHtml(alt)}" loading="lazy">
        <span class="grid__corner grid__corner--tl" aria-hidden="true"></span>
        <span class="grid__corner grid__corner--br" aria-hidden="true"></span>
      </a>`;
  }).join("");

  const title = category.displayName ? `<h1 class="category-title">${escapeHtml(category.displayName)}</h1>` : "";
  return `${title}
    <div class="grid">${tiles}
    </div>`;
}

function renderPhotoBody(category, photo, total) {
  const base = category.slug ? `${category.slug}/` : "";
  const prev = category.photos[(photo.index - 2 + total) % total];
  const next = category.photos[photo.index % total];
  const location = locationLine(photo);
  const exif = exifLine(photo);
  const alt = photo.caption || `${category.displayName || SITE_TITLE} photo ${photo.index}`;

  const caption = (location || exif || photo.caption) ? `
    <div class="photo-caption">
      ${location ? `<div class="photo-caption__location">${escapeHtml(location)}</div>` : ""}
      ${exif ? `<div class="photo-caption__exif">${escapeHtml(exif)}</div>` : ""}
      ${photo.caption ? `<p class="photo-caption__text">${escapeHtml(photo.caption)}</p>` : ""}
    </div>` : "";

  return `<div class="photo-view">
      <div class="photo-view__frame">
        <img class="photo-view__image" src="/assets/${base}full/${photo.index}.jpg" alt="${escapeHtml(alt)}">
        <span class="photo-view__corner photo-view__corner--tl" aria-hidden="true"></span>
        <span class="photo-view__corner photo-view__corner--br" aria-hidden="true"></span>
      </div>
    </div>
    <div class="photo-nav">
      <a class="photo-nav__arrow photo-nav__arrow--prev" href="/${base}${prev.index}.html" aria-label="Previous photo">&#8249;</a>
      <span class="photo-nav__counter">${photo.index} / ${total}</span>
      <a class="photo-nav__arrow photo-nav__arrow--next" href="/${base}${next.index}.html" aria-label="Next photo">&#8250;</a>
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

function photoPageTitle(category, photo) {
  return category.displayName
    ? `${category.displayName} #${photo.index} — ${SITE_TITLE}`
    : `${SITE_TITLE} #${photo.index}`;
}

function photoPageDescription(category, photo) {
  if (photo.caption) return photo.caption;
  const suffix = category.displayName
    ? `${category.displayName}, street photography by ${SITE_TITLE}.`
    : `Street photography by ${SITE_TITLE}.`;
  const location = locationLine(photo);
  return location ? `${location} — ${suffix}` : suffix;
}

async function writePhotoPages(category, categories, outDir) {
  const total = category.photos.length;
  for (const photo of category.photos) {
    const html = renderPage({
      title: photoPageTitle(category, photo),
      description: photoPageDescription(category, photo),
      activeSlug: category.slug,
      categories,
      body: renderPhotoBody(category, photo, total),
      bodyClass: "photo-page",
    });
    await writeFile(path.join(outDir, `${photo.index}.html`), html);
  }
}

async function build() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });
  copyStaticFiles();

  const categories = readCategories();
  const rootCategory = readRootPhotos();

  if (categories.length === 0 && !rootCategory) {
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
    await writePhotoPages(category, categories, catDir);
  }

  // Photos dropped directly in photos/ (no subfolder) have no nav tab of
  // their own and live at the site root instead of under a category slug.
  if (rootCategory) {
    await processImages(rootCategory);
    await writePhotoPages(rootCategory, categories, DIST_DIR);
  }

  // Homepage: uncategorized root photos take priority, otherwise mirror the first category.
  const home = rootCategory || categories[0];
  const homeHtml = renderPage({
    title: SITE_TITLE,
    description: `Street photography by ${SITE_TITLE}.`,
    activeSlug: home.slug,
    categories,
    body: renderGridBody(home),
  });
  await writeFile(path.join(DIST_DIR, "index.html"), homeHtml);

  const totalPhotos = categories.reduce((n, c) => n + c.photos.length, 0) + (rootCategory ? rootCategory.photos.length : 0);
  console.log(`Built ${categories.length} categories, ${totalPhotos} photos.`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
