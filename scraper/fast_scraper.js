const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');

const clean = (t) => t.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
const cleanLine = (t) => t.replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ').trim();
const chooserRegex = /Choose the (?:correct|most appropriate) answer from the options given below\s*:?|In the light of the above statements,?\s*choose the correct answer from the options given below\s*:?/i;

function stripImageTokens(text) {
    return text.replace(/\[IMG:[^\]]+\]/gi, '').replace(/\[IMG\]/gi, '');
}

function cleanQuestionText(text) {
    return clean(
        stripImageTokens(text)
            .replace(/^Q\d+[:\s.]*/i, '')
            .replace(/\s*\(NEET[^)]*\)/gi, '')
            .replace(/\s*Choose the (?:correct|most appropriate) answer from the options given below\s*:?\s*$/i, '')
            .replace(/\s*In the light of the above statements,?\s*choose the correct answer from the options given below\s*:?\s*$/i, '')
            .replace(/\s*In the light of the above statements,?\s*$/i, '')
            .replace(/[\s,;:.-]+$/g, '')
    );
}

function normalizeOptionValue(text) {
    return clean(
        text
            .replace(/\[IMG:[^\]]+\]/gi, '[diagram]')
            .replace(/\s*\(NEET[^)]*\)/gi, '')
            .replace(/^[\s:.-]+/, '')
    );
}

function countImageTokens(text) {
    return (text.match(/\[IMG(?::[^\]]+)?\]/gi) || []).length;
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

function removeQuestionAssets(dir, chapterSlug, year, qNum) {
    const prefixes = new Set([
        `${assetPrefixFromChapterSlug(chapterSlug)}${year}_B12_Q${qNum}`,
        `${longAssetPrefixFromChapterSlug(chapterSlug)}${year}_B12_Q${qNum}`,
        `PIV-${year}_B12_Q${qNum}`
    ]);
    if (!fs.existsSync(dir)) return;

    for (const fileName of fs.readdirSync(dir)) {
        if (Array.from(prefixes).some(prefix => fileName.startsWith(prefix))) {
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
            fileStream.on('finish', () => { fileStream.close(); resolve(fileName); });
        }).on('error', () => resolve(null));
    });
}

function extractElementLines($, el) {
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
    const match = line.match(/^(.*?)(?:Ans[:\s-]+)(.*)$/i);
    if (!match) return null;
    return {
        before: cleanLine(match[1]),
        after: cleanLine(match[2])
    };
}

function extractTables($, elements) {
    const tables = [];

    elements.forEach(el => {
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
        const optionRows = table.filter(row => row.length > 1 && /^\([a-d]\)$/i.test(clean(row[0])));
        if (optionRows.length >= 4) {
            const options = { A: '', B: '', C: '', D: '' };
            optionRows.forEach(row => {
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

function parseOptionsFromMarkers(text, markers) {
    const options = { A: '', B: '', C: '', D: '' };

    for (let i = 0; i < markers.length; i++) {
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

function parseLineBasedLowerOptions(lines, joined) {
    const chooserIndex = lines.findIndex(line => chooserRegex.test(line));
    if (chooserIndex !== -1) {
        const finalOptionLines = lines.slice(chooserIndex + 1).filter(line => /^\([a-d]\)\s*/i.test(line));
        if (finalOptionLines.length >= 4) {
            const options = { A: '', B: '', C: '', D: '' };
            finalOptionLines.forEach(line => {
                const match = line.match(/^\(([a-d])\)\s*(.*)$/i);
                if (!match) return;
                options[match[1].toUpperCase()] = normalizeOptionValue(match[2]);
            });

            return {
                text: cleanQuestionText(lines.slice(0, chooserIndex + 1).join(' ')),
                options,
                source: 'lower_option_lines'
            };
        }
    }

    const optionLines = lines.filter(line => /^\([a-d]\)\s*/i.test(line));
    if (optionLines.length >= 4) {
        const options = { A: '', B: '', C: '', D: '' };
        optionLines.forEach(line => {
            const match = line.match(/^\(([a-d])\)\s*(.*)$/i);
            if (!match) return;
            options[match[1].toUpperCase()] = normalizeOptionValue(match[2]);
        });

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

    const lowerMarkers = collectMarkers(joined, /\(([a-d])\)\s*/gi, label => label.toUpperCase());
    if (lowerMarkers.length >= 4) {
        return {
            ...parseOptionsFromMarkers(joined, lowerMarkers),
            source: 'lower_markers'
        };
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

    const upperMarkers = collectMarkers(joined, /([A-E])\.\s*/g, label => label.toUpperCase());
    if (upperMarkers.length >= 4) {
        const upperParsed = parseOptionsFromMarkers(joined, upperMarkers);
        return finalizeParsedQuestion(joined, upperParsed.text, upperParsed.options, 'upper_markers');
    }

    return finalizeParsedQuestion(joined, cleanQuestionText(joined), { A: '', B: '', C: '', D: '' }, 'fallback');
}

function collectQuestionPhase($, elements) {
    let seenAns = false;
    const questionLines = [];
    let explanationText = '';
    const blockImgs = [];

    elements.forEach(el => {
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
                const existingCount = blockImgs.filter(bi => bi.isExp === isExp).length;
                const suffix = isExp
                    ? `-explanation${existingCount + 1}`
                    : (existingCount === 0 ? '-main' : `-main${existingCount + 1}`);
                blockImgs.push({ src, suffix, isExp });
            }
        });
    });

    return {
        questionLines,
        explanationText: clean(stripImageTokens(explanationText)),
        blockImgs
    };
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

async function scrapeEduRev(url, options = {}) {
    console.log(`🚀 Fetching: ${url}`);

    try {
        const htmlText = await loadHtml(url);
        const $ = cheerio.load(htmlText);
        const baseDir = path.join(__dirname, '../data/raw');
        const assetDir = path.join(__dirname, '../data/assets');

        const parsedChapterTitle = extractChapterTitle($, url);
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
        const children = contentDiv.children().toArray();
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
            const q = {
                id: `Q${qNum}`,
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

            const { questionLines, explanationText, blockImgs } = collectQuestionPhase($, block.elements);
            const parsed = parseQuestionContent(questionLines, q.tables);
            q.text = parsed.text;
            q.options = parsed.options;
            q.optionExtraction = parsed.optionExtraction;
            q.parserWarnings = parsed.parserWarnings;

            const ansMatch = explanationText.match(/Ans[:\s-]+[\s(]*([a-d])/i);
            if (ansMatch) q.answer = ansMatch[1].toLowerCase();

            let expBody = explanationText.replace(/^.*?Ans[:\s-]+[\s(]*[a-d][)\s.]*/i, '').trim();

            let otherHeaderIdx = -1;
            let otherHeaderLabel = '';
            for (let j = 0; j < block.elements.length; j++) {
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
                for (let j = 0; j < block.elements.length; j++) {
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
                q.explanation = clean([clean(expBody), otherHeaderLabel + ':', explanationParts.join(' ')].filter(Boolean).join(' '));
            } else {
                q.explanation = clean(expBody);
            }

            for (const img of blockImgs) {
                const diagName = `${assetPrefix}${q.year}_B12_Q${qNum}${img.suffix}`;
                const local = await downloadAsset(img.src, diagDir, diagName);
                if (local) q.images.push(`BIOLOGY/chapters/${chapterSlug}/${local}`);
            }

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
    } catch (err) {
        console.error('❌ Error:', err.message);
        throw err;
    }
}

module.exports = {
    scrapeEduRev,
    extractChapterTitle,
    toSlug
};

const url = process.argv[2] || path.join(__dirname, '../fixtures/edurev/NEET-Previous-Year-Questions-2016-22-Principles-o.html');
if (require.main === module) {
    scrapeEduRev(url).catch(() => process.exitCode = 1);
}
