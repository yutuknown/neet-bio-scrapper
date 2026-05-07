const path = require('path');

const SCRAPER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '../..');

function scraperPath(...parts) {
  return path.join(SCRAPER_ROOT, ...parts);
}

function subjectPath(subject, ...parts) {
  return path.join(SCRAPER_ROOT, 'subjects', subject, ...parts);
}

function runnerPath(...parts) {
  return path.join(SCRAPER_ROOT, 'runners', ...parts);
}

function subjectOutputRoots(subject, classCode, fallbackClassCode = 'B12') {
  const normalizedSubject = String(subject || 'biology').trim().toUpperCase();
  const normalizedClass = String(classCode || fallbackClassCode).trim().toUpperCase();
  return {
    rawChapterDir: path.join(REPO_ROOT, `data/raw/${normalizedSubject}`, normalizedClass, 'chapters'),
    assetRoot: path.join(REPO_ROOT, `data/assets/${normalizedSubject}`, normalizedClass, 'chapters')
  };
}

function biologyOutputRoots(classCode) {
  return subjectOutputRoots('BIOLOGY', classCode, 'B12');
}

module.exports = {
  SCRAPER_ROOT,
  REPO_ROOT,
  scraperPath,
  subjectPath,
  runnerPath,
  subjectOutputRoots,
  biologyOutputRoots
};
