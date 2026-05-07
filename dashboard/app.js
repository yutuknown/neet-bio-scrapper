const data = window.__DASHBOARD_DATA__ || {};

const state = {
  activeTab: 'overview',
  selectedChapterSlug: null,
  questionSearch: '',
  yearFilter: '',
  chapterFilter: '',
  selectedQuestionId: null,
};

function byId(id) {
  return document.getElementById(id);
}

function formatDate(value) {
  if (!value) return 'Unknown refresh time';
  return new Date(value).toLocaleString();
}

function riskBadge(risk) {
  const normalized = (risk || 'unknown').toLowerCase();
  const css = ['high', 'medium', 'low'].includes(normalized) ? normalized : 'neutral';
  return `<span class="badge badge-${css}">${normalized}</span>`;
}

function score(value) {
  return typeof value === 'number' ? value.toFixed(4) : '—';
}

function copyCommand(command) {
  navigator.clipboard.writeText(command).catch(() => {});
}

function getChapters() {
  return Array.isArray(data.chapters) ? data.chapters : [];
}

function getSelectedChapter() {
  const chapters = getChapters();
  return chapters.find((chapter) => chapter.slug === state.selectedChapterSlug) || chapters[0] || null;
}

function getFilteredChapters() {
  const query = state.chapterFilter.trim().toLowerCase();
  if (!query) return getChapters();

  return getChapters().filter((chapter) => {
    return [chapter.title, chapter.risk, chapter.yearRange, String(chapter.questionCount)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

function getVisibleQuestions() {
  const chapter = getSelectedChapter();
  if (!chapter) return [];

  return (chapter.questions || []).filter((question) => {
    const matchesSearch = !state.questionSearch || question.searchText.includes(state.questionSearch);
    const matchesYear = !state.yearFilter || question.year === state.yearFilter;
    return matchesSearch && matchesYear;
  });
}

function renderHeader() {
  const overview = data.overview || {};
  byId('course-title').textContent = overview.courseTitle || 'Unknown course';
  const courseLink = byId('course-link');
  courseLink.textContent = overview.courseUrl ? 'Course source' : 'No course link';
  courseLink.href = overview.courseUrl || '#';
  byId('generated-at').textContent = `Updated ${formatDate(overview.generatedAt)}`;
  byId('chapter-count-badge').textContent = `${overview.scrapedChapterCount || 0}/${overview.chapterCount || 0} chapters`;
}

function renderTabs() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle('active', active);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${state.activeTab}-tab`);
  });
}

function renderChapterList() {
  const container = byId('chapter-list');
  const chapters = getFilteredChapters();

  if (!chapters.length) {
    container.innerHTML = '<div class="empty-state">No chapters match the current filter.</div>';
    return;
  }

  if (!chapters.some((chapter) => chapter.slug === state.selectedChapterSlug)) {
    state.selectedChapterSlug = chapters[0].slug;
  }

  container.innerHTML = chapters
    .map((chapter) => {
      return `
        <button class="chapter-button ${chapter.slug === state.selectedChapterSlug ? 'active' : ''}" data-chapter-slug="${chapter.slug}">
          <div class="chapter-title">${chapter.title}</div>
          <div class="meta-row">
            ${riskBadge(chapter.risk)}
            <span class="badge badge-neutral">${chapter.questionCount} questions</span>
            ${chapter.yearRange ? `<span class="badge badge-neutral">${chapter.yearRange}</span>` : ''}
          </div>
        </button>
      `;
    })
    .join('');

  container.querySelectorAll('[data-chapter-slug]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedChapterSlug = button.dataset.chapterSlug;
      state.selectedQuestionId = null;
      renderExplorerFilters();
      renderChapterList();
      renderQuestionList();
    });
  });
}

function renderOverview() {
  const overview = data.overview || {};
  const kpis = [
    ['Chapters discovered', overview.chapterCount || 0],
    ['Chapters scraped', overview.scrapedChapterCount || 0],
    ['Audit benchmarks', overview.benchmarkCoverage || 0],
    ['Total questions', overview.totalQuestions || 0],
    ['Diagram assets', overview.totalImages || 0],
    ['Medium/high risk', (overview.mediumRiskCount || 0) + (overview.highRiskCount || 0)],
  ];

  byId('kpi-grid').innerHTML = kpis
    .map(
      ([label, value]) => `
        <div class="metric-tile">
          <div class="metric-value">${value}</div>
          <div class="metric-label">${label}</div>
        </div>
      `
    )
    .join('');

  const riskItems = (data.auditSummary && data.auditSummary.highRiskChapters) || [];
  byId('risk-list').innerHTML = riskItems.length
    ? riskItems
        .map(
          (item) => `
            <div class="stack-card">
              <div class="stack-title">${item.title}</div>
              <div class="meta-row">
                ${riskBadge(item.risk)}
                <span class="badge badge-neutral">final ${score(item.finalAccuracy)}</span>
                <span class="badge badge-neutral">schema gap ${score(item.schemaGapRisk)}</span>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="empty-state">No high-risk chapters in the current benchmark set.</div>';

  const coverageRows = [
    ['Verified PYQ chapters', `${overview.pyqChapterCount || 0}/${overview.chapterCount || 0}`],
    ['Scraped chapter files', `${overview.scrapedChapterCount || 0}`],
    ['Audited chapter files', `${overview.auditedChapterCount || 0}`],
    ['Schema failures', `${overview.schemaFailureCount || 0}`],
    ['Total tables', `${overview.totalTables || 0}`],
    ['Dashboard build', formatDate(overview.generatedAt)],
  ];

  byId('coverage-list').innerHTML = coverageRows
    .map(
      ([label, value]) => `
        <div class="stat-item">
          <div class="stat-label">${label}</div>
          <div class="stat-value">${value}</div>
        </div>
      `
    )
    .join('');

  const chapters = getChapters()
    .slice()
    .sort((left, right) => right.questionCount - left.questionCount)
    .slice(0, 6);

  byId('chapter-summary-list').innerHTML = chapters
    .map(
      (chapter) => `
        <div class="stack-card">
          <div class="stack-title">${chapter.title}</div>
          <div class="meta-row">
            ${riskBadge(chapter.risk)}
            <span class="badge badge-neutral">${chapter.questionCount} questions</span>
            <span class="badge badge-neutral">${chapter.imageCount} images</span>
          </div>
        </div>
      `
    )
    .join('');
}

function renderExplorerFilters() {
  const chapter = getSelectedChapter();
  const yearSelect = byId('year-filter');
  const years = chapter ? chapter.years || [] : [];

  yearSelect.innerHTML = ['<option value="">All years</option>']
    .concat(years.map((year) => `<option value="${year}">${year}</option>`))
    .join('');
  yearSelect.value = state.yearFilter;
}

function renderQuestionList() {
  const questions = getVisibleQuestions();
  const container = byId('question-list');
  byId('question-results-count').textContent = `${questions.length} question(s) shown`;

  if (!questions.length) {
    container.innerHTML = '<div class="empty-state">No questions match the current search.</div>';
    byId('question-detail-title').textContent = 'Select a question';
    const detail = byId('question-detail');
    detail.classList.add('empty-state');
    detail.innerHTML = 'Adjust the filters or pick another chapter.';
    return;
  }

  if (!questions.some((question) => question.id === state.selectedQuestionId)) {
    state.selectedQuestionId = questions[0].id;
  }

  container.innerHTML = questions
    .map(
      (question) => `
        <button class="question-button ${question.id === state.selectedQuestionId ? 'active' : ''}" data-question-id="${question.id}">
          <div class="question-title">${question.id} · ${question.year || '—'}</div>
          <div class="question-preview">${question.text}</div>
        </button>
      `
    )
    .join('');

  container.querySelectorAll('[data-question-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedQuestionId = button.dataset.questionId;
      renderQuestionDetail();
      renderQuestionList();
    });
  });

  renderQuestionDetail();
}

function renderQuestionDetail() {
  const chapter = getSelectedChapter();
  const questions = getVisibleQuestions();
  const question = questions.find((item) => item.id === state.selectedQuestionId);
  const detail = byId('question-detail');

  if (!chapter || !question) {
    byId('question-detail-title').textContent = 'Select a question';
    detail.classList.add('empty-state');
    detail.innerHTML = 'Pick a chapter and question to inspect details.';
    return;
  }

  byId('question-detail-title').textContent = `${chapter.title} · ${question.id}`;

  const options = Object.entries(question.options || {})
    .map(([label, value]) => `<div class="stack-card"><div class="stack-title">${label}</div><div class="muted">${value}</div></div>`)
    .join('');

  const images = (question.images || []).length
    ? `<div><p class="eyebrow">Images</p><div class="image-grid">${question.images
        .map(
          (image) => `
            <a class="image-card" href="${image.url}" target="_blank" rel="noreferrer">
              <img src="${image.url}" alt="${image.path}" />
              <div class="muted tiny">${image.path}</div>
            </a>
          `
        )
        .join('')}</div></div>`
    : '';

  const tables = (question.tables || []).length
    ? `<div><p class="eyebrow">Tables</p><div class="stack-list">${question.tables
        .map((table, index) => `<div class="stack-card"><div class="stack-title">Table ${index + 1}</div><pre class="muted">${JSON.stringify(table, null, 2)}</pre></div>`)
        .join('')}</div></div>`
    : '';

  detail.classList.remove('empty-state');
  detail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-stat">
        <div class="detail-stat-label">Year</div>
        <div class="detail-stat-value">${question.year || '—'}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Answer</div>
        <div class="detail-stat-value">${question.answer || '—'}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Images</div>
        <div class="detail-stat-value">${(question.images || []).length}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Tables</div>
        <div class="detail-stat-value">${(question.tables || []).length}</div>
      </div>
    </div>
    <div>
      <p class="eyebrow">Prompt</p>
      <p>${question.text}</p>
    </div>
    <div>
      <p class="eyebrow">Options</p>
      <div class="option-grid">${options}</div>
    </div>
    <div>
      <p class="eyebrow">Explanation</p>
      <div class="stack-list">
        <div class="stack-card">
          <div class="stack-title">Explanation</div>
          <div class="muted">${question.explanation || '—'}</div>
        </div>
      </div>
    </div>
    ${images}
    ${tables}
  `;
}

function renderAudit() {
  const chapterSummaries = (data.auditSummary && data.auditSummary.chapters) || [];
  byId('audit-summary-list').innerHTML = chapterSummaries.length
    ? chapterSummaries
        .map(
          (chapter) => `
            <div class="stack-card">
              <div class="stack-title">${chapter.title}</div>
              <div class="meta-row">
                ${riskBadge(chapter.risk)}
                <span class="badge badge-neutral">final ${score(chapter.finalAccuracy)}</span>
                <span class="badge badge-neutral">semantic ${score(chapter.semanticAccuracy)}</span>
                <span class="badge badge-neutral">missing ${score(chapter.missingQuestionRatio)}</span>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="empty-state">No audit summary is available yet.</div>';

  const alignmentRows = ((data.auditAlignment && data.auditAlignment.chapters) || []).flatMap((chapter) => {
    return (chapter.weakMatches || []).slice(0, 8).map((match) => ({ chapter, match }));
  });

  byId('alignment-list').innerHTML = alignmentRows.length
    ? alignmentRows
        .map(
          ({ chapter, match }) => `
            <div class="stack-card">
              <div class="stack-title">${chapter.title}</div>
              <div class="meta-row">
                ${riskBadge(chapter.risk)}
                <span class="badge badge-neutral">score ${score(match.score)}</span>
                <span class="badge badge-neutral">source ${match.sourceIndex}</span>
                <span class="badge badge-neutral">${match.scrapedId || 'unmatched'}</span>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="empty-state">No weak alignment rows are available yet.</div>';
}

function renderControls() {
  const commands = (data.runbook && data.runbook.commands) || [];
  byId('command-list').innerHTML = commands
    .map(
      (item) => `
        <div class="command-card">
          <div class="command-row">
            <div class="command-body">
              <div class="stack-title">${item.label}</div>
              <div class="muted">${item.description}</div>
              <span class="code-chip">${item.command}</span>
              <div class="muted tiny">Output: ${item.output}</div>
            </div>
            <button class="command-copy" data-command="${item.command}">Copy</button>
          </div>
        </div>
      `
    )
    .join('');

  byId('workflow-list').innerHTML = ((data.runbook && data.runbook.workflow) || [])
    .map((step) => `<li>${step}</li>`)
    .join('');

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => copyCommand(button.dataset.command));
  });
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderChapterList();
  renderOverview();
  renderExplorerFilters();
  renderQuestionList();
  renderAudit();
  renderControls();
}

function attachEvents() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
    });
  });

  byId('chapter-filter').addEventListener('input', (event) => {
    state.chapterFilter = event.target.value.toLowerCase();
    renderChapterList();
    renderQuestionList();
  });

  byId('question-search').addEventListener('input', (event) => {
    state.questionSearch = event.target.value.trim().toLowerCase();
    renderQuestionList();
  });

  byId('year-filter').addEventListener('change', (event) => {
    state.yearFilter = event.target.value;
    renderQuestionList();
  });
}

function init() {
  const firstChapter = getChapters()[0];
  state.selectedChapterSlug = firstChapter ? firstChapter.slug : null;
  attachEvents();
  renderAll();
}

init();
