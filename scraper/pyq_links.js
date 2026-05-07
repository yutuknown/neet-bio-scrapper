const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

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

function parseDocumentHref(href) {
    const match = href.match(/^\/t\/(\d+)\/([^?#]+)/i);
    if (!match) return null;

    return {
        id: match[1],
        slug: match[2]
    };
}

function parseCourseId(source) {
    const match = source.match(/\/courses\/(\d+)_/i);
    return match ? match[1] : '';
}

async function loadHtml(source) {
    if (source.startsWith('http')) {
        const response = await fetch(source, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.text();
    }

    const filePath = source.startsWith('file://') ? source.replace('file://', '') : source;
    return fs.readFileSync(filePath, 'utf8');
}

function extractCourseTitle($) {
    const h1 = clean($('h1').first().text());
    if (h1) return h1;

    const hiddenTitle = clean($('#leftSideCourseTitleHidden').attr('value') || '');
    if (hiddenTitle) return hiddenTitle;

    return '';
}

function normalizeChapterTitle(title) {
    return clean(title)
        .replace(/\s+Biology Class 12.*$/i, '')
        .replace(/\s+-\s+NEET.*$/i, '')
        .replace(/\s+NEET.*$/i, '')
        .trim();
}

function normalizeTopicKey(title) {
    return normalizeChapterTitle(title)
        .replace(/^•\s*/, '')
        .replace(/^NEET Previous Year Questions\s*\([^)]*\)\s*:\s*/i, '')
        .replace(/^NEET Previous Year Questions\s*:\s*/i, '')
        .replace(/&/g, 'and')
        .replace(/:/g, ' ')
        .replace(/\bprinciples\b/gi, 'principle')
        .replace(/\bprocesses\b/gi, 'process')
        .replace(/\bapplications\b/gi, 'application')
        .replace(/\bdiseases\b/gi, 'disease')
        .replace(/\bpopulations\b/gi, 'population')
        .replace(/\bits\b/gi, 'its')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isRealSubjectChapter(title) {
    return !/(mindmaps|ncert based tests|tips\s*&\s*tricks|ppts?\b|flashcards?|dpp\b|revision notes|mnemonics|chapterwise previous year questions|ncert exemplar|cbse|past year papers|sample papers|full syllabus mocks|how to prepare)/i.test(title);
}

function extractChapterLinks($, courseId, courseTitle) {
    const chapters = [];
    const seen = new Set();
    const normalizedCourseTitle = normalizeTopicKey(courseTitle);

    $('a.crs_chptr[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (!href || !href.startsWith('/chapter/')) return;

        const parsed = parseChapterHref(href);
        if (!parsed) return;
        if (courseId && parsed.id === courseId) return;

        const title = clean($(anchor).find('h2.subcoursetitle').first().text() || $(anchor).text());
        if (!title || !isRealSubjectChapter(title)) return;

        const key = normalizeTopicKey(title);
        if (!key || key === normalizedCourseTitle || seen.has(key)) return;

        seen.add(key);
        chapters.push({
            index: chapters.length + 1,
            id: parsed.id,
            title: normalizeChapterTitle(title),
            url: toAbsoluteUrl(href),
            slug: parsed.slug
        });
    });

    return chapters;
}

function isNeetPyqTitle(title) {
    return /NEET Previous Year Questions/i.test(title) && !/CBSE Previous Year Questions/i.test(title);
}

function extractAnchorTitle($, anchor) {
    const $title = $(anchor).find('.subcoursetitle').first().clone();
    $title.find('span').remove();
    const nestedTitle = clean($title.text());
    if (nestedTitle) return nestedTitle;
    return clean($(anchor).text()).replace(/ Doc\s*\|.*$/i, '').trim();
}

function extractChapterPyqLinks($, chapter) {
    const matches = [];
    const seen = new Set();
    const chapterKey = normalizeTopicKey(chapter.title);

    $('a[href^="/t/"]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        const parsed = parseDocumentHref(href || '');
        if (!parsed) return;

        const title = extractAnchorTitle($, anchor).replace(/^•\s*/, '');
        if (!isNeetPyqTitle(title)) return;
        if (normalizeTopicKey(title) !== chapterKey) return;

        const url = toAbsoluteUrl(href);
        if (seen.has(url)) return;

        seen.add(url);
        matches.push({
            documentId: parsed.id,
            title,
            url,
            slug: parsed.slug
        });
    });

    return matches;
}

function extractPyqPageMetadata($) {
    return {
        pageTitle: clean($('title').text()),
        canonicalUrl: $('link[rel="canonical"]').attr('href') || '',
        courseTitle: clean($('.brdcrmb_cntnr a[href*="/courses/"], .breadcrumbspn a[href*="/courses/"]').first().text())
    };
}

async function verifyPyqLink(chapter, pyq) {
    const htmlText = await loadHtml(pyq.url);
    const $ = cheerio.load(htmlText);
    const metadata = extractPyqPageMetadata($);
    const chapterKey = normalizeTopicKey(chapter.title);
    const pageKey = normalizeTopicKey(metadata.pageTitle);

    return {
        verified: pageKey.includes(chapterKey) && /NEET Previous Year Questions/i.test(metadata.pageTitle) && (!metadata.courseTitle || /Biology Class 12/i.test(metadata.courseTitle)),
        canonicalUrl: metadata.canonicalUrl || pyq.url,
        pageTitle: metadata.pageTitle,
        courseTitle: metadata.courseTitle
    };
}

async function scrapeCoursePyqLinks(source) {
    console.log(`🚀 Fetching course: ${source}`);

    try {
        const courseHtml = await loadHtml(source);
        const $course = cheerio.load(courseHtml);
        const baseDir = path.join(__dirname, '../data/raw');
        const outputPath = path.join(baseDir, 'pyq-links.json');

        const courseTitle = extractCourseTitle($course);
        const courseId = parseCourseId(source) || parseCourseId($course('link[rel="canonical"]').attr('href') || '');
        const chapters = extractChapterLinks($course, courseId, courseTitle);
        if (chapters.length === 0) throw new Error('Could not find chapter links');

        const chapterResults = [];
        for (const chapter of chapters) {
            console.log(`🔎 Scanning chapter page: ${chapter.title}`);
            const chapterHtml = await loadHtml(chapter.url);
            const $chapter = cheerio.load(chapterHtml);
            const rawPyqs = extractChapterPyqLinks($chapter, chapter);

            const verifiedPyqs = [];
            for (const pyq of rawPyqs) {
                const verification = await verifyPyqLink(chapter, pyq);
                if (!verification.verified) continue;

                verifiedPyqs.push({
                    documentId: pyq.documentId,
                    title: pyq.title,
                    url: pyq.url,
                    slug: pyq.slug,
                    canonicalUrl: verification.canonicalUrl,
                    pageTitle: verification.pageTitle,
                    courseTitle: verification.courseTitle
                });
            }

            if (verifiedPyqs.length > 0) {
                chapterResults.push({
                    chapter,
                    pyqLinks: verifiedPyqs
                });
            }
        }

        const result = {
            courseUrl: source.startsWith('http') ? source : DEFAULT_COURSE_URL,
            courseTitle,
            chapterCount: chapters.length,
            pyqChapterCount: chapterResults.length,
            chapters: chapterResults
        };

        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        console.log(`✅ Success! ${chapterResults.length} chapters with NEET PYQ links saved.`);
        return result;
    } catch (err) {
        console.error('❌ Error:', err.message);
        throw err;
    }
}

module.exports = {
    scrapeCoursePyqLinks
};

const source = process.argv[2] || DEFAULT_COURSE_URL;
if (require.main === module) {
    scrapeCoursePyqLinks(source).catch(() => process.exitCode = 1);
}
