const { PHYSICS_CLASS_SOURCES } = require('../../core/config');
const { createPhysicsController } = require('./physics.controller');

const controller = createPhysicsController({
  classCode: 'P12',
  defaultSource: PHYSICS_CLASS_SOURCES.P12,
  scriptName: 'node scraper/subjects/physics/class-12.scraper.js'
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
