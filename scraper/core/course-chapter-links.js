const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const { loadHtml } = require('./browser');

const DEFAULT_COURSE_URL = 'https://edurev.in/courses/716_Biology-Class-12';
const EDUREV_BASE_URL = 'https://edurev.in';

const clean = (text) => text.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();

function toAbsoluteUrl(href) {
  return new URL(href, EDUREV_BASE_URL).toString();
}

function parseChapterHref(href) {
  const match = href.match(/^\/chapter\/(\d+)_([^?#]+)/i);
  if (!match) return null;

  return {
    id: match[1],
    slug: match[2]
  };
}

function extractCourseTitle($) {
  const h1 = clean($('h1').first().text());
  if (h1) return h1;

  const hiddenTitle = clean($('#leftSideCourseTitleHidden').attr('value') || '');
  if (hiddenTitle) return hiddenTitle;

  return '';
}

function extractChapterLinks($) {
  const chapters = [];
  const seen = new Set();

  $('a.crs_chptr[href]').each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!href || !href.startsWith('/chapter/')) return;

    const parsed = parseChapterHref(href);
    if (!parsed) return;

    const url = toAbsoluteUrl(href);
    if (seen.has(url)) return;

    const title = clean($(anchor).find('h2.subcoursetitle').first().text() || $(anchor).text());
    if (!title) return;

    seen.add(url);
    chapters.push({
      index: chapters.length + 1,
      id: parsed.id,
      title,
      url,
      slug: parsed.slug
    });
  });

  return chapters;
}

async function scrapeChapterLinks(source) {
  console.log(`🚀 Fetching: ${source}`);

  try {
    const htmlText = await loadHtml(source);
    const $ = cheerio.load(htmlText);
    const baseDir = path.join(__dirname, '../../data/raw');
    const outputPath = path.join(baseDir, 'chapter-links.json');

    const chapters = extractChapterLinks($);
    if (chapters.length === 0) throw new Error('Could not find chapter links');

    const result = {
      courseUrl: source.startsWith('http') ? source : DEFAULT_COURSE_URL,
      courseTitle: extractCourseTitle($),
      chapters
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`✅ Success! ${chapters.length} chapter links saved.`);
    return result;
  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  }
}

module.exports = {
  scrapeChapterLinks
};

const source = process.argv[2] || DEFAULT_COURSE_URL;
if (require.main === module) {
  scrapeChapterLinks(source).catch(() => {
    process.exitCode = 1;
  });
}
