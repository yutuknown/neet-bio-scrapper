const { BIOLOGY_CLASS_SOURCES } = require('../../core/config');
const { createBiologyController } = require('./biology.controller');

const controller = createBiologyController({
  biologyClass: 'B12',
  defaultSource: BIOLOGY_CLASS_SOURCES.B12,
  scriptName: 'node scraper/subjects/biology/class-12.scraper.js'
});

function main(argv = process.argv.slice(2)) {
  return controller.main(argv);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  printUsage: controller.printUsage
};
