const { PHYSICS_CLASS_SOURCES } = require('../../core/config');
const { copyArgs, firstSourceArg } = require('../../core/utils');
const { scrapeEduRev } = require('../../core/scraper');
const { scrapeChapterLinks } = require('../../core/course-chapter-links');
const { scrapeCoursePyqLinks } = require('../../core/pyq-links');
const { scrapeAllChapters } = require('../../core/multi-chapter-scraper');

function createPhysicsController({
  classCode = 'P12',
  defaultSource = PHYSICS_CLASS_SOURCES[classCode],
  scriptName = 'node scraper/subjects/physics/class-12.scraper.js'
} = {}) {
  function printUsage() {
    console.log(`Usage:
  ${scriptName}
  ${scriptName} --chapters [course-url-or-html-path]
  ${scriptName} --pyq-links [course-url-or-html-path]
  ${scriptName} --multi [course-url-or-html-path]
  ${scriptName} --pyq <pyq-url-or-html-path> [--chapter-title "..."] [--chapter-slug "..."] [--class-code ${classCode}]
`);
  }

  function main(argv = []) {
    const args = copyArgs(argv);

    if (args.includes('--help') || args.includes('-h')) {
      printUsage();
      return;
    }

    if (args.includes('--pyq')) {
      const childArgs = [...args];
      const sourceArgIndex = childArgs.findIndex((arg, index) => index > 0 && !String(arg).startsWith('--') && childArgs[index - 1] !== '--chapter-title' && childArgs[index - 1] !== '--chapter-slug' && childArgs[index - 1] !== '--class-code' && childArgs[index - 1] !== '--class');
      if (sourceArgIndex === -1) {
        throw new Error('Missing PYQ source after --pyq');
      }
      const source = childArgs[sourceArgIndex];
      const options = { subject: 'physics', classCode };
      for (let i = 0; i < childArgs.length; i += 1) {
        const value = childArgs[i + 1];
        if (childArgs[i] === '--chapter-title' && value) options.chapterTitle = value;
        if (childArgs[i] === '--chapter-slug' && value) options.chapterSlug = value;
        if (childArgs[i] === '--class-code' && value) options.classCode = value;
        if (childArgs[i] === '--class' && value) options.class = value;
      }
      scrapeEduRev(source, options).catch((err) => {
        console.error('❌ Error:', err.message);
        process.exitCode = 1;
      });
      return;
    }

    const source = firstSourceArg(args, defaultSource);

    if (args.includes('--chapters')) {
      scrapeChapterLinks(source).catch((err) => {
        console.error('❌ Error:', err.message);
        process.exitCode = 1;
      });
      return;
    }

    if (args.includes('--pyq-links')) {
      scrapeCoursePyqLinks(source).catch((err) => {
        console.error('❌ Error:', err.message);
        process.exitCode = 1;
      });
      return;
    }

    scrapeAllChapters(source).catch((err) => {
      console.error('❌ Error:', err.message);
      process.exitCode = 1;
    });
  }

  return {
    main,
    printUsage
  };
}

module.exports = {
  createPhysicsController
};
