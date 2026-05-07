const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_COURSE_SOURCE = 'https://edurev.in/courses/716_Biology-Class-12';
const EDUREV_BASE_URL = 'https://edurev.in';
const chooserRegex = /Choose the (?:correct|most appropriate) answer from the options given below\s*:?|In (?:the )?light of the above statements,?\s*choose the correct answer from the options given below\s*:?/i;
const siteChromeRegex = /Type\s*Your\s*Answer|View\s*Answer|Solution:?/gi;
const zeroWidthRegex = /[​-‍﻿]/g;
const lowerOptionLineRegex = /^\(([a-d])\)\s*(.*)$/i;
const upperOptionLineRegex = /^([A-D])\.\s*(.*)$/;

const CUSTOM_ASSET_PREFIXES = {
    'biodiversity-and-its-conservation': 'biodiversity-',
    'human-health-and-diseases': 'human-health-',
    'human-reproduction': 'reproduction-',
    'microbes-in-human-welfare': 'microbes-',
    'molecular-basis-of-inheritance': 'mbi-',
    'principles-of-inheritance-and-variation': 'piv-'
};

const clean = (text) => String(text || '').replace(zeroWidthRegex, '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
const cleanLine = (text) => String(text || '').replace(zeroWidthRegex, '').replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ').trim();

function stripSiteChrome(text) {
    return String(text || '').replace(siteChromeRegex, ' ');
}

function stripImageTokens(text) {
    return String(text || '').replace(/\[IMG:[^\]]+\]/gi, '').replace(/\[IMG\]/gi, '');
}

function cleanQuestionText(text) {
    return clean(
        stripSiteChrome(
            stripImageTokens(text)
                .replace(/^Q\d+[:\s.]*/i, '')
                .replace(/\s*\(NEET[^)]*\)/gi, '')
                .replace(/\s*Choose the (?:correct|most appropriate) answer from the options given below\s*:?\s*$/i, '')
                .replace(/\s*In the light of the above statements,?\s*choose the correct answer from the options given below\s*:?\s*$/i, '')
                .replace(/\s*In the light of the above statements,?\s*$/i, '')
                .replace(/[\s,;:.-]+$/g, '')
        )
    );
}

function normalizeOptionValue(text) {
    return clean(
        stripSiteChrome(
            String(text || '')
                .replace(/\[IMG:[^\]]+\]/gi, '[diagram]')
                .replace(/\s*\(NEET[^)]*\)/gi, '')
                .replace(/^[\s:.-]+/, '')
        )
    );
}

function countImageTokens(text) {
    return (String(text || '').match(/\[IMG(?::[^\]]+)?\]/gi) || []).length;
}

function countNonEmptyOptions(options) {
    return ['A', 'B', 'C', 'D'].filter((label) => clean(String(options[label] || ''))).length;
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
    return {
        text,
        options,
        ...buildOptionDiagnostics(rawText, options, source)
    };
}

function normalizePageTitle(text) {
    return clean(text).replace(/\|\s*Biology Class 12 PDF Download.*$/i, '').trim();
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
    const match = String(url || '').match(/\.(svg|png|jpe?g|webp|gif)(?:[?#]|$)/i);
    if (!match) return '.png';
    return `.${match[1].toLowerCase()}`;
}

function longAssetPrefixFromChapterSlug(chapterSlug) {
    return `${chapterSlug.replace(/-/g, '_').toUpperCase()}-`;
}

function assetPrefixFromChapterSlug(chapterSlug) {
    return CUSTOM_ASSET_PREFIXES[chapterSlug] || longAssetPrefixFromChapterSlug(chapterSlug);
}

function removeQuestionAssets(dir, chapterSlug, year, qNum) {
    const prefixes = new Set([
        `${assetPrefixFromChapterSlug(chapterSlug)}${year}_B12_Q${qNum}`,
        `${longAssetPrefixFromChapterSlug(chapterSlug)}${year}_B12_Q${qNum}`,
        `PIV-${year}_B12_Q${qNum}`
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
    if (!el) return [];
    if (el.type === 'text') {
        const text = cleanLine($(el).text());
        return text ? [text] : [];
    }

    const $clone = $(el).clone();
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
    const match = String(line || '').match(/^(.*?)(?:\bAns\b\s*[:.-]?\s*)(.*)$/i);
    if (!match) return null;
    return {
        before: cleanLine(match[1]),
        after: cleanLine(match[2])
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
    for (const table of tables) {
        const optionRows = table.filter((row) => row.length > 1 && /^\([a-d]\)$/i.test(clean(row[0])));
        if (optionRows.length >= 4) {
            const options = { A: '', B: '', C: '', D: '' };
            optionRows.forEach((row) => {
                const label = row[0].replace(/[()]/g, '').toUpperCase();
                if (options[label] !== undefined) {
                    options[label] = normalizeOptionValue(row.slice(1).join(' '));
                }
            });
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

function sliceFromBestOrderedStart(markers, labels) {
    let bestStart = -1;

    for (let i = 0; i < markers.length; i++) {
        if (markers[i].label !== labels[0]) continue;
        let cursor = i;
        let valid = true;

        for (let j = 1; j < labels.length; j++) {
            const nextIndex = markers.findIndex((marker, idx) => idx > cursor && marker.label === labels[j]);
            if (nextIndex === -1) {
                valid = false;
                break;
            }
            cursor = nextIndex;
        }

        if (valid) bestStart = i;
    }

    return bestStart === -1 ? markers : markers.slice(bestStart);
}

function parseOptionsFromMarkers(text, markers) {
    const options = { A: '', B: '', C: '', D: '' };
    const effectiveMarkers = sliceFromBestOrderedStart(markers, ['A', 'B', 'C', 'D']);
    if (effectiveMarkers.length < 4) {
        return {
            text: cleanQuestionText(text),
            options
        };
    }

    for (let i = 0; i < effectiveMarkers.length; i++) {
        const marker = effectiveMarkers[i];
        if (options[marker.label] === undefined) continue;
        const start = marker.index + marker.len;
        const end = effectiveMarkers[i + 1] ? effectiveMarkers[i + 1].index : text.length;
        if (!options[marker.label]) {
            options[marker.label] = normalizeOptionValue(text.slice(start, end));
        }
    }

    return {
        text: cleanQuestionText(text.slice(0, effectiveMarkers[0].index)),
        options
    };
}

function parseLabeledOptionLines(lines, lineRegex, source) {
    const optionIndexes = lines
        .map((line, index) => ({ line, index, match: line.match(lineRegex) }))
        .filter(({ match }) => match);

    if (optionIndexes.length < 4) return null;

    const labels = optionIndexes.map(({ match }) => match[1].toUpperCase());
    const orderedStart = labels.join('').lastIndexOf('ABCD');
    if (orderedStart === -1) return null;

    const optionSlice = optionIndexes.slice(orderedStart, orderedStart + 4);
    if (optionSlice.length < 4) return null;

    const options = { A: '', B: '', C: '', D: '' };
    for (const { match } of optionSlice) {
        options[match[1].toUpperCase()] = normalizeOptionValue(match[2]);
    }

    const firstOptionIndex = optionSlice[0].index;
    return {
        text: cleanQuestionText(lines.slice(0, firstOptionIndex).join(' ')),
        options,
        source
    };
}

function parseLineBasedLowerOptions(lines, joined) {
    const chooserIndex = lines.findIndex((line) => chooserRegex.test(line));
    if (chooserIndex !== -1) {
        const chooserParsed = parseLabeledOptionLines(lines.slice(chooserIndex + 1), lowerOptionLineRegex, 'lower_option_lines');
        if (chooserParsed) {
            return {
                text: cleanQuestionText(lines.slice(0, chooserIndex + 1).join(' ')),
                options: chooserParsed.options,
                source: chooserParsed.source
            };
        }
    }

    const lowerLineParsed = parseLabeledOptionLines(lines, lowerOptionLineRegex, 'inline_lower_option_lines');
    if (lowerLineParsed) return lowerLineParsed;

    const lowerMarkers = collectMarkers(joined, /\(([a-d])\)\s*/g, (label) => label.toUpperCase());
    if (lowerMarkers.length >= 4) {
        const lowerMarkerParsed = parseOptionsFromMarkers(joined, lowerMarkers);
        if (countNonEmptyOptions(lowerMarkerParsed.options) === 4) {
            return {
                ...lowerMarkerParsed,
                source: 'lower_markers'
            };
        }
    }

    return null;
}

function parseLineBasedUpperOptions(lines, joined) {
    const chooserIndex = lines.findIndex((line) => chooserRegex.test(line));
    if (chooserIndex !== -1) {
        const chooserParsed = parseLabeledOptionLines(lines.slice(chooserIndex + 1), upperOptionLineRegex, 'upper_option_lines');
        if (chooserParsed) {
            return {
                text: cleanQuestionText(lines.slice(0, chooserIndex + 1).join(' ')),
                options: chooserParsed.options,
                source: chooserParsed.source
            };
        }
    }

    const upperLineParsed = parseLabeledOptionLines(lines, upperOptionLineRegex, 'inline_upper_option_lines');
    if (upperLineParsed) return upperLineParsed;

    const upperMarkers = collectMarkers(joined, /([A-D])\.\s*/g, (label) => label.toUpperCase());
    if (upperMarkers.length >= 4) {
        const upperMarkerParsed = parseOptionsFromMarkers(joined, upperMarkers);
        if (countNonEmptyOptions(upperMarkerParsed.options) === 4) {
            return {
                ...upperMarkerParsed,
                source: 'upper_markers'
            };
        }
    }

    return null;
}

function parseQuestionContent(lines, tables) {
    const joined = lines.join('\n');
    const tableOptions = parseOptionsFromTableMatrix(tables);
    if (tableOptions) {
        return finalizeParsedQuestion(joined, cleanQuestionText(joined), tableOptions, 'table');
    }

    const lowerParsed = parseLineBasedLowerOptions(lines, joined);
    if (lowerParsed) {
        return finalizeParsedQuestion(joined, lowerParsed.text, lowerParsed.options, lowerParsed.source);
    }

    const upperParsed = parseLineBasedUpperOptions(lines, joined);
    if (upperParsed) {
        return finalizeParsedQuestion(joined, upperParsed.text, upperParsed.options, upperParsed.source);
    }

    return finalizeParsedQuestion(joined, cleanQuestionText(joined), { A: '', B: '', C: '', D: '' }, 'fallback');
}

function extractSourceQuestionNumber(elements, $) {
    for (const el of elements) {
        const text = clean($(el).text());
        const match = text.match(/^Q(\d+)[:\s.]/i);
        if (match) return Number(match[1]);
    }
    return null;
}

function collectQuestionPhase($, elements) {
    let seenAns = false;
    let sawAnswerMarker = false;
    const questionLines = [];
    const answerPhaseLines = [];
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
                    if (split.after) answerPhaseLines.push(split.after);
                    lineSeenAns = true;
                    seenAns = true;
                    sawAnswerMarker = true;
                    continue;
                }
                questionLines.push(line);
            } else {
                answerPhaseLines.push(line);
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
        answerPhaseLines: answerPhaseLines.map((line) => clean(stripImageTokens(stripSiteChrome(line)))).filter(Boolean),
        sawAnswerMarker,
        blockImgs
    };
}

function deriveAnswerAndExplanation(answerPhaseLines, sawAnswerMarker) {
    const joined = clean(answerPhaseLines.join(' '));
    if (!joined) {
        return {
            answer: '',
            explanationText: '',
            missingAnswerAfterMarker: Boolean(sawAnswerMarker)
        };
    }

    let answer = '';
    let explanationText = joined;

    const leadingAnswerMatch = joined.match(/^(?:Ans[:\s-]+)?[\s(]*([a-d])(?:[)\s.:,-]|$)/i);
    if (leadingAnswerMatch) {
        answer = leadingAnswerMatch[1].toLowerCase();
        explanationText = clean(joined.replace(/^(?:Ans[:\s-]+)?[\s(]*[a-d](?:[)\s.:,-]|$)\s*/i, ''));
    } else {
        const inlineAnswerMatch = joined.match(/Ans[:\s-]+[\s(]*([a-d])/i);
        if (inlineAnswerMatch) {
            answer = inlineAnswerMatch[1].toLowerCase();
            explanationText = clean(joined.replace(/^.*?Ans[:\s-]+[\s(]*[a-d][)\s.:,-]*/i, ''));
        }
    }

    return {
        answer,
        explanationText,
        missingAnswerAfterMarker: Boolean(sawAnswerMarker && !answer)
    };
}

function sanitizeQuestionRecord(question) {
    question.text = clean(stripSiteChrome(question.text));
    question.options = Object.fromEntries(
        Object.entries(question.options || {}).map(([label, value]) => [label, clean(stripSiteChrome(value))])
    );
    question.explanation = clean(stripSiteChrome(question.explanation || ''));
}

function setManualImageTableReview(question, imageTokenCount) {
    question.optionExtraction = {
        source: 'manual_image_table_review',
        status: 'parsed',
        imageTokenCount,
        nonEmptyOptionCount: 4
    };
    question.parserWarnings = [];
}

function applyManualQuestionOverrides(question, chapterSlug) {
    const key = `${chapterSlug}:${question.id}`;

    switch (key) {
        case 'biodiversity-and-its-conservation:Q48':
            question.options = {
                A: 'A: Insects | B: Crustaceans | C: Other animal groups | D: Molluscs',
                B: 'A: Crustaceans | B: Insects | C: Molluscs | D: Other animal groups',
                C: 'A: Molluscs | B: Other animal groups | C: Crustaceans | D: Insects',
                D: 'A: Insects | B: Molluscs | C: Crustaceans | D: Other animal groups'
            };
            question.tables = [
                ['', 'A', 'B', 'C', 'D'],
                ['(a)', 'Insects', 'Crustaceans', 'Other animal groups', 'Molluscs'],
                ['(b)', 'Crustaceans', 'Insects', 'Molluscs', 'Other animal groups'],
                ['(c)', 'Molluscs', 'Other animal groups', 'Crustaceans', 'Insects'],
                ['(d)', 'Insects', 'Molluscs', 'Crustaceans', 'Other animal groups']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'biotechnology-and-its-applications:Q28':
            question.text = 'Match the following columns and select the correct option.';
            question.options = {
                A: '(a): (ii) | (b): (iii) | (c): (iv) | (d): (i)',
                B: '(a): (i) | (b): (ii) | (c): (iii) | (d): (iv)',
                C: '(a): (iv) | (b): (i) | (c): (ii) | (d): (iii)',
                D: '(a): (iii) | (b): (ii) | (c): (i) | (d): (iv)'
            };
            question.tables = [
                ['Column I', 'Column II'],
                ['(a) Bt cotton', '(i) Gene therapy'],
                ['(b) Adenosine deaminase deficiency', '(ii) Cellular defence'],
                ['(c) RNAi', '(iii) Detection of HIV infection'],
                ['(d) PCR', '(iv) Bacillus thuringiensis']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'evolution:Q16':
            question.options = {
                A: '(a): (ii) | (b): (i) | (c): (iv) | (d): (iii)',
                B: '(a): (i) | (b): (iv) | (c): (iii) | (d): (ii)',
                C: '(a): (iv) | (b): (iii) | (c): (ii) | (d): (i)',
                D: '(a): (iii) | (b): (ii) | (c): (i) | (d): (iv)'
            };
            question.tables = [
                ['List-I', 'List-II'],
                ['(a) Adaptive radiation', '(i) Selection of resistant varieties due to excessive use of herbicides and pesticides'],
                ['(b) Convergent evolution', '(ii) Bones of forelimbs in Man and Whale'],
                ['(c) Divergent evolution', '(iii) Wings of Butterfly and Bird'],
                ['(d) Evolution by anthropogenic action', '(iv) Darwin Finches']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'evolution:Q23':
            question.options = {
                A: '(a): (iv) | (b): (iii) | (c): (iii) | (d): (iii)',
                B: '(a): (iii) | (b): (i) | (c): (ii) | (d): (iv)',
                C: '(a): (i) | (b): (iv) | (c): (i) | (d): (i)',
                D: '(a): (ii) | (b): (ii) | (c): (iv) | (d): (ii)'
            };
            question.tables = [
                ['Column I', 'Column II'],
                ['(a) Homo habilis', '(i) 900 CC'],
                ['(b) Homo neanderthalensis', '(ii) 1350 cc'],
                ['(c) Homo credits', '(iii) 650 - 800 cc'],
                ['(d) Homo sapiens', '(iv) 1400 CC']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'human-health-and-diseases:Q27':
            question.text = 'Match List-I with List-II Choose the correct answer from the options given below.';
            question.options = {
                A: '(a): (i) | (b): (ii) | (c): (iv) | (d): (iii)',
                B: '(a): (ii) | (b): (iii) | (c): (i) | (d): (iv)',
                C: '(a): (iv) | (b): (i) | (c): (iii) | (d): (ii)',
                D: '(a): (iii) | (b): (iv) | (c): (i) | (d): (ii)'
            };
            question.tables = [
                ['List-I', 'List-II'],
                ['(a) Filariasis', '(i) Haemophilus influenzae'],
                ['(b) Amoebiasis', '(ii) Trichophyton'],
                ['(c) Pneumonia', '(iii) Wuchereria bancrofti'],
                ['(d) Ringworm', '(iv) Entamoeba histolytica']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'human-health-and-diseases:Q30':
            question.text = 'Match the following diseases with the causative organism and select the correct option.';
            question.options = {
                A: '(a): (i) | (b): (ii) | (c): (iv) | (d): (iii)',
                B: '(a): (iv) | (b): (ii) | (c): (iii) | (d): (i)',
                C: '(a): (iii) | (b): (iv) | (c): (ii) | (d): (i)',
                D: '(a): (ii) | (b): (i) | (c): (iv) | (d): (iii)'
            };
            question.tables = [
                ['Column-I', 'Column-II'],
                ['(a) Typhoid', '(i) Wuchereria'],
                ['(b) Pneumonia', '(ii) Plasmodium'],
                ['(c) Filariasis', '(iii) Salmonella'],
                ['(d) Malaria', '(iv) Haemophilus']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'microbes-in-human-welfare:Q11':
            question.options = {
                A: '(a): (i) | (b): (ii) | (c): (iv) | (d): (iii)',
                B: '(a): (iv) | (b): (iii) | (c): (ii) | (d): (i)',
                C: '(a): (iii) | (b): (i) | (c): (iv) | (d): (ii)',
                D: '(a): (ii) | (b): (i) | (c): (iii) | (d): (iv)'
            };
            question.tables = [
                ['List - I', 'List - II'],
                ['(a) Aspergillus Niger', '(i) Acetic Acid'],
                ['(b) Acetobacter aceti', '(ii) Lactic Acid'],
                ['(c) Clostridium butylicum', '(iii) Citric Acid'],
                ['(d) Lactobacillus', '(iv) Butyric Acid']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'microbes-in-human-welfare:Q13':
            question.options = {
                A: '(a): (i) | (b): (ii) | (c): (iv) | (d): (iii)',
                B: '(a): (iv) | (b): (iii) | (c): (ii) | (d): (i)',
                C: '(a): (iii) | (b): (iv) | (c): (ii) | (d): (i)',
                D: '(a): (ii) | (b): (i) | (c): (iv) | (d): (iii)'
            };
            question.tables = [
                ['Column-I', 'Column-II'],
                ['(a) Clostridium butylicum', '(i) Cyclosporin-A'],
                ['(b) Trichoderma polysporum', '(ii) Butyric Acid'],
                ['(c) Monascus purpureus', '(iii) Citric Acid'],
                ['(d) Aspergillus niger', '(iv) Blood cholesterol lowering agent']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'microbes-in-human-welfare:Q15':
            question.options = {
                A: '(A): (ii) | (B): (i) | (C): (iii) | (D): (v)',
                B: '(A): (ii) | (B): (iv) | (C): (v) | (D): (iii)',
                C: '(A): (ii) | (B): (iv) | (C): (iii) | (D): (v)',
                D: '(A): (iii) | (B): (iv) | (C): (v) | (D): (i)'
            };
            question.tables = [
                ['Column I', 'Column II'],
                ['(A) Lactobacillus', '(i) Cheese'],
                ['(B) Saccharomyces cerevisiae', '(ii) Curd'],
                ['(C) Aspergillus niger', '(iii) Citric acid'],
                ['(D) Acetobacter aceti', '(iv) Bread'],
                ['', '(v) Acetic acid']
            ];
            setManualImageTableReview(question, 2);
            return;
        case 'microbes-in-human-welfare:Q23':
            question.options = {
                A: '(a) Streptococcus | Streptokinase | Removal of clot from blood vessel',
                B: '(b) Clostridium butylicum | Lipase | Removal of oil stains',
                C: '(c) Trichoderma polysporum | Cyclosporin A | Immunosuppressive drug',
                D: '(d) Monascus purpureus | Statins | Lowering of blood cholesterol'
            };
            question.tables = [
                ['Microbe', 'Product', 'Application'],
                ['(a) Streptococcus', 'Streptokinase', 'Removal of clot from blood vessel'],
                ['(b) Clostridium butylicum', 'Lipase', 'Removal of oil stains'],
                ['(c) Trichoderma polysporum', 'Cyclosporin A', 'Immunosuppressive drug'],
                ['(d) Monascus purpureus', 'Statins', 'Lowering of blood cholesterol']
            ];
            setManualImageTableReview(question, 1);
            return;
        case 'reproductive-health:Q25':
            question.text = 'Match the following sexually transmitted diseases (Column I) with their causative agents (Column II) and select the correct option. [NEET 2017]';
            question.options = {
                A: '(a): (iii) | (b): (iv) | (c): (i) | (d): (ii)',
                B: '(a): (iv) | (b): (ii) | (c): (iii) | (d): (i)',
                C: '(a): (iv) | (b): (iii) | (c): (ii) | (d): (i)',
                D: '(a): (ii) | (b): (iii) | (c): (iv) | (d): (i)'
            };
            question.answer = 'd';
            question.explanation = 'Gonorrhoea is a sexually transmitted disease (STD) caused by infection with the Neisseria gonorrhoeae bacterium. N. gonorrhoeae infects the mucous membranes of the reproductive tract, including the cervix, uterus, and fallopian tubes in women, and the urethra in women and men. Syphilis is a chronic infectious disease caused by the spirochaete Treponema pallidum. Syphilis is usually transmitted by sexual contact or from mother to infant, although endemic syphilis is transmitted by non-sexual contact in communities living under poor hygiene conditions. Genital warts are caused by several of the epidermotropic human papillomaviruses (HPVs). HPV-6 and HPV-11 most commonly are isolated. Acquired immunodeficiency syndrome (AIDS) is a chronic, potentially life-threatening condition caused by the human immunodeficiency virus (HIV).';
            question.tables = [
                ['Column I', 'Column II'],
                ['(a) Gonorrhoea', '(i) HIV'],
                ['(b) Syphilis', '(ii) Neisseria'],
                ['(c) Genital warts', '(iii) Triponema'],
                ['(d) AIDS', '(iv) Human papilloma virus']
            ];
            setManualImageTableReview(question, 1);
            return;
        default:
            return;
    }
}

async function loadHtml(source) {
    if (source.startsWith('http')) {
        const response = await fetch(source, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.text();
    }

    const filePath = source.startsWith('file://') ? source.replace('file://', '') : source;
    return fs.readFileSync(filePath, 'utf8');
}

function toAbsoluteUrl(href) {
    return new URL(href, EDUREV_BASE_URL).toString();
}

function parseChapterHref(href) {
    const match = String(href || '').match(/^\/chapter\/(\d+)_([^?#]+)/i);
    if (!match) return null;
    return { id: match[1], slug: match[2] };
}

function parseDocumentHref(href) {
    const match = String(href || '').match(/^\/t\/(\d+)\/([^?#]+)/i);
    if (!match) return null;
    return { id: match[1], slug: match[2] };
}

function parseCourseId(source) {
    const match = String(source || '').match(/\/courses\/(\d+)_/i);
    return match ? match[1] : '';
}

function extractCourseTitle($) {
    const h1 = clean($('h1').first().text());
    if (h1) return h1;
    const hiddenTitle = clean($('#leftSideCourseTitleHidden').attr('value') || '');
    if (hiddenTitle) return hiddenTitle;
    return '';
}

function normalizeChapterTitle(title) {
    return clean(title)
        .replace(/\s+Biology Class 12.*$/i, '')
        .replace(/\s+-\s+NEET.*$/i, '')
        .replace(/\s+NEET.*$/i, '')
        .trim();
}

function normalizeTopicKey(title) {
    return normalizeChapterTitle(title)
        .replace(/^•\s*/, '')
        .replace(/^NEET Previous Year Questions\s*\([^)]*\)\s*:\s*/i, '')
        .replace(/^NEET Previous Year Questions\s*:\s*/i, '')
        .replace(/&/g, 'and')
        .replace(/:/g, ' ')
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

function isRealSubjectChapter(title) {
    return !/(mindmaps|ncert based tests|tips\s*&\s*tricks|ppts?\b|flashcards?|dpp\b|revision notes|mnemonics|chapterwise previous year questions|ncert exemplar|cbse|past year papers|sample papers|full syllabus mocks|how to prepare)/i.test(title);
}

function extractChapterLinks($, courseId, courseTitle) {
    const chapters = [];
    const seen = new Set();
    const normalizedCourseTitle = normalizeTopicKey(courseTitle);

    $('a.crs_chptr[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (!href || !href.startsWith('/chapter/')) return;

        const parsed = parseChapterHref(href);
        if (!parsed) return;
        if (courseId && parsed.id === courseId) return;

        const title = clean($(anchor).find('h2.subcoursetitle').first().text() || $(anchor).text());
        if (!title || !isRealSubjectChapter(title)) return;

        const key = normalizeTopicKey(title);
        if (!key || key === normalizedCourseTitle || seen.has(key)) return;

        seen.add(key);
        chapters.push({
            index: chapters.length + 1,
            id: parsed.id,
            title: normalizeChapterTitle(title),
            url: toAbsoluteUrl(href),
            slug: parsed.slug
        });
    });

    return chapters;
}

function isNeetPyqTitle(title) {
    return /NEET Previous Year Questions/i.test(title) && !/CBSE Previous Year Questions/i.test(title);
}

function extractAnchorTitle($, anchor) {
    const $title = $(anchor).find('.subcoursetitle').first().clone();
    $title.find('span').remove();
    const nestedTitle = clean($title.text());
    if (nestedTitle) return nestedTitle;
    return clean($(anchor).text()).replace(/ Doc\s*\|.*$/i, '').trim();
}

function extractChapterPyqLinks($, chapter) {
    const matches = [];
    const seen = new Set();
    const chapterKey = normalizeTopicKey(chapter.title);

    $('a[href^="/t/"]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        const parsed = parseDocumentHref(href || '');
        if (!parsed) return;

        const title = extractAnchorTitle($, anchor).replace(/^•\s*/, '');
        if (!isNeetPyqTitle(title)) return;
        if (normalizeTopicKey(title) !== chapterKey) return;

        const url = toAbsoluteUrl(href);
        if (seen.has(url)) return;

        seen.add(url);
        matches.push({
            documentId: parsed.id,
            title,
            url,
            slug: parsed.slug
        });
    });

    return matches;
}

function extractPyqPageMetadata($) {
    return {
        pageTitle: clean($('title').text()),
        canonicalUrl: $('link[rel="canonical"]').attr('href') || '',
        courseTitle: clean($('.brdcrmb_cntnr a[href*="/courses/"], .breadcrumbspn a[href*="/courses/"]').first().text())
    };
}

async function verifyPyqLink(chapter, pyq) {
    const htmlText = await loadHtml(pyq.url);
    const $ = cheerio.load(htmlText);
    const metadata = extractPyqPageMetadata($);
    const chapterKey = normalizeTopicKey(chapter.title);
    const pageKey = normalizeTopicKey(metadata.pageTitle);

    return {
        verified: pageKey.includes(chapterKey) && /NEET Previous Year Questions/i.test(metadata.pageTitle) && (!metadata.courseTitle || /Biology Class 12/i.test(metadata.courseTitle)),
        canonicalUrl: metadata.canonicalUrl || pyq.url,
        pageTitle: metadata.pageTitle,
        courseTitle: metadata.courseTitle
    };
}

async function scrapeCoursePyqLinks(source) {
    console.log(`🚀 Fetching course: ${source}`);

    const courseHtml = await loadHtml(source);
    const $course = cheerio.load(courseHtml);
    const baseDir = path.join(__dirname, '../data/raw');
    const outputPath = path.join(baseDir, 'pyq-links.json');

    const courseTitle = extractCourseTitle($course);
    const courseId = parseCourseId(source) || parseCourseId($course('link[rel="canonical"]').attr('href') || '');
    const chapters = extractChapterLinks($course, courseId, courseTitle);
    if (chapters.length === 0) throw new Error('Could not find chapter links');

    const chapterResults = [];
    for (const chapter of chapters) {
        console.log(`🔎 Scanning chapter page: ${chapter.title}`);
        const chapterHtml = await loadHtml(chapter.url);
        const $chapter = cheerio.load(chapterHtml);
        const rawPyqs = extractChapterPyqLinks($chapter, chapter);
        const verifiedPyqs = [];

        for (const pyq of rawPyqs) {
            const verification = await verifyPyqLink(chapter, pyq);
            if (!verification.verified) continue;
            verifiedPyqs.push({
                documentId: pyq.documentId,
                title: pyq.title,
                url: pyq.url,
                slug: pyq.slug,
                canonicalUrl: verification.canonicalUrl,
                pageTitle: verification.pageTitle,
                courseTitle: verification.courseTitle
            });
        }

        if (verifiedPyqs.length > 0) {
            chapterResults.push({ chapter, pyqLinks: verifiedPyqs });
        }
    }

    const result = {
        courseUrl: source.startsWith('http') ? source : DEFAULT_COURSE_SOURCE,
        courseTitle,
        chapterCount: chapters.length,
        pyqChapterCount: chapterResults.length,
        chapters: chapterResults
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`✅ Success! ${chapterResults.length} chapters with NEET PYQ links saved.`);
    return result;
}

async function scrapeEduRev(source, options = {}) {
    console.log(`🚀 Fetching: ${source}`);

    const htmlText = await loadHtml(source);
    const $ = cheerio.load(htmlText);
    const baseDir = path.join(__dirname, '../data/raw');
    const assetDir = path.join(__dirname, '../data/assets');

    const parsedChapterTitle = extractChapterTitle($, source);
    const chapterTitle = options.chapterTitle || parsedChapterTitle;
    const chapterSlug = options.chapterSlug || toSlug(chapterTitle);

    if (options.chapterTitle && normalizeChapterKey(parsedChapterTitle) !== normalizeChapterKey(options.chapterTitle)) {
        throw new Error(`Chapter title mismatch: expected "${options.chapterTitle}" but parsed "${parsedChapterTitle}"`);
    }

    const rawChapterDir = path.join(baseDir, 'BIOLOGY', 'chapters');
    const diagDir = path.join(assetDir, 'BIOLOGY', 'chapters', chapterSlug);
    const assetPrefix = assetPrefixFromChapterSlug(chapterSlug);
    if (!fs.existsSync(rawChapterDir)) fs.mkdirSync(rawChapterDir, { recursive: true });
    if (!fs.existsSync(diagDir)) fs.mkdirSync(diagDir, { recursive: true });

    const contentDiv = $('.contenttextdiv');
    if (contentDiv.length === 0) throw new Error('Could not find content container');

    let currentYear = '2022';
    const children = contentDiv.contents().toArray();
    const blocks = [];
    let currentBlock = null;

    for (const child of children) {
        const $el = $(child);
        const text = clean($el.text());
        const yearMatch = text.match(/\b(20\d{2})\b/);
        const isHeader = $el.is('h1, h2, h3, h4') || (text.length < 20 && yearMatch);

        if (isHeader && yearMatch) {
            currentYear = yearMatch[1];
            continue;
        }

        if (/^Q\d+[:\s.]/i.test(text)) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = { year: currentYear, elements: [$el] };
        } else if (currentBlock) {
            currentBlock.elements.push($el);
        }
    }
    if (currentBlock) blocks.push(currentBlock);

    const finalQuestions = [];
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const qNum = i + 1;
        const sourceQuestionNumber = extractSourceQuestionNumber(block.elements, $);
        const q = {
            id: `Q${qNum}`,
            sourceQuestionNumber,
            text: '',
            options: { A: '', B: '', C: '', D: '' },
            answer: '',
            explanation: '',
            year: block.year,
            chapter: chapterTitle,
            class: 'B12',
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

        removeQuestionAssets(diagDir, chapterSlug, q.year, qNum);

        const { questionLines, answerPhaseLines, sawAnswerMarker, blockImgs } = collectQuestionPhase($, block.elements);
        const parsed = parseQuestionContent(questionLines, q.tables);
        q.text = parsed.text;
        q.options = parsed.options;
        q.optionExtraction = parsed.optionExtraction;
        q.parserWarnings = parsed.parserWarnings;

        const derivedAnswer = deriveAnswerAndExplanation(answerPhaseLines, sawAnswerMarker);
        q.answer = derivedAnswer.answer;

        q.explanation = derivedAnswer.explanationText;

        if (derivedAnswer.missingAnswerAfterMarker) {
            q.parserWarnings = [...q.parserWarnings, 'Answer marker was found but no answer text could be extracted from the source block.'];
        }

        for (const img of blockImgs) {
            const diagName = `${assetPrefix}${q.year}_B12_Q${qNum}${img.suffix}`;
            const local = await downloadAsset(img.src, diagDir, diagName);
            if (local) q.images.push(`BIOLOGY/chapters/${chapterSlug}/${local}`);
        }

        applyManualQuestionOverrides(q, chapterSlug);
        sanitizeQuestionRecord(q);
        finalQuestions.push(q);
    }

    const outputPath = path.join(rawChapterDir, `${chapterSlug}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(finalQuestions, null, 2));
    console.log(`✅ Success! ${finalQuestions.length} questions saved to BIOLOGY/chapters/${chapterSlug}.json.`);

    return {
        chapterTitle,
        chapterSlug,
        parsedChapterTitle,
        questionCount: finalQuestions.length,
        outputPath,
        assetDir: diagDir
    };
}

function printUsage() {
    console.log(`Usage:
  node scraper/standalone_scraper.js
  node scraper/standalone_scraper.js <course-url-or-html-path>
  node scraper/standalone_scraper.js --pyq <pyq-url-or-html-path> [--chapter-title "..."] [--chapter-slug "..."]

Modes:
  default / positional source   Scrape all Biology chapters from the course page.
  --pyq                         Scrape a single PYQ page.
`);
}

function getArgValue(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1) return '';
    return args[index + 1] || '';
}

function hasFlag(args, flag) {
    return args.includes(flag);
}

function parseArgs(argv) {
    const args = argv.slice(2);

    if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
        return { mode: 'help' };
    }

    const pyqSource = getArgValue(args, '--pyq');
    if (pyqSource) {
        const chapterTitle = getArgValue(args, '--chapter-title');
        const chapterSlug = getArgValue(args, '--chapter-slug') || (chapterTitle ? toSlug(chapterTitle) : '');
        return {
            mode: 'single',
            source: pyqSource,
            chapterTitle,
            chapterSlug
        };
    }

    const positional = args.find((arg) => !arg.startsWith('--'));
    return {
        mode: 'multi',
        source: positional || DEFAULT_COURSE_SOURCE
    };
}

async function scrapeSinglePyq(source, options = {}) {
    const scrapeOptions = {};
    if (options.chapterTitle) scrapeOptions.chapterTitle = options.chapterTitle;
    if (options.chapterSlug) scrapeOptions.chapterSlug = options.chapterSlug;
    return scrapeEduRev(source, scrapeOptions);
}

async function scrapeAllChapters(source) {
    console.log(`🚀 Starting standalone scrape: ${source}`);
    const pyqIndex = await scrapeCoursePyqLinks(source);
    const results = [];

    for (const chapterEntry of pyqIndex.chapters) {
        const { chapter, pyqLinks } = chapterEntry;
        const pyq = pyqLinks[0];
        if (!pyq) continue;

        console.log(`📘 Scraping chapter PYQ: ${chapter.title}`);
        const scrapeResult = await scrapeEduRev(pyq.canonicalUrl || pyq.url, {
            chapterTitle: chapter.title,
            chapterSlug: toSlug(chapter.title)
        });

        results.push({
            chapter: chapter.title,
            slug: scrapeResult.chapterSlug,
            questionCount: scrapeResult.questionCount,
            outputPath: scrapeResult.outputPath,
            assetDir: scrapeResult.assetDir
        });
    }

    console.log(`✅ Standalone scrape complete. ${results.length} chapter files updated.`);
    return {
        source,
        chapterCount: results.length,
        chapters: results
    };
}

async function main() {
    const parsed = parseArgs(process.argv);

    if (parsed.mode === 'help') {
        printUsage();
        return;
    }

    if (parsed.mode === 'single') {
        await scrapeSinglePyq(parsed.source, {
            chapterTitle: parsed.chapterTitle,
            chapterSlug: parsed.chapterSlug
        });
        return;
    }

    await scrapeAllChapters(parsed.source);
}

module.exports = {
    extractChapterTitle,
    parseArgs,
    scrapeAllChapters,
    scrapeCoursePyqLinks,
    scrapeEduRev,
    scrapeSinglePyq,
    toSlug
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ Error:', err.message);
        process.exitCode = 1;
    });
}
