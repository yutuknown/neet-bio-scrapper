const DEFAULT_SUBJECT = 'biology';
const DEFAULT_BIOLOGY_CLASS = 'B12';

const BIOLOGY_CLASS_SOURCES = {
  B11: 'https://edurev.in/courses/1822_Biology-Class-11',
  B12: 'https://edurev.in/courses/716_Biology-Class-12'
};

const PHYSICS_CLASS_SOURCES = {
  P11: 'https://edurev.in/courses/592_Physics-Class-11',
  P12: 'https://edurev.in/courses/1643_Physics-Class-12'
};

const CHEMISTRY_CLASS_SOURCES = {
  C11: 'https://edurev.in/courses/626_Chemistry-Class-11',
  C12: 'https://edurev.in/courses/1548_Chemistry-Class-12'
};

const SUBJECTS = {
  biology: {
    folder: 'BIOLOGY',
    classes: ['B11', 'B12'],
    defaultClass: 'B12'
  },
  physics: {
    folder: 'PHYSICS',
    classes: ['P11', 'P12'],
    defaultClass: 'P12'
  },
  chemistry: {
    folder: 'CHEMISTRY',
    classes: ['C11', 'C12'],
    defaultClass: 'C12'
  }
};

module.exports = {
  DEFAULT_SUBJECT,
  DEFAULT_BIOLOGY_CLASS,
  BIOLOGY_CLASS_SOURCES,
  PHYSICS_CLASS_SOURCES,
  CHEMISTRY_CLASS_SOURCES,
  SUBJECTS
};
