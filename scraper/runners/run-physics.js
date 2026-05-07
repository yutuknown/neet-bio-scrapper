const { main: runClass11 } = require('../subjects/physics/class-11.scraper');
const { main: runClass12 } = require('../subjects/physics/class-12.scraper');

function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'class11') {
    return runClass11(argv.slice(1));
  }

  if (argv[0] === 'class12') {
    return runClass12(argv.slice(1));
  }

  runClass11([]);
  runClass12([]);
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
  main
};
