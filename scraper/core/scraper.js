const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');

const { loadHtml } = require('./browser');
const { DEFAULT_BIOLOGY_CLASS, SUBJECTS } = require('./config');
const { subjectOutputRoots } = require('./paths');

const clean = (t) => t.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
const cleanLine = (t) => t.replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ').trim();
const chooserRegex = /Choose the (?:correct|most appropriate) answer from the options given below\s*:?|In the light of the above statements,?\s*choose the correct answer from the options given below\s*:?/i;
const uiArtifactRegex = /Type\s*Your\s*Answer|View\s*Answer|View\s*Solution|View\s*Correct|Hide\s*Explanation|Solution:?/gi;
const followupArtifactRegex = /MULTIPLE\s+CHOICE\s+QUESTION|Try\s*yourself|View\s*Solution|View\s*Correct|Hide\s*Explanation|Report\s+a\s*problem|Cancel\s*Report|CancelReport/gi;
const answerMarkerRegex = /\b(?:Correct\s*Answer|Ans(?:wer)?)\b[.:\s-]+/i;
const assertionReasonQuestionRegex = /\bAssertion\s*\(\s*A\s*\)|\bReason\s*\(\s*R\s*\)/i;
const statementPairQuestionRegex = /\bStatement\s*I\b[\s\S]*\bStatement\s*II\b/i;

function resolveSubject(options = {}) {
  const raw = String(options.subject || options.subjectCode || options.stream || 'biology').trim().toLowerCase();
  if (raw === 'physics' || raw === 'chemistry' || raw === 'biology') return raw;
  return 'biology';
}

function subjectClassNumber(classCode, fallbackClassCode = DEFAULT_BIOLOGY_CLASS) {
  return String(classCode || fallbackClassCode).trim().toUpperCase().replace(/^[A-Z]/, '') || '12';
}

function resolveSubjectClass(options = {}, ...candidates) {
  const subject = resolveSubject(options);
  const subjectConfig = SUBJECTS[subject] || SUBJECTS.biology;
  const [firstClass = subjectConfig.defaultClass, secondClass = subjectConfig.defaultClass] = subjectConfig.classes;
  const rawCandidates = [options.classCode, options.class, options.biologyClass, options.physicsClass, options.chemistryClass, ...candidates].filter(Boolean);

  for (const candidate of rawCandidates) {
    const value = String(candidate).trim().toUpperCase();
    if (value === firstClass || /\bCLASS\s*11\b/.test(value)) return firstClass;
    if (value === secondClass || /\bCLASS\s*12\b/.test(value)) return secondClass;
  }

  return subjectConfig.defaultClass;
}

function subjectRoots(subject, classCode) {
  const normalizedSubject = resolveSubject({ subject });
  const normalizedClass = resolveSubjectClass({ subject: normalizedSubject, classCode });
  return subjectOutputRoots((SUBJECTS[normalizedSubject] || SUBJECTS.biology).folder, normalizedClass, (SUBJECTS[normalizedSubject] || SUBJECTS.biology).defaultClass);
}

function subjectClassTitle(subject, classCode) {
  const normalizedSubject = resolveSubject({ subject });
  const classNumber = subjectClassNumber(classCode, (SUBJECTS[normalizedSubject] || SUBJECTS.biology).defaultClass);
  const subjectTitle = normalizedSubject.charAt(0).toUpperCase() + normalizedSubject.slice(1);
  return `${subjectTitle} Class ${classNumber}`;
}

function subjectClassPattern(subject, classCode) {
  return new RegExp(subjectClassTitle(subject, classCode), 'i');
}

function subjectClassSuffix(subject, classCode) {
  return resolveSubjectClass({ subject, classCode });
}

function resolveBiologyClass(options = {}, ...candidates) {
  return resolveSubjectClass({ ...options, subject: 'biology' }, ...candidates);
}

function biologyRoots(classCode) {
  return subjectRoots('biology', classCode);
}

function biologyClassPattern(classCode) {
  return subjectClassPattern('biology', classCode);
}

function biologyClassSuffix(classCode) {
  return subjectClassSuffix('biology', classCode);
}

function stripImageTokens(text) {
  return text.replace(/\[IMG:[^\]]+\]/gi, '').replace(/\[IMG\]/gi, '');
}

function stripEmbeddedQuestionWidgets($node) {
  const $clean = $node.clone();
  $clean.find('.nq2_question_block, .nq2_card, .nq2_report_row, .nq2_report_form, .nq2_sol_panel').remove();
  return $clean;
}

function extractQuestionWidgetLines($node) {
  const $questionClone = $node.clone();
  $questionClone.find('.nq2_options_grid, .nq2_sol_panel, .nq2_report_row, .nq2_report_form, .nq2_type_label_wrap').remove();

  const lines = [];
  const questionText = cleanLine($questionClone.text().replace(/^Try yourself:\s*/i, ''));
  if (questionText) lines.push(questionText);

  $node.find('.nq2_option').each((_, opt) => {
    const label = cleanLine($node.find(opt).find('.nq2_opt_letter').first().text()).toLowerCase();
    const value = cleanLine($node.find(opt).find('.nq2_opt_text').first().text());
    if (label && value) {
      lines.push(`(${label}) ${value}`);
    }
  });

  const answerLabel = cleanLine($node.find('.nq2_sol_label').first().text());
  const answerMatch = answerLabel.match(/Correct\s*Answer\s*:\s*([a-d])/i);
  if (answerMatch) {
    lines.push(`Ans: (${answerMatch[1].toLowerCase()})`);
  }

  $node.find('.nq2_sol_body li').each((_, item) => {
    const text = cleanLine($node.find(item).text());
    if (text) lines.push(text);
  });

  return lines.filter(Boolean);
}

function stripFollowupArtifacts(text) {
  return text
    .replace(followupArtifactRegex, ' ')
    .replace(/Report[\s\S]*$/i, ' ');
}

function cleanQuestionText(text) {
  return clean(
    stripFollowupArtifacts(
      stripImageTokens(text)
        .replace(uiArtifactRegex, ' ')
        .replace(/Correct\s*Answer\s*:[\s\S]*$/i, ' ')
        .replace(/^Q\s*\d+[:\s.]*/i, '')
        .replace(/\s*\(NEET[^)]*\)/gi, '')
        .replace(/(?:\(\s*[a-d]\s*\)\s*){2,}/gi, ' ')
        .replace(/\s*Choose the (?:correct|most appropriate) answer from the options given below\s*:?\s*$/i, '')
        .replace(/\s*In the light of the above statements,?\s*choose the correct answer from the options given below\s*:?\s*$/i, '')
        .replace(/\s*In the light of the above statements,?\s*$/i, '')
        .replace(/[\s,;:.-]+$/g, '')
    )
  );
}

function normalizeOptionValue(text) {
  return clean(
    stripFollowupArtifacts(
      text
        .replace(/\[IMG:[^\]]+\]/gi, '[diagram]')
        .replace(uiArtifactRegex, ' ')
        .replace(/Correct\s*Answer\s*:[\s\S]*$/i, ' ')
        .replace(/\bCorrect\b\s*$/i, '')
        .replace(/\s*\(NEET[^)]*\)/gi, '')
        .replace(/^[\s:.-]+/, '')
    )
  );
}

function buildAssertionReasonOptions() {
  return {
    A: 'Both Statement I and Statement II are true.',
    B: 'Both Statement I and Statement II are false.',
    C: 'Statement I is true but Statement II is false.',
    D: 'Statement I is false but Statement II is true.'
  };
}

function inferAnswerFromExplanation(text) {
  const normalized = clean(text).toLowerCase();

  if (/both\s+(?:statement\s*i|a)\s+and\s+(?:statement\s*ii|r)\s+are\s+true/.test(normalized)) {
    if (/correct explanation|explains?\s+(?:statement\s*i|assertion|a)/.test(normalized)) return 'a';
    return 'a';
  }

  if (/both\s+(?:statement\s*i|a)\s+and\s+(?:statement\s*ii|r)\s+are\s+false/.test(normalized)) {
    return 'b';
  }

  if (/(?:statement\s*i|assertion|a)\s+is\s+true\s+but\s+(?:statement\s*ii|reason|r)\s+is\s+false/.test(normalized)) {
    return 'c';
  }

  if (/(?:statement\s*i|assertion|a)\s+is\s+false\s+but\s+(?:statement\s*ii|reason|r)\s+is\s+true/.test(normalized)) {
    return 'd';
  }

  if (/statement\s*i\s+is\s+incorrect\s+but\s+statement\s*ii\s+is\s+correct/.test(normalized)) {
    return 'd';
  }

  if (/statement\s*i\s+is\s+correct\s+but\s+statement\s*ii\s+is\s+incorrect/.test(normalized)) {
    return 'c';
  }

  return '';
}

function shouldUseAssertionReasonDefaults(text, options) {
  const nonEmptyOptionCount = countNonEmptyOptions(options);
  if (nonEmptyOptionCount > 0) return false;
  return assertionReasonQuestionRegex.test(text) || statementPairQuestionRegex.test(text);
}

function countImageTokens(text) {
  return (text.match(/\[IMG(?::[^\]]+)?\]/gi) || []).length;
}

function countNonEmptyOptions(options) {
  return ['A', 'B', 'C', 'D'].filter((label) => clean(String(options[label] || ''))).length;
}

function hasMeaningfulOptionValue(value) {
  const normalized = clean(String(value || ''));
  if (!normalized) return false;
  if (/\[diagram\]|\[img(?:[:\]])/i.test(normalized)) return true;
  return /[\p{L}\p{N}]/u.test(normalized);
}

function isUsableOptionSet(options) {
  return ['A', 'B', 'C', 'D'].every((label) => hasMeaningfulOptionValue(options[label]));
}

function buildOptionDiagnostics(rawText, options, source) {
  const imageTokenCount = countImageTokens(rawText);
  const nonEmptyOptionCount = countNonEmptyOptions(options);
  const optionExtraction = {
    source,
    status: 'parsed',
    imageTokenCount,
    nonEmptyOptionCount
  };
  const parserWarnings = [];

  if (nonEmptyOptionCount === 0) {
    optionExtraction.status = imageTokenCount > 0 ? 'image_backed_unresolved' : 'missing';
    parserWarnings.push(
      imageTokenCount > 0
        ? 'Option content appears to be image-backed and could not be extracted as text.'
        : 'Option content could not be extracted from the source block.'
    );
  } else if (nonEmptyOptionCount < 4) {
    optionExtraction.status = 'partial';
    parserWarnings.push('Only part of the option set was extracted from the source block.');
  }

  return {
    optionExtraction,
    parserWarnings
  };
}

function finalizeParsedQuestion(rawText, text, options, source) {
  const finalOptions = shouldUseAssertionReasonDefaults(text, options)
    ? buildAssertionReasonOptions()
    : options;

  return {
    text,
    options: finalOptions,
    ...buildOptionDiagnostics(rawText, finalOptions, source)
  };
}

function normalizePageTitle(text) {
  return clean(text).replace(/\|\s*(?:Biology|Physics|Chemistry) Class \d+ PDF Download.*$/i, '').trim();
}

function extractChapterTitle($, source) {
  const candidates = [
    normalizePageTitle($('title').text()),
    normalizePageTitle($('h1').first().text())
  ].filter(Boolean);

  for (const candidate of candidates) {
    const chapterTitle = candidate
      .replace(/^NEET Previous Year Questions\s*\([^)]*\)\s*:\s*/i, '')
      .replace(/^NEET Previous Year Questions\s*:\s*/i, '')
      .replace(/^NEET Previous Year Questions\s*/i, '')
      .trim();

    if (chapterTitle) return chapterTitle;
  }

  return clean(path.basename(source, path.extname(source)).replace(/[-_]+/g, ' '));
}

function normalizeChapterKey(text) {
  return clean(text)
    .replace(/&/g, ' and ')
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

function toSlug(text) {
  return clean(text)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function detectAssetExtension(url) {
  const match = url.match(/\.(svg|png|jpe?g|webp|gif)(?:[?#]|$)/i);
  if (!match) return '.png';
  return `.${match[1].toLowerCase()}`;
}

const CUSTOM_ASSET_PREFIXES = {
  'biodiversity-and-its-conservation': 'biodiversity-',
  'human-health-and-diseases': 'human-health-',
  'human-reproduction': 'reproduction-',
  'microbes-in-human-welfare': 'microbes-',
  'molecular-basis-of-inheritance': 'mbi-',
  'principles-of-inheritance-and-variation': 'piv-'
};

function longAssetPrefixFromChapterSlug(chapterSlug) {
  return `${chapterSlug.replace(/-/g, '_').toUpperCase()}-`;
}

function assetPrefixFromChapterSlug(chapterSlug) {
  return CUSTOM_ASSET_PREFIXES[chapterSlug] || longAssetPrefixFromChapterSlug(chapterSlug);
}

function removeQuestionAssets(dir, chapterSlug, year, qNum, subject, classCode) {
  const normalizedClass = subjectClassSuffix(subject, classCode);
  const prefixes = new Set([
    `${assetPrefixFromChapterSlug(chapterSlug)}${year}_${normalizedClass}_Q${qNum}`,
    `${longAssetPrefixFromChapterSlug(chapterSlug)}${year}_${normalizedClass}_Q${qNum}`,
    `PIV-${year}_${normalizedClass}_Q${qNum}`
  ]);
  if (!fs.existsSync(dir)) return;

  for (const fileName of fs.readdirSync(dir)) {
    if (Array.from(prefixes).some((prefix) => fileName.startsWith(prefix))) {
      fs.unlinkSync(path.join(dir, fileName));
    }
  }
}

async function downloadAsset(url, dir, name) {
  const ext = detectAssetExtension(url);
  const fileName = `${name}${ext}`;
  const filePath = path.join(dir, fileName);

  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const fileStream = fs.createWriteStream(filePath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(fileName);
      });
    }).on('error', () => resolve(null));
  });
}

function extractElementLines($, el) {
  const $node = $(el);
  if ($node.is('script, style, noscript')) {
    return [];
  }
  if ($node.hasClass('nq2_question_block') || $node.find('.nq2_card').length > 0) {
    return extractQuestionWidgetLines($node);
  }

  const $clone = stripEmbeddedQuestionWidgets($node);
  $clone.find('table').remove();
  $clone.find('br').replaceWith('\n');
  $clone.find('img').each((_, img) => {
    const src = $(img).attr('src');
    $(img).replaceWith(src ? ` [IMG:${src}] ` : ' [IMG] ');
  });

  return $clone
    .text()
    .replace(/ /g, ' ')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);
}

function splitAnswerLine(line) {
  const ansMatch = line.match(/\bAns\b[.:\s-]+/i);
  if (ansMatch) {
    const idx = ansMatch.index || 0;
    const markerEnd = idx + ansMatch[0].length;
    return {
      before: cleanLine(line.slice(0, idx)),
      after: cleanLine(line.slice(markerEnd))
    };
  }

  const answerLabelMatch = line.match(/\bAnswer\b\s*[:\-]\s*/i);
  if (answerLabelMatch) {
    const idx = answerLabelMatch.index || 0;
    const markerEnd = idx + answerLabelMatch[0].length;
    return {
      before: cleanLine(line.slice(0, idx)),
      after: cleanLine(line.slice(markerEnd))
    };
  }

  const correctAnswerMatch = line.match(/\bCorrect\s*Answer\b(?=\s*[:\-]|\s*\(?\s*[a-d]\s*\)?\b)/i);
  if (!correctAnswerMatch) return null;

  const idx = correctAnswerMatch.index || 0;
  const marker = line.slice(idx).match(/^Correct\s*Answer\s*[:\-]?\s*/i);
  const markerEnd = idx + (marker ? marker[0].length : correctAnswerMatch[0].length);

  return {
    before: cleanLine(line.slice(0, idx)),
    after: cleanLine(line.slice(markerEnd))
  };
}

function extractTables($, elements) {
  const tables = [];

  elements.forEach((el) => {
    el.find('table').addBack('table').each((_, tbl) => {
      const rows = [];
      $(tbl).find('tr').each((_, tr) => {
        const cells = [];
        $(tr).find('th, td').each((_, td) => cells.push(clean($(td).text())));
        if (cells.length > 0) rows.push(cells);
      });
      if (rows.length > 0) tables.push(rows);
    });
  });

  return tables;
}

function parseOptionsFromTableMatrix(tables) {
  const parseLabel = (value) => {
    const match = clean(String(value || '')).match(/^\(?\s*([a-d])\s*\)?\s*[:.)-]*\s*$/i);
    return match ? match[1].toUpperCase() : null;
  };

  for (const table of tables) {
    const options = { A: '', B: '', C: '', D: '' };
    let seenOptionLabel = false;

    table.forEach((row) => {
      if (row.length < 2) return;
      const label = parseLabel(row[0]);
      if (!label || options[label] === undefined || options[label]) return;
      seenOptionLabel = true;
      options[label] = normalizeOptionValue(row.slice(1).join(' '));
    });

    if (seenOptionLabel && isUsableOptionSet(options)) {
      return options;
    }
  }
  return null;
}

function collectMarkers(text, regex, mapLabel) {
  const markers = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    markers.push({
      label: mapLabel(match[1]),
      index: match.index,
      len: match[0].length
    });
  }

  return markers;
}

function parseOptionsFromMarkers(text, markers) {
  const options = { A: '', B: '', C: '', D: '' };

  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    if (options[marker.label] === undefined) continue;
    const start = marker.index + marker.len;
    const end = markers[i + 1] ? markers[i + 1].index : text.length;
    if (!options[marker.label]) {
      options[marker.label] = normalizeOptionValue(text.slice(start, end));
    }
  }

  return {
    text: cleanQuestionText(text.slice(0, markers[0].index)),
    options
  };
}

function parseSequentialOptions(values) {
  const options = { A: '', B: '', C: '', D: '' };
  values.slice(0, 4).forEach((value, index) => {
    options[String.fromCharCode(65 + index)] = normalizeOptionValue(value);
  });
  return options;
}

function selectBestMarkerWindow(text, markers, expected = ['A', 'B', 'C', 'D']) {
  if (markers.length < expected.length) return null;

  let best = null;

  for (let start = 0; start <= markers.length - expected.length; start += 1) {
    const window = markers.slice(start, start + expected.length);
    if (window.some((marker, index) => marker.label !== expected[index])) continue;

    const parsed = parseOptionsFromMarkers(text, window);
    const optionValues = Object.values(parsed.options).map((value) => clean(String(value || '')));
    const nonEmpty = optionValues.filter(Boolean).length;
    const totalLength = optionValues.reduce((sum, value) => sum + value.length, 0);
    const score = (nonEmpty * 10000) + totalLength + window[0].index;

    if (!best || score > best.score) {
      best = { parsed, score };
    }
  }

  return best ? best.parsed : null;
}

function parseSequentialLowerMarkers(text) {
  const regex = /\(([a-d])\)?\s*/gi;
  const markers = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    markers.push({
      label: match[1].toUpperCase(),
      index: match.index,
      len: match[0].length
    });
  }

  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed) return null;

  return {
    ...parsed,
    source: 'sequential_lower_markers'
  };
}

function parseLooseLowerSequence(text) {
  const regex = /\(([a-d])\)\s*/gi;
  const markers = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    markers.push({
      index: match.index,
      len: match[0].length
    });
  }

  if (markers.length < 4) return null;

  const options = { A: '', B: '', C: '', D: '' };
  const labels = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < 4; i += 1) {
    const marker = markers[i];
    const start = marker.index + marker.len;
    const end = markers[i + 1] ? markers[i + 1].index : text.length;
    options[labels[i]] = normalizeOptionValue(text.slice(start, end));
  }

  if (!isUsableOptionSet(options)) return null;

  return {
    text: cleanQuestionText(text.slice(0, markers[0].index)),
    options,
    source: 'loose_lower_sequence'
  };
}

function parseThreeLowerPlusTerminalUpper(text) {
  const lowerMarkers = collectMarkers(text, /\(([a-d])\)\s*/gi, (label) => label.toUpperCase());
  if (lowerMarkers.length < 3) return null;

  for (let start = 0; start <= lowerMarkers.length - 3; start += 1) {
    const window = lowerMarkers.slice(start, start + 3);
    if (window[0].label !== 'A' || window[1].label !== 'B' || window[2].label !== 'C') continue;

    const dSearchStart = window[2].index + window[2].len;
    const tail = text.slice(dSearchStart);
    const dMatch = tail.match(/\bD\b\s*[:.)-]?\s*/);
    if (!dMatch) continue;

    const dIndex = dSearchStart + (dMatch.index || 0);
    const dLen = dMatch[0].length;
    const options = { A: '', B: '', C: '', D: '' };
    options.A = normalizeOptionValue(text.slice(window[0].index + window[0].len, window[1].index));
    options.B = normalizeOptionValue(text.slice(window[1].index + window[1].len, window[2].index));
    options.C = normalizeOptionValue(text.slice(window[2].index + window[2].len, dIndex));
    options.D = normalizeOptionValue(text.slice(dIndex + dLen));

    if (!isUsableOptionSet(options)) continue;

    return {
      text: cleanQuestionText(text.slice(0, window[0].index)),
      options,
      source: 'three_lower_plus_terminal_upper'
    };
  }

  return null;
}

function parseUpperPunctMarkers(text) {
  const markers = collectMarkers(text, /\b([A-D])\b\s*[:.)-]\s*/g, (label) => label.toUpperCase());
  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed || !isUsableOptionSet(parsed.options)) return null;

  return {
    ...parsed,
    source: 'upper_punct_markers'
  };
}

function parseCompactUpperNumericLabels(text) {
  const markers = [];
  const regex = /([A-D])(?=[0-9(\-−])/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const idx = match.index;
    const prev = text[idx - 1] || '';
    if (/[A-Za-z]/.test(prev)) continue;
    markers.push({
      label: match[1].toUpperCase(),
      index: idx,
      len: 1
    });
  }

  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed || !isUsableOptionSet(parsed.options)) return null;

  return {
    ...parsed,
    source: 'compact_upper_numeric_labels'
  };
}

function parseNumberedParenOptions(text) {
  const markers = collectMarkers(text, /\(([1-4])\)\s*/g, (label) => String.fromCharCode(64 + Number(label)));
  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed || !isUsableOptionSet(parsed.options)) return null;

  return {
    ...parsed,
    source: 'numbered_paren_options'
  };
}

function parseMixedOptionMarkers(text) {
  const markers = [];
  const regex = /\(([a-d])\)\s*|\b([A-D])\b\s*[:.)-]\s*/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const label = (match[1] || match[2] || '').toUpperCase();
    if (!label) continue;
    markers.push({
      label,
      index: match.index,
      len: match[0].length
    });
  }

  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed || !isUsableOptionSet(parsed.options)) return null;

  return {
    ...parsed,
    source: 'mixed_option_markers'
  };
}

function parseImplicitAThenLowerBCD(text) {
  const markers = collectMarkers(text, /\(([b-d])\)\s*/gi, (label) => label.toUpperCase());
  if (markers.length < 3) return null;

  for (let i = 0; i <= markers.length - 3; i += 1) {
    const window = markers.slice(i, i + 3);
    if (window[0].label !== 'B' || window[1].label !== 'C' || window[2].label !== 'D') continue;

    const questionTail = text.slice(0, window[0].index);
    const separatorIndex = Math.max(questionTail.lastIndexOf(':'), questionTail.lastIndexOf('?'));
    if (separatorIndex === -1) continue;

    const aValue = normalizeOptionValue(questionTail.slice(separatorIndex + 1));
    if (!hasMeaningfulOptionValue(aValue)) continue;

    const options = { A: '', B: '', C: '', D: '' };
    options.A = aValue;
    options.B = normalizeOptionValue(text.slice(window[0].index + window[0].len, window[1].index));
    options.C = normalizeOptionValue(text.slice(window[1].index + window[1].len, window[2].index));
    options.D = normalizeOptionValue(text.slice(window[2].index + window[2].len));

    if (!isUsableOptionSet(options)) continue;

    return {
      text: cleanQuestionText(questionTail.slice(0, separatorIndex + 1)),
      options,
      source: 'implicit_a_lower_bcd'
    };
  }

  return null;
}

function parseOrderedUpperLabels(text) {
  const startRegex = /[?:]\s*A(?=\S)/g;
  let start;

  while ((start = startRegex.exec(text)) !== null) {
    const aIndex = start.index + start[0].length - 1;
    const afterA = text.slice(aIndex + 1);
    const bOffset = afterA.search(/B(?=\S)/);
    if (bOffset === -1) continue;
    const bIndex = aIndex + 1 + bOffset;

    const afterB = text.slice(bIndex + 1);
    const cOffset = afterB.search(/C(?=\S)/);
    if (cOffset === -1) continue;
    const cIndex = bIndex + 1 + cOffset;

    const afterC = text.slice(cIndex + 1);
    const dOffset = afterC.search(/D(?=\S)/);
    if (dOffset === -1) continue;
    const dIndex = cIndex + 1 + dOffset;

    const options = {
      A: normalizeOptionValue(text.slice(aIndex + 1, bIndex)),
      B: normalizeOptionValue(text.slice(bIndex + 1, cIndex)),
      C: normalizeOptionValue(text.slice(cIndex + 1, dIndex)),
      D: normalizeOptionValue(text.slice(dIndex + 1))
    };

    if (!isUsableOptionSet(options)) continue;

    return {
      text: cleanQuestionText(text.slice(0, aIndex)),
      options,
      source: 'ordered_upper_labels'
    };
  }

  return null;
}

function parseCompactUpperTightLabels(text) {
  const markers = [];
  const regex = /([A-D])/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const idx = match.index;
    const label = match[1].toUpperCase();
    const prev = text[idx - 1] || '';
    if (/[A-Za-z]/.test(prev)) continue;
    if (!/[?:)\]0-9/\s\-−]/.test(prev) && idx > 0) continue;

    const next = text[idx + 1] || '';
    if (!next || /\s/.test(next)) continue;

    markers.push({
      label,
      index: idx,
      len: 1
    });
  }

  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed || !isUsableOptionSet(parsed.options)) return null;

  return {
    ...parsed,
    source: 'compact_upper_tight_labels'
  };
}

function parseCompactUpperMarkers(text) {
  const markers = collectMarkers(
    text,
    /([A-D])(?=(?:[A-Z][a-z]|\s+[A-Z][a-z]))/g,
    (label) => label.toUpperCase()
  );
  const parsed = selectBestMarkerWindow(text, markers);
  if (!parsed) return null;

  return {
    ...parsed,
    source: 'compact_upper_markers'
  };
}

function parsePackedUpperLabels(text) {
  const markers = [];

  const boundaryRegex = /(?:^|[\]\?])([A-D])(?=[A-Z])/g;
  let match;
  while ((match = boundaryRegex.exec(text)) !== null) {
    const labelIndex = match.index + match[0].length - 1;
    markers.push({
      label: match[1].toUpperCase(),
      index: labelIndex,
      len: 1
    });
  }

  const fusedRegex = /(?<=[a-z0-9\]])([A-D])(?=[A-Z][a-z])/g;
  while ((match = fusedRegex.exec(text)) !== null) {
    markers.push({
      label: match[1].toUpperCase(),
      index: match.index,
      len: 1
    });
  }

  markers.sort((a, b) => a.index - b.index);
  const deduped = markers.filter((marker, idx) => {
    if (idx === 0) return true;
    const prev = markers[idx - 1];
    return !(prev.index === marker.index && prev.label === marker.label);
  });

  const parsed = selectBestMarkerWindow(text, deduped);
  if (!parsed || !isUsableOptionSet(parsed.options)) return null;

  return {
    ...parsed,
    source: 'packed_upper_labels'
  };
}

function parseChooserLowerOptions(text) {
  const chooserMatch = text.match(chooserRegex);
  if (!chooserMatch) return null;

  const start = (chooserMatch.index || 0) + chooserMatch[0].length;
  const optionText = text.slice(start);
  const lowerMarkers = collectMarkers(optionText, /\(([a-d])\)\s*/gi, (label) => label.toUpperCase());
  if (lowerMarkers.length < 4) return null;

  const parsed = parseOptionsFromMarkers(optionText, lowerMarkers);
  if (!isUsableOptionSet(parsed.options)) return null;

  return {
    text: cleanQuestionText(text.slice(0, start)),
    options: parsed.options,
    source: 'chooser_lower_markers'
  };
}

function parseLineBasedLowerOptions(lines, joined) {
  const chooserIndex = lines.findIndex((line) => chooserRegex.test(line));
  if (chooserIndex !== -1) {
    const finalOptionLines = lines.slice(chooserIndex + 1).filter((line) => /^\([a-d]\)\s*/i.test(line));
    if (finalOptionLines.length >= 4) {
      const options = { A: '', B: '', C: '', D: '' };
      finalOptionLines.forEach((line) => {
        const match = line.match(/^\(([a-d])\)\s*(.*)$/i);
        if (!match) return;
        options[match[1].toUpperCase()] = normalizeOptionValue(match[2]);
      });

      if (isUsableOptionSet(options)) {
        return {
          text: cleanQuestionText(lines.slice(0, chooserIndex + 1).join(' ')),
          options,
          source: 'lower_option_lines'
        };
      }
    }

    const chooserMatch = joined.match(chooserRegex);
    if (chooserMatch) {
      const optionText = joined.slice((chooserMatch.index || 0) + chooserMatch[0].length);
      const lowerMarkersAfterChooser = collectMarkers(optionText, /\(([a-d])\)\s*/gi, (label) => label.toUpperCase());
      if (lowerMarkersAfterChooser.length >= 4) {
        const parsed = parseOptionsFromMarkers(optionText, lowerMarkersAfterChooser);
        if (isUsableOptionSet(parsed.options)) {
          return {
            text: cleanQuestionText(joined.slice(0, (chooserMatch.index || 0) + chooserMatch[0].length)),
            options: parsed.options,
            source: 'chooser_lower_markers'
          };
        }
      }
    }
  }

  const optionLines = lines.filter((line) => /^\([a-d]\)\s*/i.test(line));
  if (optionLines.length >= 4) {
    const options = { A: '', B: '', C: '', D: '' };
    optionLines.forEach((line) => {
      const match = line.match(/^\(([a-d])\)\s*(.*)$/i);
      if (!match) return;
      options[match[1].toUpperCase()] = normalizeOptionValue(match[2]);
    });

    if (isUsableOptionSet(options)) {
      const stemParts = [];
      for (const line of lines) {
        if (/^\([a-d]\)\s*/i.test(line)) break;
        stemParts.push(line);
      }

      return {
        text: cleanQuestionText(stemParts.join(' ')),
        options,
        source: 'inline_lower_option_lines'
      };
    }
  }

  const lowerMarkers = collectMarkers(joined, /\(([a-d])\)\s*/gi, (label) => label.toUpperCase());
  if (lowerMarkers.length >= 4) {
    const parsed = parseOptionsFromMarkers(joined, lowerMarkers);
    if (isUsableOptionSet(parsed.options)) {
      return {
        ...parsed,
        source: 'lower_markers'
      };
    }
  }

  return null;
}

function parseQuestionContent(lines, tables) {
  const joined = lines.join('\n');
  const sanitizedJoined = joined.replace(uiArtifactRegex, ' ');
  const tableOptions = parseOptionsFromTableMatrix(tables);

  if (tableOptions) {
    return finalizeParsedQuestion(sanitizedJoined, cleanQuestionText(sanitizedJoined), tableOptions, 'table');
  }

  const lowerParsed = parseLineBasedLowerOptions(lines, sanitizedJoined);
  if (lowerParsed && countNonEmptyOptions(lowerParsed.options) === 4) {
    return finalizeParsedQuestion(sanitizedJoined, lowerParsed.text, lowerParsed.options, lowerParsed.source);
  }

  const compactLowerMarkers = collectMarkers(sanitizedJoined, /\b([a-d])\)\s*/gi, (label) => label.toUpperCase());
  if (compactLowerMarkers.length >= 4) {
    const compactParsed = parseOptionsFromMarkers(sanitizedJoined, compactLowerMarkers);
    if (isUsableOptionSet(compactParsed.options)) {
      return finalizeParsedQuestion(sanitizedJoined, compactParsed.text, compactParsed.options, 'compact_lower_markers');
    }
  }

  const sequentialLowerParsed = parseSequentialLowerMarkers(sanitizedJoined);
  if (sequentialLowerParsed && isUsableOptionSet(sequentialLowerParsed.options)) {
    return finalizeParsedQuestion(sanitizedJoined, sequentialLowerParsed.text, sequentialLowerParsed.options, sequentialLowerParsed.source);
  }

  const looseLowerParsed = parseLooseLowerSequence(sanitizedJoined);
  if (looseLowerParsed) {
    return finalizeParsedQuestion(sanitizedJoined, looseLowerParsed.text, looseLowerParsed.options, looseLowerParsed.source);
  }

  const numberedParenParsed = parseNumberedParenOptions(sanitizedJoined);
  if (numberedParenParsed) {
    return finalizeParsedQuestion(sanitizedJoined, numberedParenParsed.text, numberedParenParsed.options, numberedParenParsed.source);
  }

  const threeLowerTerminalUpperParsed = parseThreeLowerPlusTerminalUpper(sanitizedJoined);
  if (threeLowerTerminalUpperParsed) {
    return finalizeParsedQuestion(
      sanitizedJoined,
      threeLowerTerminalUpperParsed.text,
      threeLowerTerminalUpperParsed.options,
      threeLowerTerminalUpperParsed.source
    );
  }

  const chooserLowerParsed = parseChooserLowerOptions(sanitizedJoined);
  if (chooserLowerParsed) {
    return finalizeParsedQuestion(sanitizedJoined, chooserLowerParsed.text, chooserLowerParsed.options, chooserLowerParsed.source);
  }

  const mixedOptionParsed = parseMixedOptionMarkers(sanitizedJoined);
  if (mixedOptionParsed) {
    return finalizeParsedQuestion(sanitizedJoined, mixedOptionParsed.text, mixedOptionParsed.options, mixedOptionParsed.source);
  }

  const implicitALowerParsed = parseImplicitAThenLowerBCD(sanitizedJoined);
  if (implicitALowerParsed) {
    return finalizeParsedQuestion(
      sanitizedJoined,
      implicitALowerParsed.text,
      implicitALowerParsed.options,
      implicitALowerParsed.source
    );
  }

  const packedUpperParsed = parsePackedUpperLabels(sanitizedJoined);
  if (packedUpperParsed) {
    return finalizeParsedQuestion(sanitizedJoined, packedUpperParsed.text, packedUpperParsed.options, packedUpperParsed.source);
  }

  const orderedUpperParsed = parseOrderedUpperLabels(sanitizedJoined);
  if (orderedUpperParsed) {
    return finalizeParsedQuestion(sanitizedJoined, orderedUpperParsed.text, orderedUpperParsed.options, orderedUpperParsed.source);
  }

  const compactUpperNumericParsed = parseCompactUpperNumericLabels(sanitizedJoined);
  if (compactUpperNumericParsed) {
    return finalizeParsedQuestion(
      sanitizedJoined,
      compactUpperNumericParsed.text,
      compactUpperNumericParsed.options,
      compactUpperNumericParsed.source
    );
  }

  const compactUpperTightParsed = parseCompactUpperTightLabels(sanitizedJoined);
  if (compactUpperTightParsed) {
    return finalizeParsedQuestion(
      sanitizedJoined,
      compactUpperTightParsed.text,
      compactUpperTightParsed.options,
      compactUpperTightParsed.source
    );
  }

  const upperPunctParsed = parseUpperPunctMarkers(sanitizedJoined);
  if (upperPunctParsed) {
    return finalizeParsedQuestion(sanitizedJoined, upperPunctParsed.text, upperPunctParsed.options, upperPunctParsed.source);
  }

  const upperMarkers = collectMarkers(sanitizedJoined, /([A-E])\.\s*/g, (label) => label.toUpperCase());
  if (upperMarkers.length >= 4) {
    const upperParsed = parseOptionsFromMarkers(sanitizedJoined, upperMarkers);
    return finalizeParsedQuestion(sanitizedJoined, upperParsed.text, upperParsed.options, 'upper_markers');
  }

  const compactUpperParsed = parseCompactUpperMarkers(sanitizedJoined);
  if (compactUpperParsed) {
    return finalizeParsedQuestion(sanitizedJoined, compactUpperParsed.text, compactUpperParsed.options, compactUpperParsed.source);
  }

  return finalizeParsedQuestion(sanitizedJoined, cleanQuestionText(sanitizedJoined), { A: '', B: '', C: '', D: '' }, 'fallback');
}

function collectQuestionPhase($, elements) {
  let seenAns = false;
  const questionLines = [];
  let explanationText = '';
  const blockImgs = [];

  elements.forEach((el) => {
    const $el = $(el);
    const lines = extractElementLines($, el);
    let lineSeenAns = seenAns;

    for (const line of lines) {
      if (!lineSeenAns) {
        const split = splitAnswerLine(line);
        if (split) {
          if (split.before) questionLines.push(split.before);
          if (split.after) explanationText += ` Ans: ${split.after}`;
          lineSeenAns = true;
          seenAns = true;
          continue;
        }
        questionLines.push(line);
      } else {
        explanationText += ` ${line}`;
      }
    }

    $el.find('img').addBack('img').each((_, img) => {
      const src = $(img).attr('src');
      if (src && src.startsWith('http') && !src.includes('Vector.png')) {
        const isExp = seenAns;
        const existingCount = blockImgs.filter((bi) => bi.isExp === isExp).length;
        const suffix = isExp
          ? `-explanation${existingCount + 1}`
          : (existingCount === 0 ? '-main' : `-main${existingCount + 1}`);
        blockImgs.push({ src, suffix, isExp });
      }
    });
  });

  return {
    questionLines,
    explanationText: clean(stripFollowupArtifacts(stripImageTokens(explanationText))),
    blockImgs
  };
}

function splitQuestionNode($, el) {
  const html = $(el).html();
  if (!html) return [$(el)];

  const questionMatches = [...html.matchAll(/Q\s*\d+\s*:/gi)];
  if (questionMatches.length === 0) return [$(el)];

  const wrapperTag = el.tagName || 'div';
  const segments = [];
  const leading = html.slice(0, questionMatches[0].index).trim();

  if (questionMatches.length === 1 && !leading) {
    return [$(el)];
  }

  if (leading) {
    segments.push($(`<${wrapperTag}>${leading}</${wrapperTag}>`));
  }

  for (let i = 0; i < questionMatches.length; i += 1) {
    const start = questionMatches[i].index;
    const end = questionMatches[i + 1] ? questionMatches[i + 1].index : html.length;
    const segmentHtml = html.slice(start, end).trim();
    if (!segmentHtml) continue;
    segments.push($(`<${wrapperTag}>${segmentHtml}</${wrapperTag}>`));
  }

  return segments.length > 0 ? segments : [$(el)];
}

async function scrapeEduRev(url, options = {}) {
  console.log(`🚀 Fetching: ${url}`);

  try {
    const htmlText = await loadHtml(url);
    const $ = cheerio.load(htmlText);
    const parsedChapterTitle = extractChapterTitle($, url);
    const chapterTitle = options.chapterTitle || parsedChapterTitle;
    const chapterSlug = options.chapterSlug || toSlug(chapterTitle);
    const subject = resolveSubject(options);
    const classCode = resolveSubjectClass(options, parsedChapterTitle, chapterTitle);
    if (options.chapterTitle && normalizeChapterKey(parsedChapterTitle) !== normalizeChapterKey(options.chapterTitle)) {
      throw new Error(`Chapter title mismatch: expected "${options.chapterTitle}" but parsed "${parsedChapterTitle}"`);
    }

    const { rawChapterDir, assetRoot } = subjectRoots(subject, classCode);
    const diagDir = path.join(assetRoot, chapterSlug);
    const assetPrefix = assetPrefixFromChapterSlug(chapterSlug);
    if (!fs.existsSync(rawChapterDir)) fs.mkdirSync(rawChapterDir, { recursive: true });
    if (!fs.existsSync(diagDir)) fs.mkdirSync(diagDir, { recursive: true });

    const contentCandidates = $('.contenttextdiv').toArray();
    const contentDiv = $(contentCandidates.sort((a, b) => $(b).children().length - $(a).children().length)[0]);
    if (contentDiv.length === 0) throw new Error('Could not find content container');

    let currentYear = '2022';
    const children = contentDiv.children().toArray();
    const blocks = [];
    let currentBlock = null;

    for (const child of children) {
      const splitChildren = splitQuestionNode($, child);

      for (const $el of splitChildren) {
        const text = clean($el.text());
        const yearMatch = text.match(/\b(20\d{2})\b/);
        const isHeader = $el.is('h1, h2, h3, h4') || (text.length < 20 && yearMatch);

        if (isHeader && yearMatch) {
          currentYear = yearMatch[1];
          continue;
        }

        if (/^Q\s*\d+[:\s.]/i.test(text)) {
          if (currentBlock) blocks.push(currentBlock);
          currentBlock = { year: currentYear, elements: [$el] };
        } else if (currentBlock) {
          currentBlock.elements.push($el);
        }
      }
    }
    if (currentBlock) blocks.push(currentBlock);

    const finalQuestions = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const qNum = i + 1;
      const q = {
        id: `Q${qNum}`,
        text: '',
        options: { A: '', B: '', C: '', D: '' },
        answer: '',
        explanation: '',
        year: block.year,
        chapter: chapterTitle,
        class: classCode,
        images: [],
        tables: extractTables($, block.elements),
        optionExtraction: {
          source: 'fallback',
          status: 'missing',
          imageTokenCount: 0,
          nonEmptyOptionCount: 0
        },
        parserWarnings: []
      };

      removeQuestionAssets(diagDir, chapterSlug, q.year, qNum, subject, classCode);

      const { questionLines, explanationText, blockImgs } = collectQuestionPhase($, block.elements);
      const parsed = parseQuestionContent(questionLines, q.tables);
      q.text = parsed.text;
      q.options = parsed.options;
      q.optionExtraction = parsed.optionExtraction;
      q.parserWarnings = parsed.parserWarnings;

      const ansMatch = explanationText.match(/(?:Correct\s*Answer|Ans(?:wer)?)[.:\s-]+[\s(]*([a-d])/i);
      if (ansMatch) {
        q.answer = ansMatch[1].toLowerCase();
      } else if (shouldUseAssertionReasonDefaults(q.text, q.options)) {
        q.answer = inferAnswerFromExplanation(explanationText);
      }

      const expBody = explanationText.replace(/^.*?\b(?:Correct\s*Answer|Ans(?:wer)?)\b[.:\s-]+[\s(]*[a-d][)\s.]*/i, '').trim();

      let otherHeaderIdx = -1;
      let otherHeaderLabel = '';
      for (let j = 0; j < block.elements.length; j += 1) {
        const $el = block.elements[j];
        const elText = clean($el.text());
        const isStructuralHeader = elText.length < 60 && /^(other options|explanation of incorrect options|incorrect options|why other options)/i.test(elText);
        if (isStructuralHeader) {
          otherHeaderIdx = j;
          otherHeaderLabel = elText.replace(/:+$/, '').trim();
          break;
        }
      }

      if (otherHeaderIdx !== -1) {
        const explanationParts = [];
        let seenAnsLocal = false;
        for (let j = 0; j < block.elements.length; j += 1) {
          if (j === otherHeaderIdx) continue;
          const elText = clean(block.elements[j].text());
          if (!elText) continue;
          if (elText.toLowerCase().includes('ans:')) {
            seenAnsLocal = true;
            continue;
          }
          if (!seenAnsLocal) continue;
          const stripped = elText.replace(/^Ans[:\s-]+[\s(]*[a-d][)\s.]*/i, '').trim();
          if (stripped) explanationParts.push(stripped);
        }
        q.explanation = clean([clean(expBody), `${otherHeaderLabel}:`, explanationParts.join(' ')].filter(Boolean).join(' '));
      } else {
        q.explanation = clean(expBody);
      }

      for (const img of blockImgs) {
        const diagName = `${assetPrefix}${q.year}_${classCode}_Q${qNum}${img.suffix}`;
        const local = await downloadAsset(img.src, diagDir, diagName);
        if (local) q.images.push(`${subject.toUpperCase()}/${classCode}/chapters/${chapterSlug}/${local}`);
      }

      finalQuestions.push(q);
    }

    const outputPath = path.join(rawChapterDir, `${chapterSlug}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(finalQuestions, null, 2));
    console.log(`✅ Success! ${finalQuestions.length} questions saved to ${subject.toUpperCase()}/${classCode}/chapters/${chapterSlug}.json.`);

    return {
      chapterTitle,
      chapterSlug,
      parsedChapterTitle,
      subject,
      classCode,
      biologyClass: subject === 'biology' ? classCode : undefined,
      questionCount: finalQuestions.length,
      outputPath,
      assetDir: diagDir
    };
  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  }
}

module.exports = {
  scrapeEduRev,
  extractChapterTitle,
  toSlug,
  resolveBiologyClass,
  biologyClassPattern,
  biologyRoots
};

const url = process.argv[2] || path.join(__dirname, '../../fixtures/edurev/NEET-Previous-Year-Questions-2016-22-Principles-o.html');
if (require.main === module) {
  scrapeEduRev(url).catch(() => {
    process.exitCode = 1;
  });
}
