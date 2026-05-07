const path = require('path');
const { scrapeCoursePyqLinks } = require('./pyq_links');
const { scrapeEduRev, toSlug } = require('./fast_scraper');

const DEFAULT_COURSE_SOURCE = 'https://edurev.in/courses/716_Biology-Class-12';

async function scrapeAllChapters(source) {
    console.log(`🚀 Starting multi-chapter scrape: ${source}`);

    const pyqIndex = await scrapeCoursePyqLinks(source);
    const results = [];

    for (const chapterEntry of pyqIndex.chapters) {
        const { chapter, pyqLinks } = chapterEntry;

        for (const pyq of pyqLinks) {
            console.log(`📘 Scraping chapter PYQ: ${chapter.title}`);
            const scrapeResult = await scrapeEduRev(pyq.canonicalUrl || pyq.url, {
                chapterTitle: chapter.title,
                chapterSlug: toSlug(chapter.title)
            });

            results.push({
                chapter,
                pyq,
                outputPath: scrapeResult.outputPath,
                assetDir: scrapeResult.assetDir,
                questionCount: scrapeResult.questionCount
            });
        }
    }

    console.log(`✅ Multi-chapter scrape complete. ${results.length} chapter files updated.`);
    return {
        source,
        chapterCount: results.length,
        chapters: results
    };
}

module.exports = {
    scrapeAllChapters
};

const source = process.argv[2] || path.join(__dirname, '../fixtures/edurev/Biology-Class-12--Notes--Questions--Videos--MCQs.html');
if (require.main === module) {
    scrapeAllChapters(source).catch(() => process.exitCode = 1);
}
