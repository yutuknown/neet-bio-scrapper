const { CHEMISTRY_CLASS_SOURCES } = require('../../core/config');
const { createChemistryController } = require('./chemistry.controller');

const controller = createChemistryController({
  classCode: 'C11',
  defaultSource: CHEMISTRY_CLASS_SOURCES.C11,
  scriptName: 'node scraper/subjects/chemistry/class-11.scraper.js'
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
