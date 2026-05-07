const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const BIOLOGY_CLASSES = ['B11', 'B12'];
const REPORT_DIR = path.join(ROOT, 'audit', 'reports');
const OUTPUT_DIR = path.join(__dirname, 'data');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function toSlug(text) {
  return String(text || '')
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function basenameWithoutExt(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function safeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function chapterDirs() {
  return BIOLOGY_CLASSES.map((classCode) => path.join(RAW_DIR, 'BIOLOGY', classCode, 'chapters'));
}

function listChapterFiles() {
  return chapterDirs()
    .flatMap((dirPath) => (fs.existsSync(dirPath)
      ? fs.readdirSync(dirPath).filter((fileName) => fileName.endsWith('.json')).sort().map((fileName) => path.join(dirPath, fileName))
      : []));
}

function buildQuestionSummary(question, chapterSlug, biologyClass) {
  const images = Array.isArray(question.images) ? question.images : [];
  const tables = Array.isArray(question.tables) ? question.tables : [];
  const explanationText = safeText(question.explanation);

  return {
    id: question.id,
    year: safeText(question.year),
    text: safeText(question.text),
    answer: safeText(question.answer).toUpperCase(),
    chapter: safeText(question.chapter),
    options: question.options || {},
    optionExtraction: question.optionExtraction || null,
    parserWarnings: Array.isArray(question.parserWarnings) ? question.parserWarnings : [],
    explanation: explanationText,
    images: images.map((imagePath, index) => ({
      id: `${biologyClass || 'BIOLOGY'}-${chapterSlug}-${question.id}-image-${index + 1}`,
      path: imagePath,
      url: `../data/assets/${imagePath}`,
    })),
    tables,
    hasExplanation: Boolean(explanationText),
    searchText: [
      question.id,
      question.year,
      question.text,
      Object.values(question.options || {}).join(' '),
      explanationText,
      ...(Array.isArray(question.parserWarnings) ? question.parserWarnings : []),
      question.optionExtraction && question.optionExtraction.status,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

function buildChapterRecord(filePath, pyqEntry, auditEntry, residualEntry, alignmentEntry, schemaFailures) {
  const questions = readJson(filePath, []);
  const slug = basenameWithoutExt(filePath);
  const title = safeText(questions[0] && questions[0].chapter) || safeText(pyqEntry && pyqEntry.chapter && pyqEntry.chapter.title) || slug;
  const biologyClass = String((questions[0] && questions[0].class) || (pyqEntry && pyqEntry.chapter && pyqEntry.chapter.biologyClass) || (pyqEntry && pyqEntry.chapter && pyqEntry.chapter.classCode) || (pyqEntry && pyqEntry.chapter && pyqEntry.chapter.class) || 'B12').toUpperCase();
  const questionSummaries = questions.map((question) => buildQuestionSummary(question, slug, biologyClass));
  const imageCount = questionSummaries.reduce((total, question) => total + question.images.length, 0);
  const optionAnomalyCount = questionSummaries.filter((question) => {
    const status = question.optionExtraction && question.optionExtraction.status;
    return status && status !== 'parsed';
  }).length;
  const tableCount = questionSummaries.reduce((total, question) => total + question.tables.length, 0);
  const years = [...new Set(questionSummaries.map((question) => question.year).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const auditWeakMatches = (alignmentEntry && Array.isArray(alignmentEntry.alignments) ? alignmentEntry.alignments : [])
    .filter((row) => !row.matched || Number(row.score) < 0.6)
    .map((row) => ({
      sourceIndex: row.source_index,
      scrapedIndex: row.scraped_index,
      scrapedId: row.scraped_id || null,
      sourceYear: row.source_year || null,
      scrapedYear: row.scraped_year || null,
      score: Number(row.score || 0),
      matched: Boolean(row.matched),
    }));

  return {
    key: `${biologyClass}:${slug}`,
    slug,
    biologyClass,
    title,
    questionCount: questionSummaries.length,
    imageCount,
    tableCount,
    optionAnomalyCount,
    years,
    yearRange: years.length ? `${years[years.length - 1]}-${years[0]}` : null,
    chapterLink: pyqEntry ? pyqEntry.chapter : null,
    pyqLinks: pyqEntry ? pyqEntry.pyqLinks : [],
    scraped: fs.existsSync(filePath),
    audited: Boolean(auditEntry),
    risk: auditEntry ? auditEntry.risk : 'unknown',
    audit: auditEntry
      ? {
          expectedQuestionCount: auditEntry.expected_question_count,
          scrapedQuestionCount: auditEntry.scraped_question_count,
          schemaErrorCount: auditEntry.schema_error_count,
          structuralAccuracy: auditEntry.structural_accuracy,
          completenessAccuracy: auditEntry.completeness_accuracy,
          semanticAccuracy: auditEntry.semantic_accuracy,
          schemaGapRisk: auditEntry.schema_gap_risk,
          anomalyScore: auditEntry.anomaly_score,
          finalAccuracy: auditEntry.final_accuracy,
          residual: residualEntry || null,
          weakMatches: auditWeakMatches,
          weakMatchCount: auditWeakMatches.length,
          schemaFailures,
        }
      : null,
    questions: questionSummaries,
  };
}

function main() {
  ensureDir(OUTPUT_DIR);

  const pyqIndex = readJson(path.join(RAW_DIR, 'pyq-links.json'), {
    courseUrl: null,
    courseTitle: null,
    chapterCount: 0,
    pyqChapterCount: 0,
    chapters: [],
  });
  const chapterSummary = readJson(path.join(REPORT_DIR, 'chapter_summary.json'), []);
  const highRiskChapters = readJson(path.join(REPORT_DIR, 'high_risk_chapters.json'), []);
  const residualReport = readJson(path.join(REPORT_DIR, 'residual_text_report.json'), []);
  const schemaFailures = readJson(path.join(REPORT_DIR, 'schema_failures.json'), []);
  const questionAlignment = readJson(path.join(REPORT_DIR, 'question_alignment.json'), []);

  const auditBySlug = new Map(
    chapterSummary.map((entry) => [basenameWithoutExt(entry.json_path), entry])
  );
  const residualBySlug = new Map(
    residualReport.map((entry) => [basenameWithoutExt(entry.json_path), entry])
  );
  const alignmentBySlug = new Map(
    questionAlignment.map((entry) => [basenameWithoutExt(entry.json_path), entry])
  );
  const schemaFailuresBySlug = new Map();

  for (const failure of schemaFailures) {
    const slug = basenameWithoutExt(failure.json_path || '');
    if (!schemaFailuresBySlug.has(slug)) schemaFailuresBySlug.set(slug, []);
    schemaFailuresBySlug.get(slug).push(failure);
  }

  const pyqBySlug = new Map(
    (pyqIndex.chapters || []).map((entry) => [
      `${String(entry.chapter && entry.chapter.biologyClass || entry.chapter && entry.chapter.class || 'B12').toUpperCase()}:${toSlug(entry.chapter && entry.chapter.title)}`,
      entry
    ])
  );

  const chapterFiles = listChapterFiles();

  const chapters = chapterFiles.map((filePath) => {
    const slug = basenameWithoutExt(filePath);
    const questions = readJson(filePath, []);
    const biologyClass = String((questions[0] && questions[0].class) || 'B12').toUpperCase();
    return buildChapterRecord(
      filePath,
      pyqBySlug.get(`${biologyClass}:${slug}`) || null,
      auditBySlug.get(slug) || null,
      residualBySlug.get(slug) || null,
      alignmentBySlug.get(slug) || null,
      schemaFailuresBySlug.get(slug) || []
    );
  });

  const orphanPyqEntries = (pyqIndex.chapters || [])
    .filter((entry) => !chapters.some((chapter) => chapter.slug === toSlug(entry.chapter && entry.chapter.title) && chapter.biologyClass === String(entry.chapter && entry.chapter.biologyClass || entry.chapter && entry.chapter.class || 'B12').toUpperCase()))
    .map((entry) => ({
      key: `${String(entry.chapter && entry.chapter.biologyClass || entry.chapter && entry.chapter.class || 'B12').toUpperCase()}:${toSlug(entry.chapter && entry.chapter.title)}`,
      slug: toSlug(entry.chapter && entry.chapter.title),
      biologyClass: String(entry.chapter && entry.chapter.biologyClass || entry.chapter && entry.chapter.class || 'B12').toUpperCase(),
      title: safeText(entry.chapter && entry.chapter.title),
      chapterLink: entry.chapter,
      pyqLinks: entry.pyqLinks || [],
      scraped: false,
      audited: false,
      risk: 'unknown',
      questionCount: 0,
      imageCount: 0,
      tableCount: 0,
      years: [],
      yearRange: null,
      audit: null,
      questions: [],
    }));

  const allChapters = [...chapters, ...orphanPyqEntries].sort((left, right) => `${left.biologyClass}:${left.title}`.localeCompare(`${right.biologyClass}:${right.title}`));

  const overview = {
    generatedAt: new Date().toISOString(),
    courseTitle: pyqIndex.courseTitle,
    courseUrl: pyqIndex.courseUrl,
    chapterCount: pyqIndex.chapterCount || allChapters.length,
    pyqChapterCount: pyqIndex.pyqChapterCount || 0,
    scrapedChapterCount: allChapters.filter((chapter) => chapter.scraped).length,
    auditedChapterCount: allChapters.filter((chapter) => chapter.audited).length,
    totalQuestions: allChapters.reduce((total, chapter) => total + chapter.questionCount, 0),
    totalImages: allChapters.reduce((total, chapter) => total + chapter.imageCount, 0),
    totalTables: allChapters.reduce((total, chapter) => total + chapter.tableCount, 0),
    highRiskCount: allChapters.filter((chapter) => chapter.risk === 'high').length,
    mediumRiskCount: allChapters.filter((chapter) => chapter.risk === 'medium').length,
    schemaFailureCount: schemaFailures.length,
    benchmarkCoverage: chapterSummary.length,
  };

  const auditSummary = {
    generatedAt: overview.generatedAt,
    chapters: allChapters
      .filter((chapter) => chapter.audited)
      .map((chapter) => ({
        slug: chapter.slug,
        title: chapter.title,
        risk: chapter.risk,
        expectedQuestionCount: chapter.audit.expectedQuestionCount,
        scrapedQuestionCount: chapter.audit.scrapedQuestionCount,
        structuralAccuracy: chapter.audit.structuralAccuracy,
        completenessAccuracy: chapter.audit.completenessAccuracy,
        semanticAccuracy: chapter.audit.semanticAccuracy,
        schemaGapRisk: chapter.audit.schemaGapRisk,
        anomalyScore: chapter.audit.anomalyScore,
        finalAccuracy: chapter.audit.finalAccuracy,
        weakMatchCount: chapter.audit.weakMatchCount,
        missingQuestionRatio: chapter.audit.residual ? chapter.audit.residual.missing_question_ratio : null,
        residualBlockRatio: chapter.audit.residual ? chapter.audit.residual.residual_block_ratio : null,
      })),
    highRiskChapters: highRiskChapters.map((entry) => ({
      slug: basenameWithoutExt(entry.json_path),
      title: basenameWithoutExt(entry.json_path)
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      risk: entry.risk,
      finalAccuracy: entry.final_accuracy,
      schemaGapRisk: entry.schema_gap_risk,
      scrapedQuestionCount: entry.scraped_question_count,
      expectedQuestionCount: entry.expected_question_count,
    })),
    schemaFailures,
    residualReport,
  };

  const auditAlignment = {
    generatedAt: overview.generatedAt,
    chapters: allChapters
      .filter((chapter) => chapter.audited)
      .map((chapter) => ({
        slug: chapter.slug,
        title: chapter.title,
        risk: chapter.risk,
        weakMatches: chapter.audit.weakMatches,
      })),
  };

  const runbook = {
    generatedAt: overview.generatedAt,
    commands: [
      {
        id: 'scrape-chapters',
        label: 'Discover course chapters',
        command: 'npm run scrape:chapters',
        output: 'data/raw/chapter-links.json',
        description: 'Refresh the ordered chapter inventory from the Biology course page.',
      },
      {
        id: 'scrape-pyq-links',
        label: 'Verify chapter PYQ links',
        command: 'npm run scrape:pyq-links',
        output: 'data/raw/pyq-links.json',
        description: 'Refresh the chapter-to-PYQ document mapping used by batch scraping.',
      },
      {
        id: 'scrape-multi',
        label: 'Scrape all chapter PYQs',
        command: 'npm run scrape:multi',
        output: 'data/raw/BIOLOGY/B11|B12/chapters/*.json',
        description: 'Regenerate chapter question JSON and diagram assets for every verified PYQ page.',
      },
      {
        id: 'audit',
        label: 'Run benchmark audit',
        command: 'npm run audit',
        output: 'audit/reports/*.json',
        description: 'Recompute structural, completeness, semantic, and schema-gap audit reports.',
      },
      {
        id: 'dashboard-build',
        label: 'Rebuild dashboard data',
        command: 'npm run dashboard:build',
        output: 'dashboard/data/*',
        description: 'Regenerate dashboard-ready snapshots from the latest scraper and audit artifacts.',
      },
      {
        id: 'dashboard-serve',
        label: 'Serve dashboard locally',
        command: 'npm run dashboard:serve',
        output: 'http://localhost:4173/dashboard/',
        description: 'Serve the repo root so the static dashboard and image assets are available in a browser.',
      },
    ],
    workflow: [
      'Run chapter discovery when the course inventory changes.',
      'Refresh PYQ links before multi-chapter scraping.',
      'Scrape all verified chapter PYQ pages to update raw chapter JSON and assets.',
      'Run the audit to refresh benchmark risk metrics.',
      'Rebuild dashboard data so the UI reflects the latest artifacts.',
      'Open /dashboard/ in a browser to inspect tracking, questions, and audit drilldowns.',
    ],
  };

  writeJson(path.join(OUTPUT_DIR, 'overview.json'), overview);
  writeJson(path.join(OUTPUT_DIR, 'chapters.json'), allChapters);
  writeJson(path.join(OUTPUT_DIR, 'audit-summary.json'), auditSummary);
  writeJson(path.join(OUTPUT_DIR, 'audit-alignment.json'), auditAlignment);
  writeJson(path.join(OUTPUT_DIR, 'runbook.json'), runbook);

  const dashboardData = {
    overview,
    chapters: allChapters,
    auditSummary,
    auditAlignment,
    runbook,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'dashboard-data.js'),
    `window.__DASHBOARD_DATA__ = ${JSON.stringify(dashboardData, null, 2)};\n`
  );

  console.log(`Dashboard data built for ${allChapters.length} chapters.`);
}

main();
