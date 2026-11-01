/* ============================================================
   EchoDaily · 回声英语
   A small, local-first daily listening app.
   ============================================================ */
(function () {
  'use strict';

  window.addEventListener('error', (event) => {
    document.documentElement.dataset.echoError = String(event.message || 'unknown');
  });
  window.addEventListener('unhandledrejection', (event) => {
    document.documentElement.dataset.echoError = String((event.reason && event.reason.message) || event.reason || 'promise');
  });

  const EPISODES = Array.isArray(window.EPISODES) ? window.EPISODES : [];
  const STORAGE_KEY = 'echoDaily.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const DAY_MS = 86400000;

  const TASKS = [
    { key: 'blind', name: '盲听抓关键词', sub: '不看字幕，先抓住 3 个信息', min: 3 },
    { key: 'intensive', name: '双语精听', sub: '逐句听，弄懂每个意群', min: 8 },
    { key: 'shadow', name: '跟读模仿', sub: '0.8× 速度，模仿语音语调', min: 6 },
    { key: 'retell', name: '脱稿复述', sub: '用 3 句话概括这条新闻', min: 5 },
    { key: 'review', name: '词汇与测验', sub: '复习生词，完成 3 道题', min: 3 }
  ];

  const FOCUS_STEPS = [
    {
      key: 'blind',
      label: '盲听',
      title: '先不看字幕，抓住 3 个关键词',
      desc: '让耳朵先工作。听不出每个词没关系，先抓住：谁、发生了什么、为什么重要。',
      minutes: 3,
      hint: '第一遍允许自己“听不懂”，只抓大意。'
    },
    {
      key: 'intensive',
      label: '精听',
      title: '打开双语，逐句拆开听',
      desc: '点任意一句可以跳转。遇到听不清的地方，停下来重播，再看中文确认意思。',
      minutes: 8,
      hint: '一句听 2–3 遍，比整段听 10 遍更有效。'
    },
    {
      key: 'shadow',
      label: '跟读',
      title: '慢一点，把声音“贴”上去',
      desc: '0.8 倍速，跟着主播的节奏、重音和停顿读。可以录音回听，不必追求完美。',
      minutes: 6,
      hint: '先模仿节奏，再纠正单个发音。'
    },
    {
      key: 'retell',
      label: '复述',
      title: '合上字幕，用 3 句话讲清楚',
      desc: '不看原文，用自己的话概括：发生了什么、涉及谁、为什么值得关注。',
      minutes: 5,
      hint: '说错也没关系，能串起来就是进步。'
    },
    {
      key: 'review',
      label: '复盘',
      title: '把今天的收获留下来',
      desc: '复习 6 个词，完成 3 道理解题。错题比满分更有价值。',
      minutes: 3,
      hint: '最后再看一遍逐句稿，标记还没听清的句子。'
    }
  ];

  const escapeHTML = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

  const icon = (name, cls = '') => '<svg' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"><use href="#i-' + name + '"/></svg>';

  function defaultState() {
    return {
      settings: {
        dailyGoal: 25,
        reminder: '07:30',
        defaultSubtitle: 'both',
        autoScroll: true,
        fontSize: 13,
        accent: 'en-US'
      },
      history: {},
      progress: {},
      vocab: [],
      createdAt: Date.now(),
      lastVisit: null
    };
  }

  function loadState() {
    const fallback = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return Object.assign({}, fallback, parsed, {
        settings: Object.assign({}, fallback.settings, parsed.settings || {}),
        history: parsed.history || {},
        progress: parsed.progress || {},
        vocab: Array.isArray(parsed.vocab) ? parsed.vocab : []
      });
    } catch (err) {
      return fallback;
    }
  }

  let state = loadState();
  let currentEpisode = null;
  let media = null;
  let activeIndex = -1;
  let activeCueIndex = -1;
  let destroyingMedia = false;
  let noteTimer = null;
  let searchTimer = null;
  let videoFailed = false;

  const ui = {
    view: 'today',
    episodeId: null,
    tab: 'lines',
    subtitleMode: state.settings.defaultSubtitle || 'both',
    mediaMode: 'video',
    search: '',
    filter: 'all',
    fullMode: false,
    loopSegment: false,
    clipEnded: false,
    speed: 1,
    focusStep: 0,
    focusRemaining: 0,
    focusRunning: false,
    focusTimer: null,
    focusVisited: new Set(),
    focusNote: '',
    focusAudioUrl: null,
    recording: null,
    recordingTimer: null,
    controlsTimer: null,
    fullscreenHandler: null
  };

  function parseDate(str) {
    const parts = String(str).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function localDate(d = new Date()) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(dateStr, amount) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + amount);
    return localDate(d);
  }

  function dateCn(dateStr) {
    const d = parseDate(dateStr);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function weekdayCn(dateStr) {
    return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][parseDate(dateStr).getDay()];
  }

  function todayStr() {
    return localDate(new Date());
  }

  function dayNumber() {
    const start = parseDate('2026-10-31');
    const now = parseDate(todayStr());
    return Math.max(1, Math.floor((now - start) / DAY_MS) + 1);
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function formatDuration(seconds) {
    const mins = Math.max(1, Math.round(seconds / 60));
    return mins + ' 分钟';
  }

  function formatMinutes(seconds) {
    return Math.max(1, Math.round(seconds / 60));
  }

  function shorten(text, max) {
    const value = String(text || '').trim();
    if (value.length <= max) return value;
    const cut = value.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.55 ? cut.slice(0, space) : cut).replace(/[.,;:!?，。；：！？]+$/, '') + '…';
  }

  function splitSentences(text, locale) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return [];
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter(locale || 'en', { granularity: 'sentence' });
        const parts = Array.from(segmenter.segment(value), (item) => item.segment.trim()).filter(Boolean);
        if (parts.length) return parts;
      }
    } catch (err) { /* fall through */ }
    const parts = value.match(/[^.!?。！？]+[.!?。！？]+["'”’]?|[^.!?。！？]+$/g) || [value];
    return parts.map((s) => s.trim()).filter(Boolean);
  }

  function groupParts(parts, count) {
    if (count <= 0) return [];
    if (parts.length === count) return parts.slice();
    if (parts.length < count) {
      const out = parts.slice();
      while (out.length < count) out.push(out[out.length - 1] || '');
      return out;
    }
    const out = [];
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      const end = i === count - 1 ? parts.length : Math.max(cursor + 1, Math.round(((i + 1) / count) * parts.length));
      out.push(parts.slice(cursor, end).join(''));
      cursor = end;
    }
    return out;
  }

  function alignChinese(parts, count) {
    if (parts.length === count) return parts.slice();
    if (parts.length > count) return groupParts(parts, count);
    const clauses = [];
    parts.forEach((part) => {
      const pieces = part.split(/(?<=[，；：,;])\s*/).filter(Boolean);
      if (pieces.length) clauses.push(...pieces);
      else clauses.push(part);
    });
    if (clauses.length >= count) return groupParts(clauses, count);
    const out = clauses.slice();
    while (out.length < count) out.push('');
    return out;
  }

  function buildSentenceCues(ep) {
    if (!ep) return [];
    if (ep._sentenceCues) return ep._sentenceCues;
    const supplied = window.SUBTITLE_CUES && window.SUBTITLE_CUES[ep.id];
    if (Array.isArray(supplied) && supplied.length) {
      // Cues are cut from the original VTT, so their starts match the audio.
      // A tiny lead-in avoids the “subtitle arrives after the voice” feeling.
      ep._sentenceCues = supplied.map((cue, index) => Object.assign({}, cue, {
        start: Math.max(0, Number(cue.start) - 0.12),
        end: Number(cue.end) + 0.05,
        sentenceIndex: index
      }));
      return ep._sentenceCues;
    }
    const cues = [];
    ep.segments.forEach((seg, segIndex) => {
      const ens = splitSentences(seg.en, 'en');
      const english = ens.length ? ens : [seg.en];
      const chinese = alignChinese(splitSentences(seg.zh, 'zh'), english.length);
      const weights = english.map((sentence) => {
        const words = sentence.match(/[A-Za-z0-9'’-]+/g);
        return Math.max(3, words ? words.length : 3);
      });
      const totalWeight = weights.reduce((sum, n) => sum + n, 0);
      let passed = 0;
      const span = Math.max(1, seg.end - seg.start);
      english.forEach((sentence, i) => {
        const start = seg.start + (passed / totalWeight) * span;
        passed += weights[i];
        const end = i === english.length - 1 ? seg.end : seg.start + (passed / totalWeight) * span;
        cues.push({
          start,
          end: Math.max(start + 0.4, end),
          en: sentence,
          zh: chinese[i] || '',
          segIndex,
          sentenceIndex: i,
          section: seg.section
        });
      });
    });
    ep._sentenceCues = cues;
    return cues;
  }

  function currentCues() {
    return currentEpisode ? buildSentenceCues(currentEpisode) : [];
  }

  function getEpisode(id) {
    return EPISODES.find((ep) => ep.id === id) || null;
  }

  function episodeForToday() {
    const sorted = EPISODES.slice().sort((a, b) => b.date.localeCompare(a.date));
    const available = sorted.filter((ep) => ep.availableFrom <= todayStr());
    return available[0] || sorted[sorted.length - 1] || null;
  }

  function activeEpisode() {
    return getEpisode(ui.episodeId) || episodeForToday();
  }

  function ensureProgress(episodeId) {
    if (!state.progress[episodeId]) {
      state.progress[episodeId] = { mastered: [], note: '', quiz: {}, lastTime: 0, lastPlayed: 0 };
    }
    const p = state.progress[episodeId];
    if (!Array.isArray(p.mastered)) p.mastered = [];
    if (!p.quiz || typeof p.quiz !== 'object') p.quiz = {};
    return p;
  }

  function saveState() {
    try {
      state.lastVisit = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Storage can be unavailable in private mode; the app still works for the session.
    }
  }

  function getDayRecord(date = todayStr()) {
    return state.history[date] || { tasks: [], completed: false, minutes: 0, episodeId: null };
  }

  function isComplete(date) {
    return !!(state.history[date] && state.history[date].completed);
  }

  function computeStreak() {
    let cursor = new Date();
    if (!isComplete(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (isComplete(localDate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function longestStreak() {
    const dates = Object.keys(state.history).filter((d) => state.history[d].completed).sort();
    let best = 0;
    let run = 0;
    let previous = null;
    dates.forEach((date) => {
      if (previous && addDays(previous, 1) === date) run += 1;
      else run = 1;
      best = Math.max(best, run);
      previous = date;
    });
    return best;
  }

  function totalMinutes() {
    return Object.values(state.history).reduce((sum, rec) => sum + (Number(rec.minutes) || 0), 0);
  }

  function completedDays() {
    return Object.keys(state.history).filter((d) => state.history[d].completed).length;
  }

  function masteredCount() {
    return Object.values(state.progress).reduce((sum, p) => sum + (Array.isArray(p.mastered) ? p.mastered.length : 0), 0);
  }

  function taskCount(key) {
    return Object.values(state.history).reduce((sum, rec) => sum + (Array.isArray(rec.tasks) && rec.tasks.includes(key) ? 1 : 0), 0);
  }

  function hasPerfectQuiz() {
    return EPISODES.some((ep) => {
      const p = state.progress[ep.id];
      if (!p || !p.quiz) return false;
      return ep.questions.every((q, i) => p.quiz[i] === q.answer);
    });
  }

  function heroTitle(title) {
    const words = String(title).split(' ');
    if (words.length < 2) return escapeHTML(title);
    const last = words.pop();
    return escapeHTML(words.join(' ')) + ' <em>' + escapeHTML(last) + '</em>';
  }

  function waveBars(count = 25, seed = 1) {
    let html = '';
    for (let i = 0; i < count; i += 1) {
      const value = 18 + ((Math.sin((i + seed) * 1.7) + 1) / 2) * 76;
      html += '<i style="height:' + value.toFixed(0) + '%"></i>';
    }
    return html;
  }

  function audioBars(count = 21) {
    let html = '';
    for (let i = 0; i < count; i += 1) {
      html += '<i style="animation-delay:' + (i * 0.055).toFixed(2) + 's;height:' + (6 + (i % 5) * 4) + 'px"></i>';
    }
    return html;
  }

  /* ============================== Chrome / routing ============================== */

  function updateChrome() {
    const today = todayStr();
    const ep = activeEpisode();
    const rec = getDayRecord(today);
    const streak = computeStreak();

    const topDate = $('#topbar-date');
    if (topDate) topDate.textContent = dateCn(today) + ' · ' + weekdayCn(today);
    const topSub = $('#topbar-sub');
    if (topSub && ep) topSub.textContent = 'DAY ' + pad(dayNumber()) + ' · ' + ep.zhTitle;
    const dot = $('#side-today-dot');
    if (dot) dot.style.visibility = rec.completed ? 'hidden' : 'visible';
    const count = $('#side-library-count');
    if (count) count.textContent = String(EPISODES.length);

    $$('.side-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === ui.view);
    });
    $$('.mobile-nav a').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === ui.view);
    });

    const num = $('#side-streak-num');
    if (num) num.textContent = streak;
    const copy = $('#side-streak-copy');
    if (copy) {
      if (streak === 0) copy.textContent = '今天听 25 分钟，点亮第一天。';
      else if (streak < 3) copy.textContent = '已经连续 ' + streak + ' 天，再听一天形成节奏。';
      else if (streak < 7) copy.textContent = '连续 ' + streak + ' 天。耳朵正在适应真实语速。';
      else copy.textContent = '连续 ' + streak + ' 天。把听力变成日常，而不是任务。';
    }
    renderMiniWeek();
    applyFontSize();
  }

  function renderMiniWeek() {
    const wrap = $('#mini-week');
    if (!wrap) return;
    const today = todayStr();
    let html = '';
    for (let i = 6; i >= 0; i -= 1) {
      const date = addDays(today, -i);
      const rec = state.history[date];
      let cls = '';
      if (rec && rec.completed) cls = 'on';
      else if (rec && rec.tasks && rec.tasks.length) cls = 'partial';
      html += '<i class="' + cls + '" title="' + dateCn(date) + '"></i>';
    }
    wrap.innerHTML = html;
  }

  function route() {
    if (!location.hash) {
      try { history.replaceState(null, '', '#today'); } catch (err) { location.hash = '#today'; }
    }
    const hash = location.hash.replace(/^#\/?/, '');
    closeFocus(true);
    stopMedia();
    if (hash.indexOf('episode/') === 0) {
      ui.view = 'today';
      ui.episodeId = decodeURIComponent(hash.slice('episode/'.length));
    } else if (['today', 'library', 'progress', 'settings'].includes(hash)) {
      ui.view = hash;
      ui.episodeId = null;
    } else {
      ui.view = 'today';
      ui.episodeId = null;
    }
    ui.tab = 'lines';
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const ep = activeEpisode();
    currentEpisode = ep;
    const view = $('#view');
    if (!view || !ep) return;

    updateChrome();
    if (ui.view === 'today') {
      document.title = ep.title + ' · EchoDaily';
      view.innerHTML = todayTemplate(ep);
      mountPlayer(ep);
      updateTaskUI();
      renderTab();
      applyFontSize();
    } else if (ui.view === 'library') {
      document.title = '听力库 · EchoDaily';
      view.innerHTML = libraryTemplate();
      bindLibraryEvents();
    } else if (ui.view === 'progress') {
      document.title = '学习记录 · EchoDaily';
      view.innerHTML = progressTemplate();
    } else {
      document.title = '设置 · EchoDaily';
      view.innerHTML = settingsTemplate();
    }
    updateChrome();
  }

  /* ============================== Today ============================== */

  function todayTemplate(ep) {
    const today = todayStr();
    const rec = getDayRecord(today);
    const done = rec.tasks.length;
    const pct = Math.round((done / TASKS.length) * 100);
    const streak = computeStreak();
    const p = ensureProgress(ep.id);
    const clipTag = formatTime(ep.clipStart) + ' – ' + formatTime(ep.clipEnd);

    return '' +
      '<section class="hero" data-theme="' + escapeHTML(ep.theme) + '">' +
        '<div class="hero-copy">' +
          '<div class="hero-topline">' +
            '<span class="hero-kicker">DAILY LISTENING / <b>NO. ' + escapeHTML(ep.issue) + '</b></span>' +
            '<span class="hero-live"><i></i>' + escapeHTML(ep.source) + ' · 最新可用</span>' +
          '</div>' +
          '<h1>' + heroTitle(ep.title) + '</h1>' +
          '<p class="hero-zh">' + escapeHTML(ep.zhTitle) + '</p>' +
          '<p class="hero-deck">' + escapeHTML(ep.zhDeck) + '</p>' +
          '<div class="hero-meta">' +
            '<span>' + icon('clock') + formatDuration(ep.duration) + '精听</span>' +
            '<span>' + icon('captions') + '双语逐句</span>' +
            '<span>' + icon('volume') + '原声视频 + 音频</span>' +
            '<span>' + escapeHTML(ep.level) + ' · ' + escapeHTML(ep.accent) + '</span>' +
          '</div>' +
          '<div class="hero-actions">' +
            '<button class="btn btn-primary" data-action="start-focus">' + icon('play') + '开始 25 分钟训练</button>' +
            '<button class="btn btn-ghost" data-action="play-episode">' + icon('volume') + '先听为快</button>' +
            '<div class="hero-progress">' +
              '<div class="hero-progress-bar"><span id="hero-progress-bar" style="width:' + pct + '%"></span></div>' +
              '<p id="hero-progress-copy">今日任务 ' + done + '/5 · ' + (done === 5 ? '已完成' : '还差 ' + (5 - done) + ' 步') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="hero-art" aria-hidden="true">' +
          '<div class="orbit o1"></div><div class="orbit o2"></div><div class="orbit o3"></div>' +
          '<div class="stamp">ECHO<br>DAILY<br>' + escapeHTML(ep.dateLabel) + '</div>' +
          '<div class="side-label">LISTEN · REPEAT · SPEAK</div>' +
          '<div class="wave">' + waveBars(27, ep.issue.charCodeAt(0)) + '</div>' +
          '<div class="issue-no">' + escapeHTML(ep.issue) + '</div>' +
        '</div>' +
      '</section>' +

      '<div class="today-grid">' +
        '<section class="workspace card sub-' + ui.subtitleMode + '" id="workspace">' +
          '<div class="workspace-bar">' +
            '<div class="workspace-title"><span class="dot"></span><strong>精听工作台</strong><span>' + escapeHTML(ep.dateLabel) + ' · ' + clipTag + ' 精选片段</span></div>' +
            '<div class="workspace-tools">' +
              '<div class="seg" id="subtitle-seg">' +
                '<button data-action="set-subtitle" data-mode="both" class="' + (ui.subtitleMode === 'both' ? 'active' : '') + '">中英</button>' +
                '<button data-action="set-subtitle" data-mode="en" class="' + (ui.subtitleMode === 'en' ? 'active' : '') + '">EN</button>' +
                '<button data-action="set-subtitle" data-mode="zh" class="' + (ui.subtitleMode === 'zh' ? 'active' : '') + '">中文</button>' +
                '<button data-action="set-subtitle" data-mode="none" class="' + (ui.subtitleMode === 'none' ? 'active' : '') + '">无</button>' +
              '</div>' +
              '<button class="tool-btn" data-action="font-down" title="缩小字号">A−</button>' +
              '<button class="tool-btn" data-action="font-up" title="放大字号">A+</button>' +
            '</div>' +
          '</div>' +
          '<div class="workspace-body">' +
            '<div class="player-col">' +
              '<div class="player-shell" id="player-shell">' +
                '<video id="media" playsinline preload="none"></video>' +
                '<div class="audio-visual">' +
                  '<div class="audio-disc"></div>' +
                  '<div class="audio-bars">' + audioBars() + '</div>' +
                  '<small>CNN 10 · ORIGINAL AUDIO</small>' +
                '</div>' +
                '<div class="player-top">' +
                  '<span class="player-badge"><i></i>' + escapeHTML(ep.source) + ' ORIGINAL</span>' +
                  '<div class="player-mode-toggle">' +
                    '<button data-action="set-media" data-mode="video" class="' + (ui.mediaMode === 'video' ? 'active' : '') + '">视频</button>' +
                    '<button data-action="set-media" data-mode="audio" class="' + (ui.mediaMode === 'audio' ? 'active' : '') + '">音频</button>' +
                  '</div>' +
                '</div>' +
                '<span class="clip-tag" id="clip-tag">精听 ' + clipTag + '</span>' +
                '<div class="player-center"><button class="big-play" data-action="toggle-play" aria-label="播放">' + icon('play') + '</button></div>' +
                '<div class="subtitle-overlay sub-' + ui.subtitleMode + '" id="subtitle-overlay">' +
                  '<p><span class="sub-en" id="overlay-en">' + escapeHTML((buildSentenceCues(ep)[0] || ep.segments[0]).en) + '</span></p>' +
                  '<p><span class="sub-zh" id="overlay-zh">' + escapeHTML((buildSentenceCues(ep)[0] || ep.segments[0]).zh) + '</span></p>' +
                '</div>' +
                '<div class="control-bar">' +
                  '<div class="seek-row">' +
                    '<span class="time-code" id="time-current">0:00</span>' +
                    '<input class="seek" id="seek" type="range" min="0" max="100" step="0.05" value="0" aria-label="播放进度">' +
                    '<span class="time-code dur" id="time-duration">' + formatTime(ep.fullDuration) + '</span>' +
                  '</div>' +
                  '<div class="control-row">' +
                    '<button class="ctrl" data-action="seek-back" aria-label="后退 5 秒">' + icon('back5') + '</button>' +
                    '<button class="ctrl" id="btn-play" data-action="toggle-play" aria-label="播放或暂停">' + icon('play') + '</button>' +
                    '<button class="ctrl" data-action="seek-fwd" aria-label="前进 5 秒">' + icon('fwd5') + '</button>' +
                    '<button class="ctrl" data-action="toggle-loop" aria-label="循环当前句">' + icon('repeat') + '</button>' +
                    '<span class="ctrl-spacer"></span>' +
                    '<button class="speed-pill" id="speed-pill" data-action="cycle-speed">1.0×</button>' +
                    '<button class="ctrl" data-action="cycle-subtitle" aria-label="切换字幕">' + icon('captions') + '</button>' +
                    '<button class="ctrl" data-action="fullscreen" aria-label="全屏">' + icon('expand') + '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="player-caption" id="player-caption">' +
                '<p><strong>今日片段</strong> · ' + formatDuration(ep.duration) + ' / 完整节目 ' + formatDuration(ep.fullDuration) + '<br>' +
                  '<span id="player-status">点播放开始。视频加载慢时会自动切换音频。</span></p>' +
                '<div class="mini-actions">' +
                  '<button class="round-btn" data-action="toggle-full" title="完整节目 / 精听片段">' + icon('repeat') + '</button>' +
                  '<button class="round-btn" data-action="replay" title="重播本句">' + icon('back5') + '</button>' +
                '</div>' +
              '</div>' +
              '<div class="clip-map">' +
                '<div class="clip-map-head"><span class="eyebrow">IN THIS CLIP</span><span>点击跳转</span></div>' +
                clipMapHTML(ep) +
              '</div>' +
            '</div>' +
            '<div class="transcript-col">' +
              '<div class="transcript-head">' +
                '<div class="tabs" id="tabs">' +
                  '<button class="tab active" data-action="set-tab" data-tab="lines">逐句稿<span class="count">' + ep.segments.length + '</span></button>' +
                  '<button class="tab" data-action="set-tab" data-tab="vocab">词汇<span class="count">' + ep.vocab.length + '</span></button>' +
                  '<button class="tab" data-action="set-tab" data-tab="quiz">测验<span class="count">' + ep.questions.length + '</span></button>' +
                  '<button class="tab" data-action="set-tab" data-tab="notes">笔记</button>' +
                '</div>' +
                '<div class="transcript-tools">' +
                  '<button class="tool-btn" data-action="toggle-autoscroll" title="自动滚动">' + icon('arrow') + '</button>' +
                '</div>' +
              '</div>' +
              '<div id="tab-panel"></div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<aside class="rail">' +
          '<div class="card rail-card">' +
            '<div class="rail-head">' +
              '<div><span class="eyebrow">TODAY\'S PLAN</span><h3>25 分钟，刚刚好</h3><p>听一段真实新闻，比刷十条短视频更有用。</p></div>' +
              '<div class="ring" id="task-ring" style="--p:' + pct + '"><span id="task-ring-label">' + done + '<small>/5</small></span></div>' +
            '</div>' +
            '<ul class="task-list" id="task-list">' + taskListHTML(rec) + '</ul>' +
            '<button class="btn btn-primary rail-cta" data-action="start-focus">' + icon('play') + '开始引导训练</button>' +
            '<div class="streak-line">' + icon('spark') + '<strong>' + streak + ' 天</strong><span>连续学习 · 最长 ' + longestStreak() + ' 天</span></div>' +
          '</div>' +

          '<div class="card rail-card">' +
            '<div class="rail-head"><div><span class="eyebrow">THIS WEEK</span><h3>本周听力单</h3><p>每周六换一批，链接不变。</p></div></div>' +
            '<div class="week-list">' + weekListHTML() + '</div>' +
          '</div>' +
        '</aside>' +
      '</div>' +

      '<div class="section-head">' +
        '<div><span class="eyebrow">DEEPER LISTENING</span><h2>听完了，再读一点</h2><p>逐句稿、词汇与理解题都在上面的工作台里。</p></div>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
          '<a class="text-link" href="' + escapeHTML(ep.sourceUrl) + '" target="_blank" rel="noopener">查看原节目 ' + icon('external') + '</a>' +
          '<a class="text-link" href="' + escapeHTML(ep.transcriptUrl) + '" target="_blank" rel="noopener">逐句稿来源 ' + icon('external') + '</a>' +
        '</div>' +
      '</div>' +
      '<div class="source-strip">' +
        '<a class="source-link" href="https://edition.cnn.com/audio/podcasts/cnn-10" target="_blank" rel="noopener"><span class="source-mark">10</span><span><strong>CNN 10</strong><span>每日 10 分钟国际新闻</span></span>' + icon('external') + '</a>' +
        '<a class="source-link" href="https://www.npr.org/podcasts/510325/the-indicator-from-planet-money" target="_blank" rel="noopener"><span class="source-mark">N</span><span><strong>NPR The Indicator</strong><span>经济与商业访谈</span></span>' + icon('external') + '</a>' +
        '<a class="source-link" href="https://www.ted.com/talks" target="_blank" rel="noopener"><span class="source-mark">T</span><span><strong>TED Talks</strong><span>演讲 · 观点 · 字幕</span></span>' + icon('external') + '</a>' +
        '<a class="source-link" href="https://www.nasa.gov/feed/" target="_blank" rel="noopener"><span class="source-mark">N</span><span><strong>NASA</strong><span>科学新闻 · 官方文稿</span></span>' + icon('external') + '</a>' +
      '</div>';
  }

  function clipMapHTML(ep) {
    const seen = new Set();
    return ep.segments.reduce((html, seg, index) => {
      if (seen.has(seg.section)) return html;
      seen.add(seg.section);
      return html + '<button class="clip-chip" data-action="seek-time" data-time="' + seg.start + '">' +
        '<span>' + escapeHTML(seg.section) + '</span><b>' + formatTime(seg.start) + '</b></button>';
    }, '');
  }

  function taskListHTML(rec) {
    return TASKS.map((task) => {
      const done = rec.tasks.includes(task.key);
      return '<li class="task-item ' + (done ? 'done' : '') + '" data-action="toggle-task" data-task="' + task.key + '">' +
        '<button class="task-check" aria-label="标记完成" data-action="toggle-task" data-task="' + task.key + '">' + icon('check') + '</button>' +
        '<div><span class="task-name">' + task.name + '<span class="task-sub">' + task.sub + '</span></span></div>' +
        '<span class="task-min">' + task.min + ' min</span>' +
      '</li>';
    }).join('');
  }

  function weekListHTML() {
    const sorted = EPISODES.slice().sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, 4).map((ep) => {
      const p = state.progress[ep.id];
      const done = p && Array.isArray(p.mastered) && p.mastered.length > 0;
      return '<a class="week-row ' + (done ? 'on' : '') + '" href="#episode/' + encodeURIComponent(ep.id) + '">' +
        '<i></i><span>' + escapeHTML(ep.dateLabel) + '</span><b>' + escapeHTML(ep.zhTitle) + '</b></a>';
    }).join('');
  }

  /* ============================== Player ============================== */

  function mountPlayer(ep) {
    activeIndex = -1;
    activeCueIndex = -1;
    videoFailed = false;
    const shell = $('#player-shell');
    media = $('#media');
    if (!shell || !media) return;

    const source = ui.mediaMode === 'audio' ? ep.media.audio : ep.media.video;
    shell.classList.toggle('audio-mode', ui.mediaMode === 'audio');
    shell.classList.add('loading');
    media.src = source;
    media.preload = 'metadata';
    media.volume = 1;
    media.playbackRate = ui.speed || 1;

    const onLoaded = () => {
      shell.classList.remove('loading');
      const duration = isFinite(media.duration) && media.duration > 0 ? media.duration : ep.fullDuration;
      const durEl = $('#time-duration');
      if (durEl) durEl.textContent = formatTime(duration);
      const p = ensureProgress(ep.id);
      let start = ep.clipStart;
      if (p.lastTime >= ep.clipStart - 1 && p.lastTime <= ep.clipEnd + 1) start = p.lastTime;
      try { media.currentTime = start; } catch (err) { /* metadata may not be ready */ }
      updateTimeUI(media.currentTime, duration);
    };

    media.addEventListener('loadedmetadata', onLoaded, { once: true });
    if (media.readyState >= 1) onLoaded();

    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('play', () => {
      const sh = $('#player-shell');
      if (sh) sh.classList.add('playing');
      const btn = $('#btn-play');
      if (btn) btn.innerHTML = icon('pause');
      updatePlayerStatus('正在播放 · 字幕按句同步，可点段落跳转');
      showControls();
    });
    media.addEventListener('pause', () => {
      const sh = $('#player-shell');
      if (sh) sh.classList.remove('playing');
      const btn = $('#btn-play');
      if (btn) btn.innerHTML = icon('play');
      clearTimeout(ui.controlsTimer);
      setControlsVisible(true);
      savePlayback();
    });
    media.addEventListener('waiting', () => {
      const sh = $('#player-shell');
      if (sh) sh.classList.add('loading');
      updatePlayerStatus('正在缓冲…');
      setControlsVisible(true);
    });
    media.addEventListener('playing', () => {
      const sh = $('#player-shell');
      if (sh) sh.classList.remove('loading');
    });
    media.addEventListener('ended', () => {
      const sh = $('#player-shell');
      if (sh) sh.classList.remove('playing');
      clearTimeout(ui.controlsTimer);
      setControlsVisible(true);
    });
    media.addEventListener('error', () => {
      if (!media || destroyingMedia) return;
      if (ui.mediaMode === 'video' && !videoFailed) {
        videoFailed = true;
        updatePlayerStatus('视频加载失败，已自动切换到音频');
        toast('视频源加载失败，已切换为音频', 'error');
        setMediaMode('audio', true);
      } else {
        updatePlayerStatus('媒体加载失败，请检查网络，或点右下角打开原节目');
        toast('媒体加载失败，请检查网络后重试', 'error');
      }
    });

    updateTimeUI(ep.clipStart, ep.fullDuration);
    setMediaButtons();
    setSubtitleUI();
    bindAutoHideControls(shell);
  }

  function setControlsVisible(visible) {
    const shell = $('#player-shell');
    if (!shell) return;
    shell.classList.toggle('controls-hidden', !visible);
    if (visible) shell.classList.remove('cursor-hidden');
    else shell.classList.add('cursor-hidden');
  }

  function scheduleControlsHide() {
    clearTimeout(ui.controlsTimer);
    if (!media || media.paused) {
      setControlsVisible(true);
      return;
    }
    ui.controlsTimer = setTimeout(() => setControlsVisible(false), 2600);
  }

  function showControls() {
    setControlsVisible(true);
    scheduleControlsHide();
  }

  function bindAutoHideControls(shell) {
    clearTimeout(ui.controlsTimer);
    setControlsVisible(true);
    scheduleControlsHide();

    const activity = () => showControls();
    shell.addEventListener('mousemove', activity);
    shell.addEventListener('pointermove', activity);
    shell.addEventListener('mouseenter', activity);
    shell.addEventListener('touchstart', activity, { passive: true });
    shell.addEventListener('focusin', activity);

    shell.addEventListener('mouseleave', () => {
      if (media && !media.paused) {
        clearTimeout(ui.controlsTimer);
        setControlsVisible(false);
      }
    });

    // Clicking the video toggles play/pause, like a normal video player.
    shell.addEventListener('click', (event) => {
      if (event.target.closest('button, input, .control-bar, .player-top, .player-mode-toggle')) return;
      if (shell.classList.contains('controls-hidden')) {
        showControls();
        return;
      }
      togglePlay();
    });

    const onFullscreen = () => {
      setControlsVisible(true);
      scheduleControlsHide();
    };
    if (ui.fullscreenHandler) document.removeEventListener('fullscreenchange', ui.fullscreenHandler);
    ui.fullscreenHandler = onFullscreen;
    document.addEventListener('fullscreenchange', onFullscreen);
  }

  function onTimeUpdate() {
    if (!media || !currentEpisode) return;
    const ep = currentEpisode;
    const t = media.currentTime;
    const duration = isFinite(media.duration) && media.duration > 0 ? media.duration : ep.fullDuration;
    updateTimeUI(t, duration);

    const cues = buildSentenceCues(ep);
    let cueIndex = -1;
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      if (t >= cue.start - 0.08 && t < cue.end + 0.08) { cueIndex = i; break; }
    }
    if (cueIndex !== activeCueIndex) setActiveCue(cueIndex, true);
    const segmentIndex = cueIndex >= 0 ? cues[cueIndex].segIndex : -1;
    if (segmentIndex !== activeIndex) setActiveLine(segmentIndex, true);

    if (ui.loopSegment && activeIndex >= 0) {
      const seg = ep.segments[activeIndex];
      if (!media.paused && t >= seg.end - 0.08) {
        try { media.currentTime = seg.start + 0.01; } catch (err) { /* ignore */ }
        return;
      }
    }

    if (!ui.fullMode && t >= ep.clipEnd - 0.1 && !media.paused) {
      media.pause();
      ui.clipEnded = true;
      updatePlayerStatus('精选片段结束 · 用右下角按钮切到完整节目');
      toast('精听片段结束，可切到完整节目继续');
    }

    if (Date.now() - (ui.lastSave || 0) > 3500) {
      ui.lastSave = Date.now();
      savePlayback();
    }
  }

  function updateTimeUI(t, duration) {
    const seek = $('#seek');
    if (seek) {
      const pct = duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0;
      seek.value = String(pct);
      seek.style.setProperty('--p', pct + '%');
    }
    const cur = $('#time-current');
    if (cur) cur.textContent = formatTime(t);
    const dur = $('#time-duration');
    if (dur) dur.textContent = formatTime(duration);
  }

  function updatePlayerStatus(text) {
    const el = $('#player-status');
    if (el) el.textContent = text;
  }

  function savePlayback() {
    if (!media || !currentEpisode) return;
    if (!isFinite(media.currentTime)) return;
    const p = ensureProgress(currentEpisode.id);
    p.lastTime = media.currentTime;
    p.lastPlayed = Date.now();
    saveState();
  }

  function stopMedia() {
    if (!media) return;
    destroyingMedia = true;
    savePlayback();
    try { media.pause(); } catch (err) { /* ignore */ }
    try { media.removeAttribute('src'); media.load(); } catch (err) { /* ignore */ }
    media = null;
    activeIndex = -1;
    activeCueIndex = -1;
    clearTimeout(ui.controlsTimer);
    if (ui.fullscreenHandler) {
      document.removeEventListener('fullscreenchange', ui.fullscreenHandler);
      ui.fullscreenHandler = null;
    }
    setTimeout(() => { destroyingMedia = false; }, 30);
  }

  function togglePlay() {
    if (!media || !currentEpisode) return;
    if (media.paused) {
      if (media.currentTime >= currentEpisode.clipEnd - 0.2 && !ui.fullMode) {
        try { media.currentTime = currentEpisode.clipStart; } catch (err) { /* ignore */ }
        ui.clipEnded = false;
      }
      media.play().catch(() => {
        toast('浏览器阻止了自动播放，请再点一次播放键', 'error');
      });
    } else {
      media.pause();
    }
  }

  function seekBy(delta) {
    if (!media || !currentEpisode) return;
    const duration = isFinite(media.duration) && media.duration > 0 ? media.duration : currentEpisode.fullDuration;
    media.currentTime = Math.min(duration - 0.2, Math.max(0, media.currentTime + delta));
    updateTimeUI(media.currentTime, duration);
  }

  function seekTo(time, play) {
    if (!media || !currentEpisode) return;
    const duration = isFinite(media.duration) && media.duration > 0 ? media.duration : currentEpisode.fullDuration;
    const next = Math.min(duration - 0.15, Math.max(0, Number(time) || 0));
    try { media.currentTime = next; } catch (err) { /* ignore */ }
    ui.clipEnded = false;
    updateTimeUI(next, duration);
    if (play) media.play().catch(() => {});
  }

  function playEpisodeFromStart() {
    if (!currentEpisode || !media) return;
    const start = currentEpisode.clipStart;
    if (media.readyState >= 1) {
      seekTo(start, true);
    } else {
      media.addEventListener('loadedmetadata', () => seekTo(start, true), { once: true });
      media.load();
    }
  }

  function playSegment(index) {
    if (!currentEpisode || !media) return;
    const seg = currentEpisode.segments[index];
    if (!seg) return;
    seekTo(seg.start + 0.01, true);
    setActiveLine(index, false);
    const cues = buildSentenceCues(currentEpisode);
    const firstCue = cues.findIndex((cue) => cue.segIndex === index);
    if (firstCue >= 0) setActiveCue(firstCue, false);
    updatePlayerStatus('正在播放第 ' + (index + 1) + ' 段 · ' + formatTime(seg.start));
  }

  function playCue(index) {
    if (!currentEpisode || !media) return;
    const cue = buildSentenceCues(currentEpisode)[index];
    if (!cue) return;
    seekTo(cue.start + 0.01, true);
    setActiveCue(index, false);
    setActiveLine(cue.segIndex, false);
    updatePlayerStatus('正在播放当前句 · ' + formatTime(cue.start));
  }

  function setActiveLine(index, autoScroll) {
    activeIndex = index;
    $$('.t-item').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.index) === index);
    });
    if (autoScroll && state.settings.autoScroll) {
      const active = $('.t-item.active');
      const scroll = $('.transcript-scroll');
      if (active && scroll) {
        const top = active.offsetTop - scroll.clientHeight / 2 + active.offsetHeight / 2;
        scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }
  }

  function setActiveCue(index, autoScroll) {
    activeCueIndex = index;
    const overlay = $('#subtitle-overlay');
    if (!overlay) return;
    if (!currentEpisode || index < 0) {
      overlay.classList.add('sub-hidden');
      return;
    }
    const cue = buildSentenceCues(currentEpisode)[index];
    if (!cue) {
      overlay.classList.add('sub-hidden');
      return;
    }
    const en = $('#overlay-en');
    const zh = $('#overlay-zh');
    if (en) en.textContent = cue.en;
    if (zh) zh.textContent = cue.zh;
    overlay.classList.remove('sub-hidden');
    // Keep the active sentence visible in the paragraph list as well.
    if (autoScroll && state.settings.autoScroll) {
      const line = $('.t-item.active');
      if (line) {
        const current = line.querySelector('.t-current-sentence');
        if (current) {
          const scroll = $('.transcript-scroll');
          if (scroll) {
            const top = current.offsetTop - scroll.clientHeight / 2 + current.offsetHeight / 2;
            scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          }
        }
      }
    }
  }

  function setSubtitleUI() {
    const workspace = $('#workspace');
    if (workspace) {
      workspace.classList.remove('sub-both', 'sub-en', 'sub-zh', 'sub-none');
      workspace.classList.add('sub-' + ui.subtitleMode);
    }
    const overlay = $('#subtitle-overlay');
    if (overlay) {
      overlay.classList.remove('sub-both', 'sub-en', 'sub-zh', 'sub-none');
      overlay.classList.add('sub-' + ui.subtitleMode);
      if (activeCueIndex < 0) overlay.classList.add('sub-hidden');
      else overlay.classList.remove('sub-hidden');
    }
    $$('#subtitle-seg button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === ui.subtitleMode);
    });
  }

  function setSubtitleMode(mode, persist) {
    if (!['both', 'en', 'zh', 'none'].includes(mode)) return;
    ui.subtitleMode = mode;
    if (persist !== false) {
      state.settings.defaultSubtitle = mode;
      saveState();
    }
    setSubtitleUI();
    if (!$('#focus-layer').hidden) {
      const main = $('#focus-main');
      if (main) main.classList.remove('sub-both', 'sub-en', 'sub-zh', 'sub-none');
      if (main) main.classList.add('sub-' + mode);
      renderFocusSentence();
    }
  }

  function cycleSubtitle() {
    const order = ['both', 'en', 'zh', 'none'];
    const next = order[(order.indexOf(ui.subtitleMode) + 1) % order.length];
    setSubtitleMode(next);
    const labels = { both: '中英双语', en: '仅英文', zh: '仅中文', none: '无字幕' };
    toast('字幕：' + labels[next]);
  }

  function cycleSpeed() {
    const speeds = [0.6, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
    const idx = speeds.indexOf(ui.speed);
    ui.speed = speeds[(idx + 1) % speeds.length];
    if (media) media.playbackRate = ui.speed;
    const pill = $('#speed-pill');
    if (pill) pill.textContent = ui.speed.toFixed(2).replace(/0$/, '') + '×';
    toast('播放速度 ' + ui.speed + '×');
  }

  function setMediaButtons() {
    $$('[data-action="set-media"]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === ui.mediaMode);
    });
    const shell = $('#player-shell');
    if (shell) shell.classList.toggle('audio-mode', ui.mediaMode === 'audio');
  }

  function setMediaMode(mode, silent) {
    if (!media || !currentEpisode || mode === ui.mediaMode) return;
    const time = media.currentTime;
    const wasPlaying = !media.paused;
    ui.mediaMode = mode;
    media.src = mode === 'audio' ? currentEpisode.media.audio : currentEpisode.media.video;
    media.load();
    media.addEventListener('loadedmetadata', () => {
      try { media.currentTime = time; } catch (err) { /* ignore */ }
      if (wasPlaying) media.play().catch(() => {});
    }, { once: true });
    setMediaButtons();
    if (!silent) toast(mode === 'audio' ? '已切换到音频模式' : '已切换到视频模式');
  }

  function toggleFullMode() {
    ui.fullMode = !ui.fullMode;
    const tag = $('#clip-tag');
    if (tag) {
      tag.textContent = ui.fullMode
        ? '完整节目 ' + formatTime(currentEpisode.fullDuration)
        : '精听 ' + formatTime(currentEpisode.clipStart) + ' – ' + formatTime(currentEpisode.clipEnd);
    }
    if (ui.fullMode) {
      ui.clipEnded = false;
      updatePlayerStatus('完整节目模式 · 不会在片段结尾暂停');
      toast('已切到完整节目');
    } else {
      updatePlayerStatus('精听片段模式 · 到结尾自动暂停');
      toast('已切回精听片段');
    }
  }

  function requestFullscreen() {
    const shell = $('#player-shell');
    if (!shell) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (shell.requestFullscreen) shell.requestFullscreen().catch(() => {});
  }

  /* ============================== Tabs / transcript / vocab / quiz / notes ============================== */

  function renderTab() {
    const panel = $('#tab-panel');
    if (!panel || !currentEpisode) return;
    const ep = currentEpisode;
    const p = ensureProgress(ep.id);
    $$('#tabs .tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === ui.tab);
    });

    if (ui.tab === 'vocab') {
      panel.innerHTML = '<div class="panel-scroll"><div class="vocab-grid">' + ep.vocab.map((v) => {
        const saved = state.vocab.includes(v.word);
        return '<div class="vocab-card">' +
          '<div class="vocab-top"><span class="vocab-word">' + escapeHTML(v.word) + '</span><span class="vocab-phonetic">' + escapeHTML(v.phonetic) + '</span><span class="vocab-pos">' + escapeHTML(v.pos) + '</span><span class="vocab-zh">' + escapeHTML(v.zh) + '</span></div>' +
          '<p class="vocab-ex"><b>' + escapeHTML(v.example) + '</b><br>' + escapeHTML(v.exampleZh) + '</p>' +
          '<div class="vocab-actions">' +
            '<button class="mini-btn" data-action="speak-word" data-word="' + escapeHTML(v.word) + '">' + icon('volume') + '发音</button>' +
            '<button class="mini-btn ' + (saved ? 'on' : '') + '" data-action="star-word" data-word="' + escapeHTML(v.word) + '">' + icon('star') + (saved ? '已加入生词本' : '加入生词本') + '</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div></div>';
    } else if (ui.tab === 'quiz') {
      const answered = Object.keys(p.quiz).length;
      const correct = ep.questions.reduce((sum, q, i) => sum + (p.quiz[i] === q.answer ? 1 : 0), 0);
      panel.innerHTML = '<div class="panel-scroll">' +
        '<div class="quiz-score">' + icon('spark') + '<strong>' + correct + '/' + ep.questions.length + '</strong><span>已答 ' + answered + ' 题 · 选出你的答案，立刻看解析</span></div>' +
        ep.questions.map((q, qi) => {
          const chosen = p.quiz[qi];
          const has = chosen !== undefined;
          return '<div class="quiz-q">' +
            '<span class="quiz-number">QUESTION ' + pad(qi + 1) + '</span>' +
            '<p class="quiz-text">' + escapeHTML(q.q) + '</p>' +
            '<div class="quiz-options">' + q.options.map((opt, oi) => {
              const cls = has ? (oi === q.answer ? 'correct' : (chosen === oi ? 'wrong' : '')) : '';
              return '<button class="quiz-option ' + cls + '" data-action="quiz-answer" data-q="' + qi + '" data-opt="' + oi + '" ' + (has ? 'disabled' : '') + '>' +
                '<span class="letter">' + String.fromCharCode(65 + oi) + '</span><span>' + escapeHTML(opt) + '</span></button>';
            }).join('') + '</div>' +
            (has ? '<p class="quiz-explain">' + (chosen === q.answer ? '✓ 正确。' : '✗ 再听一遍。') + escapeHTML(q.explain) + '</p>' : '') +
          '</div>';
        }).join('') + '</div>';
    } else if (ui.tab === 'notes') {
      panel.innerHTML = '<div class="panel-scroll"><div class="note-wrap">' +
        '<p class="note-prompt">写什么都可以：3 个关键词、一个没听清的连读、你的复述稿，或者今天最想记住的一句话。</p>' +
        '<textarea class="note-area" id="note-area" placeholder="例如：affordability = the top issue; 40 million early ballots…">' + escapeHTML(p.note || '') + '</textarea>' +
        '<div class="note-meta"><span>自动保存到本机</span><span id="note-status">已保存</span></div>' +
      '</div></div>';
      const area = $('#note-area');
      if (area) {
        area.addEventListener('input', () => {
          const status = $('#note-status');
          if (status) status.textContent = '输入中…';
          clearTimeout(noteTimer);
          noteTimer = setTimeout(() => {
            p.note = area.value;
            saveState();
            if (status) status.textContent = '已保存';
          }, 450);
        });
      }
    } else {
      panel.innerHTML = transcriptHTML(ep);
      if (activeIndex >= 0) {
        $$('.t-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.index) === activeIndex));
      }
    }
    applyFontSize();
  }

  function transcriptHTML(ep) {
    const p = ensureProgress(ep.id);
    let lastSection = '';
    return '<div class="transcript-scroll" id="transcript-scroll">' + ep.segments.map((seg, i) => {
      let out = '';
      if (seg.section !== lastSection) {
        out += '<div class="t-section">' + escapeHTML(seg.section) + '</div>';
        lastSection = seg.section;
      }
      const mastered = p.mastered.includes(i);
      out += '<div class="t-item ' + (mastered ? 'mastered' : '') + '" data-action="seek-line" data-index="' + i + '">' +
        '<span class="t-index">' + pad(i + 1) + '</span>' +
        '<div><p class="t-en">' + escapeHTML(seg.en) + '</p><p class="t-zh">' + escapeHTML(seg.zh) + '</p>' +
          '<div class="t-meta"><span>' + formatTime(seg.start) + '</span><span>·</span><span>点击跳转</span></div>' +
        '</div>' +
        '<button class="t-star" data-action="star-segment" data-index="' + i + '" aria-label="标记已掌握">' + icon('star') + '</button>' +
      '</div>';
      return out;
    }).join('') + '</div>';
  }

  function answerQuiz(qIndex, option) {
    if (!currentEpisode) return;
    const p = ensureProgress(currentEpisode.id);
    if (p.quiz[qIndex] !== undefined) return;
    p.quiz[qIndex] = option;
    saveState();
    renderTab();
    if (option === currentEpisode.questions[qIndex].answer) {
      toast('答对了，继续听下一句', 'success');
    } else {
      toast('没关系，回听一下这句话', 'error');
    }
  }

  function toggleMastered(index) {
    if (!currentEpisode) return;
    const p = ensureProgress(currentEpisode.id);
    const i = Number(index);
    if (p.mastered.includes(i)) p.mastered = p.mastered.filter((n) => n !== i);
    else p.mastered.push(i);
    saveState();
    const item = $('.t-item[data-index="' + i + '"]');
    if (item) item.classList.toggle('mastered', p.mastered.includes(i));
    toast(p.mastered.includes(i) ? '已标记为掌握' : '已取消掌握');
  }

  function toggleWord(word) {
    if (!word) return;
    if (state.vocab.includes(word)) state.vocab = state.vocab.filter((w) => w !== word);
    else state.vocab.push(word);
    saveState();
    renderTab();
    toast(state.vocab.includes(word) ? '已加入生词本' : '已从生词本移除');
  }

  function speak(word) {
    if (!('speechSynthesis' in window)) {
      toast('当前浏览器不支持语音朗读', 'error');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = state.settings.accent || 'en-US';
    utter.rate = 0.82;
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang === utter.lang) || voices.find((v) => v.lang && v.lang.indexOf('en') === 0);
    if (match) utter.voice = match;
    window.speechSynthesis.speak(utter);
  }

  function applyFontSize() {
    const size = Math.min(20, Math.max(11.5, Number(state.settings.fontSize) || 13));
    $$('.t-en').forEach((el) => { el.style.fontSize = size + 'px'; });
    $$('.t-zh').forEach((el) => { el.style.fontSize = Math.max(10, size - 2) + 'px'; });
  }

  /* ============================== Tasks / streak ============================== */

  function updateTaskUI() {
    if (ui.view !== 'today') return;
    const rec = getDayRecord(todayStr());
    const done = rec.tasks.length;
    const pct = Math.round((done / TASKS.length) * 100);
    const list = $('#task-list');
    if (list) list.innerHTML = taskListHTML(rec);
    const ring = $('#task-ring');
    if (ring) ring.style.setProperty('--p', pct);
    const label = $('#task-ring-label');
    if (label) label.innerHTML = done + '<small>/5</small>';
    const bar = $('#hero-progress-bar');
    if (bar) bar.style.width = pct + '%';
    const copy = $('#hero-progress-copy');
    if (copy) copy.textContent = '今日任务 ' + done + '/5 · ' + (done === 5 ? '已完成' : '还差 ' + (5 - done) + ' 步');
    updateChrome();
  }

  function markTask(key, on, silent) {
    const task = TASKS.find((t) => t.key === key);
    if (!task) return;
    const today = todayStr();
    const rec = state.history[today] || { tasks: [], completed: false, minutes: 0, episodeId: currentEpisode ? currentEpisode.id : null };
    const wasComplete = !!rec.completed;
    const set = new Set(rec.tasks || []);
    if (on === false) set.delete(key);
    else set.add(key);
    rec.tasks = Array.from(set);
    rec.episodeId = currentEpisode ? currentEpisode.id : rec.episodeId;
    rec.completed = rec.tasks.length === TASKS.length;
    rec.minutes = rec.completed ? 25 : rec.tasks.reduce((sum, k) => {
      const t = TASKS.find((item) => item.key === k);
      return sum + (t ? t.min : 0);
    }, 0);
    rec.updatedAt = Date.now();
    state.history[today] = rec;
    saveState();
    updateTaskUI();
    if (rec.completed && !wasComplete && !silent) celebrate();
  }

  function toggleTask(key) {
    const rec = getDayRecord(todayStr());
    markTask(key, !rec.tasks.includes(key));
  }

  function celebrate() {
    toast('今日 25 分钟完成，连续学习 ' + computeStreak() + ' 天', 'success');
    launchConfetti();
  }

  function launchConfetti() {
    const layer = $('#confetti-layer');
    if (!layer) return;
    const colors = ['#d24b2b', '#1d5948', '#b58a3f', '#e7a48c', '#f3d9a4', '#191813'];
    for (let i = 0; i < 42; i += 1) {
      const piece = document.createElement('i');
      piece.className = 'confetti';
      piece.style.left = (4 + Math.random() * 92) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty('--x', (Math.random() * 140 - 70).toFixed(0) + 'px');
      piece.style.setProperty('--r', (Math.random() * 900 - 450).toFixed(0) + 'deg');
      piece.style.setProperty('--dur', (1.7 + Math.random() * 1.3).toFixed(2) + 's');
      piece.style.animationDelay = (Math.random() * 0.25).toFixed(2) + 's';
      layer.appendChild(piece);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 3400);
  }

  /* ============================== Library ============================== */

  function libraryTemplate() {
    return '' +
      '<div class="page-head">' +
        '<div><span class="eyebrow">LISTENING LIBRARY</span><h1>听力库</h1><p>一周五条真实国际新闻，每条都配好双语逐句稿、原声视频和可点击的时间轴。每周六更新 5 期，公用链接保持不变；慢一点，听懂比听完重要。</p></div>' +
        '<label class="search-box">' + icon('search') + '<input id="library-search" type="search" placeholder="搜索主题、国家或关键词…" value="' + escapeHTML(ui.search) + '" autocomplete="off"></label>' +
      '</div>' +
      '<div class="filter-row" id="filter-row">' +
        ['all|全部', 'video|视频', 'audio|纯音频', 'news|新闻', 'tech|科技', 'world|国际'].map((pair) => {
          const value = pair.split('|')[0];
          const label = pair.split('|')[1];
          return '<button class="filter-btn ' + (ui.filter === value ? 'active' : '') + '" data-action="filter-library" data-filter="' + value + '">' + label + '</button>';
        }).join('') +
        '<span style="margin-left:auto;font-size:9px;color:var(--faint)">共 ' + EPISODES.length + ' 期 · 每周六更新</span>' +
      '</div>' +
      '<div class="library-grid" id="library-grid">' + libraryGridHTML() + '</div>' +
      '<div class="section-head"><div><span class="eyebrow">MORE SOURCES</span><h2>换一种声音</h2><p>新闻、访谈、演讲、科学报道——不同口音和体裁，都值得听。</p></div></div>' +
      '<div class="source-strip">' +
        '<a class="source-link" href="https://edition.cnn.com/audio/podcasts/cnn-10" target="_blank" rel="noopener"><span class="source-mark">10</span><span><strong>CNN 10</strong><span>每日国际新闻 · 美音</span></span>' + icon('external') + '</a>' +
        '<a class="source-link" href="https://www.npr.org/podcasts/510325/the-indicator-from-planet-money" target="_blank" rel="noopener"><span class="source-mark">N</span><span><strong>The Indicator</strong><span>经济访谈 · 10 分钟</span></span>' + icon('external') + '</a>' +
        '<a class="source-link" href="https://www.ted.com/talks" target="_blank" rel="noopener"><span class="source-mark">T</span><span><strong>TED Talks</strong><span>演讲 · 多语字幕</span></span>' + icon('external') + '</a>' +
        '<a class="source-link" href="https://www.nasa.gov/feed/" target="_blank" rel="noopener"><span class="source-mark">N</span><span><strong>NASA</strong><span>科学新闻 · 官方文稿</span></span>' + icon('external') + '</a>' +
      '</div>';
  }

  function libraryFiltered() {
    const q = ui.search.trim().toLowerCase();
    return EPISODES.filter((ep) => {
      if (ui.filter === 'video' && ep.format !== 'video') return false;
      if (ui.filter === 'audio' && ep.format !== 'audio') return false;
      if (ui.filter === 'news' && ep.type !== 'news') return false;
      if (ui.filter === 'tech' && ep.type !== 'tech') return false;
      if (ui.filter === 'world' && !ep.topics.some((t) => t.toLowerCase().indexOf('world') !== -1)) return false;
      if (!q) return true;
      const haystack = [ep.title, ep.zhTitle, ep.summary, ep.zhSummary, ep.zhDeck, ep.deck, ep.topics.join(' '), ep.source].join(' ').toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  function libraryGridHTML() {
    const items = libraryFiltered();
    if (!items.length) {
      return '<div class="empty-state"><strong>没有找到这一条</strong>换个关键词，或者点“全部”看看本周的听力单。</div>';
    }
    return items.map((ep) => {
      const p = ensureProgress(ep.id);
      const progress = p.lastTime ? Math.min(100, (p.lastTime / ep.clipEnd) * 100) : 0;
      const mastered = p.mastered.length;
      return '<article class="ep-card card">' +
        '<a href="#episode/' + encodeURIComponent(ep.id) + '" class="ep-cover" data-theme="' + escapeHTML(ep.theme) + '">' +
          '<div class="cover-top"><span class="cover-date">' + escapeHTML(ep.dateLabel) + ' · ' + escapeHTML(ep.source) + '</span><span class="cover-no">' + escapeHTML(ep.issue) + '</span></div>' +
          '<h3>' + escapeHTML(ep.title) + '</h3>' +
          '<span class="cover-type">' + icon('play') + (ep.format === 'video' ? 'VIDEO' : 'AUDIO') + ' · ' + formatDuration(ep.duration) + '</span>' +
        '</a>' +
        '<div class="ep-body">' +
          '<p class="ep-zh">' + escapeHTML(ep.zhTitle) + '</p>' +
          '<h4>' + escapeHTML(ep.topics.join(' · ')) + '</h4>' +
          '<p class="ep-summary">' + escapeHTML(ep.zhSummary) + '</p>' +
          '<div class="ep-meta"><span>' + escapeHTML(ep.level) + '</span><span>·</span><span>' + mastered + '/' + ep.segments.length + ' 句已掌握</span><span class="bar"><span style="width:' + progress + '%"></span></span></div>' +
          '<div class="ep-actions">' +
            '<a class="btn btn-dark btn-sm" href="#episode/' + encodeURIComponent(ep.id) + '">' + icon('play') + (progress > 2 ? '继续精听' : '开始精听') + '</a>' +
            '<a class="btn btn-ghost btn-sm" href="' + escapeHTML(ep.sourceUrl) + '" target="_blank" rel="noopener">原节目' + icon('external') + '</a>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function bindLibraryEvents() {
    const input = $('#library-search');
    if (input) {
      input.addEventListener('input', () => {
        ui.search = input.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          const grid = $('#library-grid');
          if (grid) grid.innerHTML = libraryGridHTML();
        }, 140);
      });
    }
  }

  /* ============================== Progress ============================== */

  function progressTemplate() {
    const streak = computeStreak();
    const days = completedDays();
    const minutes = totalMinutes();
    const mastered = masteredCount();
    const records = Object.keys(state.history)
      .filter((d) => state.history[d].tasks && state.history[d].tasks.length)
      .sort()
      .reverse()
      .slice(0, 8);

    return '' +
      '<div class="page-head"><div><span class="eyebrow">YOUR PROGRESS</span><h1>学习记录</h1><p>不需要完美。每一次点开、每一句回听，都会留下痕迹。</p></div>' +
        '<button class="btn btn-ghost btn-sm" data-action="export-data">' + icon('download') + '导出数据</button></div>' +
      '<div class="stats-grid">' +
        '<div class="stat-card card accent"><span class="stat-label">CURRENT STREAK</span><div class="stat-value">' + streak + '<small> 天</small></div><div class="stat-foot">最长连续 ' + longestStreak() + ' 天</div></div>' +
        '<div class="stat-card card"><span class="stat-label">DAYS COMPLETED</span><div class="stat-value">' + days + '<small> 天</small></div><div class="stat-foot">每次 25 分钟</div></div>' +
        '<div class="stat-card card"><span class="stat-label">LISTENING TIME</span><div class="stat-value">' + minutes + '<small> 分钟</small></div><div class="stat-foot">约 ' + (minutes / 60).toFixed(1) + ' 小时</div></div>' +
        '<div class="stat-card card"><span class="stat-label">LINES MASTERED</span><div class="stat-value">' + mastered + '<small> 句</small></div><div class="stat-foot">收藏 ' + state.vocab.length + ' 个生词</div></div>' +
      '</div>' +

      '<section class="card heat-card">' +
        '<div class="heat-head"><div><span class="eyebrow">LAST 28 DAYS</span><h3>节奏，比强度更重要</h3></div><div class="heat-legend"><span>少</span><i></i><i></i><i></i><i></i><span>多</span></div></div>' +
        '<div class="heat-grid">' + heatmapHTML() + '</div>' +
        '<div class="heat-labels"><span>' + dateCn(addDays(todayStr(), -27)) + '</span><span>今天 · ' + dateCn(todayStr()) + '</span></div>' +
      '</section>' +

      '<div class="progress-two">' +
        '<section class="card settings-card">' +
          '<span class="eyebrow">RECENT SESSIONS</span><h3>最近的学习</h3><p>完成的、进行中的，都算数。</p>' +
          '<div class="record-list">' + (records.length ? records.map((date) => {
            const rec = state.history[date];
            const ep = getEpisode(rec.episodeId) || episodeForToday();
            return '<div class="record-row">' +
              '<span class="record-date">' + date.slice(5).replace('-', '/') + '</span>' +
              '<div class="record-main"><strong>' + escapeHTML(ep ? ep.zhTitle : '听力训练') + '</strong><span>' + (rec.tasks.length) + '/5 步 · ' + rec.minutes + ' 分钟</span></div>' +
              '<span class="record-badge" title="' + (rec.completed ? '已完成' : '进行中') + '">' + icon(rec.completed ? 'check' : 'clock') + '</span>' +
            '</div>';
          }).join('') : '<div class="empty-state" style="padding:30px 10px"><strong>还没有记录</strong>从今天的 25 分钟开始。</div>') + '</div>' +
        '</section>' +
        '<section class="card settings-card">' +
          '<span class="eyebrow">BADGES</span><h3>小小的里程碑</h3><p>不为了徽章，只为了看见自己走过。</p>' +
          '<div class="badge-grid">' +
            badgeHTML('第一天', '开始第一次训练', days >= 1, 'spark') +
            badgeHTML('三天节奏', '连续学习 3 天', streak >= 3 || longestStreak() >= 3, 'repeat') +
            badgeHTML('一周不中断', '连续学习 7 天', streak >= 7 || longestStreak() >= 7, 'star') +
            badgeHTML('二十句', '掌握 20 个句子', mastered >= 20, 'check') +
            badgeHTML('五十句', '掌握 50 个句子', mastered >= 50, 'captions') +
            badgeHTML('满分测验', '一期测验全部答对', hasPerfectQuiz(), 'spark') +
          '</div>' +
          '<div class="divider" style="margin:18px 0 12px"></div>' +
          '<span class="eyebrow">SKILL MIX</span>' +
          '<div class="skill-list">' + TASKS.map((task) => {
            const count = taskCount(task.key);
            const pct = Math.min(100, Math.round((count / Math.max(1, days)) * 100));
            return '<div class="skill-row"><span>' + task.name + '</span><span class="skill-track"><i style="width:' + pct + '%"></i></span><b>' + count + '</b></div>';
          }).join('') + '</div>' +
        '</section>' +
      '</div>';
  }

  function heatmapHTML() {
    const today = todayStr();
    let html = '';
    for (let i = 27; i >= 0; i -= 1) {
      const date = addDays(today, -i);
      const rec = state.history[date];
      let level = 0;
      if (rec && rec.completed) level = 3;
      else if (rec && rec.tasks && rec.tasks.length >= 3) level = 2;
      else if (rec && rec.tasks && rec.tasks.length > 0) level = 1;
      html += '<span class="heat-cell l' + level + (i === 0 ? ' today' : '') + '" title="' + dateCn(date) + ' · ' + (rec ? rec.tasks.length + '/5 步' : '未开始') + '"></span>';
    }
    return html;
  }

  function badgeHTML(title, desc, on, iconName) {
    return '<div class="badge ' + (on ? 'on' : '') + '"><span class="badge-icon">' + icon(iconName) + '</span><span><strong>' + title + '</strong><span>' + desc + '</span></span></div>';
  }

  /* ============================== Settings ============================== */

  function settingsTemplate() {
    const s = state.settings;
    return '' +
      '<div class="page-head"><div><span class="eyebrow">PREFERENCES</span><h1>设置</h1><p>把节奏调成适合自己的。所有数据只保存在这台设备的浏览器里。</p></div></div>' +
      '<div class="settings-grid">' +
        '<div>' +
          '<section class="card settings-card" style="margin-bottom:18px">' +
            '<span class="eyebrow">DAILY RHYTHM</span><h3>每日节奏</h3><p>默认 25 分钟：盲听 3 + 精听 8 + 跟读 6 + 复述 5 + 复盘 3。</p>' +
            '<div class="set-row"><div class="set-copy"><strong>每日训练计划</strong><span>固定 25 分钟：盲听 3 + 精听 8 + 跟读 6 + 复述 5 + 复盘 3。</span></div><div class="set-control"><span class="chip green">25 分钟</span></div></div>' +
            '<div class="set-row"><div class="set-copy"><strong>提醒时间</strong><span>下载日历提醒，或配合每日 DSH 推送使用。</span></div><div class="set-control"><input class="input-time" id="set-reminder" type="time" value="' + escapeHTML(s.reminder) + '"></div></div>' +
            '<div class="reminder-box"><p><strong>每天 ' + escapeHTML(s.reminder) + '</strong>，给自己 25 分钟。把下面的日历文件导入系统日历，手机会在每天同一时间提醒你。</p><button class="btn btn-soft btn-sm" data-action="download-ics">' + icon('download') + '下载每日提醒 (.ics)</button></div>' +
          '</section>' +

          '<section class="card settings-card" style="margin-bottom:18px">' +
            '<span class="eyebrow">READING</span><h3>字幕与阅读</h3><p>默认打开双语；精听时可以随时切成纯英文。</p>' +
            '<div class="set-row"><div class="set-copy"><strong>默认字幕</strong><span>进入新的一期时使用。</span></div><div class="set-control"><select class="select" id="set-subtitle">' +
              [['both', '中英双语'], ['en', '仅英文'], ['zh', '仅中文'], ['none', '无字幕']].map((pair) => '<option value="' + pair[0] + '" ' + (s.defaultSubtitle === pair[0] ? 'selected' : '') + '>' + pair[1] + '</option>').join('') +
            '</select></div></div>' +
            '<div class="set-row"><div class="set-copy"><strong>逐句自动滚动</strong><span>播放时让当前句保持在视野中间。</span></div><div class="set-control"><label class="switch"><input id="set-autoscroll" type="checkbox" ' + (s.autoScroll ? 'checked' : '') + '><span></span></label></div></div>' +
            '<div class="set-row"><div class="set-copy"><strong>逐句稿字号</strong><span>英文 ' + s.fontSize + ' px，中文 ' + (s.fontSize - 2) + ' px。</span></div><div class="set-control range-row"><input id="set-font" type="range" min="12" max="19" step="0.5" value="' + s.fontSize + '"><b>' + s.fontSize + '</b></div></div>' +
            '<div class="set-row"><div class="set-copy"><strong>单词发音口音</strong><span>点击词汇卡“发音”时使用。</span></div><div class="set-control"><select class="select" id="set-accent">' +
              [['en-US', '美音 US'], ['en-GB', '英音 UK']].map((pair) => '<option value="' + pair[0] + '" ' + (s.accent === pair[0] ? 'selected' : '') + '>' + pair[1] + '</option>').join('') +
            '</select></div></div>' +
          '</section>' +

          '<section class="card settings-card">' +
            '<span class="eyebrow">DATA</span><h3>数据与导出</h3><p>打卡、笔记、生词和测验记录都保存在 localStorage，不会上传到任何服务器。</p>' +
            '<div class="data-actions">' +
              '<button class="btn btn-soft btn-sm" data-action="export-data">' + icon('download') + '导出 JSON</button>' +
              '<button class="btn btn-soft btn-sm" data-action="import-data">' + icon('arrow') + '导入备份</button>' +
              '<button class="btn btn-ghost btn-sm danger" data-action="reset-data">清空学习数据</button>' +
              '<input type="file" id="import-file" accept="application/json,.json" hidden>' +
            '</div>' +
          '</section>' +
        '</div>' +

        '<div>' +
          '<div class="about-box" style="margin-bottom:18px">' +
            '<span class="eyebrow" style="color:rgba(248,241,227,.45)">ABOUT</span>' +
            '<h4>EchoDaily 回声英语</h4>' +
            '<p>为“每天听懂一点真实世界”而做的小工具。内容选自 CNN 10 的每日新闻节目，配以人工整理的双语逐句稿、词汇和理解题。</p>' +
            '<p style="margin-top:10px">视频与音频版权归 CNN 所有，本应用仅作个人听力学习索引，不存储媒体文件。请勿用于商业分发。</p>' +
          '</div>' +
          '<section class="card settings-card">' +
            '<span class="eyebrow">SOURCES</span><h3>内容来源</h3><p>想听更多，可以直接访问这些公开来源。</p>' +
            '<div class="week-list">' +
              '<a class="week-row on" href="https://edition.cnn.com/audio/podcasts/cnn-10" target="_blank" rel="noopener"><i></i><span>CNN 10</span><b>每日新闻 ' + icon('external') + '</b></a>' +
              '<a class="week-row on" href="https://www.npr.org/podcasts/510325/the-indicator-from-planet-money" target="_blank" rel="noopener"><i></i><span>NPR</span><b>The Indicator ' + icon('external') + '</b></a>' +
              '<a class="week-row on" href="https://www.ted.com/talks" target="_blank" rel="noopener"><i></i><span>TED</span><b>Talks ' + icon('external') + '</b></a>' +
              '<a class="week-row on" href="https://www.nasa.gov/feed/" target="_blank" rel="noopener"><i></i><span>NASA</span><b>News ' + icon('external') + '</b></a>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportData() {
    const payload = JSON.stringify({
      app: 'EchoDaily',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: state
    }, null, 2);
    downloadBlob(payload, 'echodaily-backup-' + todayStr() + '.json', 'application/json');
    toast('学习数据已导出', 'success');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const incoming = parsed.state || parsed;
        if (!incoming || typeof incoming !== 'object' || !incoming.settings) throw new Error('bad format');
        state = Object.assign(defaultState(), incoming, {
          settings: Object.assign(defaultState().settings, incoming.settings || {}),
          history: incoming.history || {},
          progress: incoming.progress || {},
          vocab: Array.isArray(incoming.vocab) ? incoming.vocab : []
        });
        saveState();
        toast('数据已导入，正在刷新…', 'success');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        toast('这个文件看起来不是 EchoDaily 备份', 'error');
      }
    };
    reader.readAsText(file);
  }

  function icsEscape(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function icsStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function downloadICS() {
    const parts = (state.settings.reminder || '07:30').split(':').map(Number);
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(parts[0] || 7, parts[1] || 30, 0, 0);
    const end = new Date(start.getTime() + 25 * 60000);
    const uid = 'echodaily-' + Date.now() + '@local';
    const stamp = icsStamp(new Date());
    const appUrl = location.origin && location.origin !== 'null' ? location.origin + '/' : 'http://127.0.0.1:8765/';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EchoDaily//Daily Listening//ZH-CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stamp,
      'DTSTART:' + icsStamp(start),
      'DTEND:' + icsStamp(end),
      'RRULE:FREQ=DAILY;COUNT=30',
      'SUMMARY:' + icsEscape('EchoDaily · 25 分钟英语听力'),
      'DESCRIPTION:' + icsEscape('打开 EchoDaily 完成今天的国际新闻精听：盲听 → 精听 → 跟读 → 复述 → 复盘。\n' + appUrl),
      'LOCATION:' + icsEscape(appUrl),
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape('10 分钟后开始今天的英语听力'),
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    downloadBlob(lines.join('\r\n'), 'EchoDaily-每日提醒.ics', 'text/calendar;charset=utf-8');
    toast('日历提醒已下载，导入系统日历即可', 'success');
  }

  function resetData() {
    openModal(
      '<span class="eyebrow">RESET</span><h3>清空学习数据？</h3>' +
      '<p>打卡记录、逐句掌握标记、笔记、生词和测验答案都会被删除。这个操作不能撤销。建议先导出备份。</p>' +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="confirm-reset">确认清空</button></div>'
    );
  }

  /* ============================== Focus mode ============================== */

  function requestFocus() {
    if (ui.view !== 'today' || !$('#player-shell')) {
      location.hash = '#today';
      setTimeout(() => { if ($('#player-shell')) openFocus(); }, 140);
      return;
    }
    openFocus();
  }

  function openFocus() {
    if (!currentEpisode || !media) return;
    closeModal();
    closeFocus(true);
    const rec = getDayRecord(todayStr());
    const firstOpen = TASKS.findIndex((t) => !rec.tasks.includes(t.key));
    ui.focusStep = firstOpen >= 0 ? firstOpen : 0;
    ui.focusRemaining = FOCUS_STEPS[ui.focusStep].minutes * 60;
    ui.focusRunning = true;
    ui.focusVisited = new Set();
    ui.focusNote = '';
    ui.focusAudioUrl = null;
    const layer = $('#focus-layer');
    if (layer) layer.hidden = false;
    document.body.style.overflow = 'hidden';
    applyFocusMode();
    renderFocus();
    startFocusTimer();
  }

  function closeFocus(silent) {
    clearInterval(ui.focusTimer);
    ui.focusTimer = null;
    ui.focusRunning = false;
    stopRecording(true);
    const layer = $('#focus-layer');
    if (layer) layer.hidden = true;
    document.body.style.overflow = '';
    if (!silent && media) media.pause();
  }

  function startFocusTimer() {
    clearInterval(ui.focusTimer);
    ui.focusTimer = setInterval(() => {
      if (!ui.focusRunning) return;
      if (ui.focusRemaining > 0) {
        ui.focusRemaining -= 1;
        updateFocusClocks();
        if (ui.focusRemaining === 0) {
          ui.focusRunning = false;
          updateFocusClocks();
          toast('这一步的时间到了，准备好就进入下一步');
        }
      }
    }, 1000);
  }

  function focusTotalRemaining() {
    let total = ui.focusRemaining;
    for (let i = ui.focusStep + 1; i < FOCUS_STEPS.length; i += 1) total += FOCUS_STEPS[i].minutes * 60;
    return total;
  }

  function updateFocusClocks() {
    const step = FOCUS_STEPS[ui.focusStep];
    const totalForStep = step.minutes * 60;
    const time = $('#focus-time');
    if (time) time.textContent = formatTime(ui.focusRemaining);
    const total = $('#focus-total-time');
    if (total) total.textContent = formatTime(focusTotalRemaining());
    const bar = $('#focus-progress-bar');
    if (bar) {
      const frac = 1 - (ui.focusRemaining / totalForStep);
      const overall = ((ui.focusStep + frac) / FOCUS_STEPS.length) * 100;
      bar.style.width = Math.min(100, Math.max(0, overall)) + '%';
    }
    const toggle = $('#focus-toggle-timer');
    if (toggle) toggle.innerHTML = icon(ui.focusRunning ? 'pause' : 'play') + (ui.focusRunning ? '暂停计时' : '继续计时');
  }

  function applyFocusMode() {
    const step = FOCUS_STEPS[ui.focusStep];
    if (!currentEpisode || !media) return;
    if (step.key === 'blind') {
      setSubtitleMode('none', false);
      seekTo(currentEpisode.clipStart, true);
      media.playbackRate = 1;
    } else if (step.key === 'intensive') {
      setSubtitleMode('both', false);
      if (media.paused) seekTo(currentEpisode.clipStart, true);
      media.playbackRate = 1;
    } else if (step.key === 'shadow') {
      setSubtitleMode('en', false);
      media.playbackRate = 0.8;
      const seg = currentEpisode.segments[activeIndex >= 0 ? activeIndex : 0];
      seekTo(seg.start, true);
    } else if (step.key === 'retell') {
      setSubtitleMode('none', false);
      media.pause();
    } else {
      setSubtitleMode('both', false);
      media.pause();
    }
  }

  function renderFocus() {
    const step = FOCUS_STEPS[ui.focusStep];
    if (!step || !currentEpisode) return;
    const stepsWrap = $('#focus-steps');
    if (stepsWrap) {
      stepsWrap.innerHTML = FOCUS_STEPS.map((s, i) => {
        const done = i < ui.focusStep || ui.focusVisited.has(s.key);
        return '<div class="focus-step ' + (i === ui.focusStep ? 'active' : '') + ' ' + (done ? 'done' : '') + '">' +
          '<span class="n">' + (done ? '✓' : pad(i + 1)) + '</span>' +
          '<span><b>' + s.label + '</b><span>' + s.minutes + ' 分钟</span></span>' +
          '<span class="dur">' + pad(i + 1) + '</span>' +
        '</div>';
      }).join('');
    }
    const main = $('#focus-main');
    if (main) {
      main.className = 'focus-main sub-' + ui.subtitleMode;
      main.innerHTML = focusMainHTML(step);
    }
    const next = $('[data-action="focus-next"]');
    if (next) next.innerHTML = (ui.focusStep === FOCUS_STEPS.length - 1 ? '完成训练 ' : '完成本步 ') + icon('arrow');
    const hint = $('#focus-hint');
    if (hint) hint.textContent = step.hint;
    updateFocusClocks();
  }

  function focusSentence() {
    if (!currentEpisode || !currentEpisode.segments.length) return { en: '', zh: '' };
    const cues = buildSentenceCues(currentEpisode);
    if (activeCueIndex >= 0 && cues[activeCueIndex]) return cues[activeCueIndex];
    if (activeIndex >= 0) {
      const first = cues.find((cue) => cue.segIndex === activeIndex);
      if (first) return first;
    }
    return cues[0] || currentEpisode.segments[0];
  }

  function renderFocusSentence() {
    const wrap = $('#focus-sentence');
    if (!wrap || !currentEpisode) return;
    const seg = focusSentence();
    wrap.innerHTML = '<p class="focus-sentence-en">' + escapeHTML(seg.en) + '</p><p class="focus-sentence-zh">' + escapeHTML(seg.zh) + '</p>';
  }

  function focusMainHTML(step) {
    let panel = '';
    if (step.key === 'blind') {
      panel = '<div class="focus-panel">' +
        '<span class="eyebrow">LISTEN FOR</span>' +
        '<ul class="focus-prompts"><li>谁在说话？这条新闻发生在哪里？</li><li>发生了什么？先抓动词和数字。</li><li>为什么值得关注？</li></ul>' +
        '<textarea class="focus-textarea" id="focus-note" placeholder="写下你听到的 3 个关键词…">' + escapeHTML(ui.focusNote) + '</textarea>' +
      '</div>';
    } else if (step.key === 'intensive') {
      const seg = focusSentence();
      panel = '<div class="focus-panel">' +
        '<span class="eyebrow">CURRENT LINE</span>' +
        '<div id="focus-sentence"><p class="focus-sentence-en">' + escapeHTML(seg.en) + '</p><p class="focus-sentence-zh">' + escapeHTML(seg.zh) + '</p></div>' +
        '<div class="focus-recorder"><button class="mini-btn" data-action="focus-replay">' + icon('repeat') + '重播本句</button><button class="mini-btn" data-action="focus-next-line">' + icon('arrow') + '下一句</button></div>' +
      '</div>';
    } else if (step.key === 'shadow') {
      const seg = focusSentence();
      panel = '<div class="focus-panel">' +
        '<span class="eyebrow">SHADOW THIS LINE</span>' +
        '<p class="focus-sentence-en">' + escapeHTML(seg.en) + '</p>' +
        '<div class="focus-recorder">' +
          '<button class="btn btn-soft btn-sm" data-action="record-start" id="record-btn">' + icon('mic') + '开始录音</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="record-stop">' + icon('stop') + '停止</button>' +
          (ui.recording ? '<span class="recording-note"><span class="record-dot"></span>录音中…</span>' : '') +
        '</div>' +
        (ui.focusAudioUrl ? '<audio id="focus-audio" controls src="' + ui.focusAudioUrl + '"></audio>' : '') +
        '<p class="recording-note">录音只保存在本机内存，关闭训练就消失。</p>' +
      '</div>';
    } else if (step.key === 'retell') {
      panel = '<div class="focus-panel">' +
        '<span class="eyebrow">TELL IT IN 3 SENTENCES</span>' +
        '<ul class="focus-prompts"><li>What happened?</li><li>Who is involved?</li><li>Why does it matter?</li></ul>' +
        '<textarea class="focus-textarea" id="focus-note" placeholder="先用中文搭框架，再试着用英文说一遍…">' + escapeHTML(ui.focusNote) + '</textarea>' +
        '<div class="focus-recorder"><button class="btn btn-soft btn-sm" data-action="record-start">' + icon('mic') + '录下复述</button><button class="btn btn-ghost btn-sm" data-action="record-stop">' + icon('stop') + '停止</button>' + (ui.recording ? '<span class="recording-note"><span class="record-dot"></span>录音中…</span>' : '') + '</div>' +
        (ui.focusAudioUrl ? '<audio controls src="' + ui.focusAudioUrl + '"></audio>' : '') +
      '</div>';
    } else {
      panel = '<div class="focus-panel">' +
        '<span class="eyebrow">TODAY\'S WORDS</span>' +
        '<div class="vocab-chips">' + currentEpisode.vocab.slice(0, 6).map((v) => '<button class="mini-btn" data-action="speak-word" data-word="' + escapeHTML(v.word) + '">' + escapeHTML(v.word) + ' · ' + escapeHTML(v.zh) + '</button>').join('') + '</div>' +
        '<div class="focus-recorder"><button class="btn btn-soft btn-sm" data-action="go-quiz">' + icon('check') + '去做 3 道理解题</button><span class="recording-note">错题会保留在本机，方便回看。</span></div>' +
      '</div>';
    }
    return '<span class="focus-kicker">STEP ' + pad(ui.focusStep + 1) + ' · ' + step.label.toUpperCase() + '</span>' +
      '<h3>' + step.title + '</h3>' +
      '<p class="focus-desc">' + step.desc + '</p>' +
      '<div class="focus-timer-wrap">' +
        '<div class="focus-timer"><span id="focus-time">' + formatTime(ui.focusRemaining) + '</span><small>本步剩余</small></div>' +
        '<div class="focus-timer-actions">' +
          '<button class="btn btn-ghost btn-sm" id="focus-toggle-timer" data-action="focus-toggle-timer">' + icon(ui.focusRunning ? 'pause' : 'play') + (ui.focusRunning ? '暂停计时' : '继续计时') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="focus-replay">' + icon('repeat') + '重播片段</button>' +
        '</div>' +
      '</div>' +
      panel;
  }

  function focusNext() {
    const step = FOCUS_STEPS[ui.focusStep];
    if (step) {
      ui.focusVisited.add(step.key);
      markTask(step.key, true, true);
    }
    if (ui.focusStep >= FOCUS_STEPS.length - 1) {
      finishFocus();
      return;
    }
    ui.focusStep += 1;
    ui.focusRemaining = FOCUS_STEPS[ui.focusStep].minutes * 60;
    ui.focusRunning = true;
    applyFocusMode();
    renderFocus();
    startFocusTimer();
  }

  function focusPrev() {
    if (ui.focusStep <= 0) return;
    ui.focusStep -= 1;
    ui.focusRemaining = FOCUS_STEPS[ui.focusStep].minutes * 60;
    ui.focusRunning = true;
    applyFocusMode();
    renderFocus();
    startFocusTimer();
  }

  function finishFocus() {
    const today = todayStr();
    const rec = state.history[today] || { tasks: [], completed: false, minutes: 0, episodeId: currentEpisode ? currentEpisode.id : null };
    const wasComplete = !!rec.completed;
    rec.tasks = TASKS.map((t) => t.key);
    rec.episodeId = currentEpisode ? currentEpisode.id : rec.episodeId;
    rec.completed = true;
    rec.minutes = 25;
    rec.updatedAt = Date.now();
    state.history[today] = rec;
    saveState();
    updateTaskUI();
    closeFocus(true);
    toast('今天的 25 分钟完成了。明天见。', 'success');
    if (!wasComplete) launchConfetti();
  }

  /* ============================== Recording ============================== */

  async function startRecording() {
    if (ui.recording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('当前浏览器不支持录音，可以直接跟读', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (ui.focusAudioUrl) URL.revokeObjectURL(ui.focusAudioUrl);
        ui.focusAudioUrl = URL.createObjectURL(blob);
        ui.recording = null;
        clearTimeout(ui.recordingTimer);
        renderFocus();
        toast('录音完成，点播放回听', 'success');
      };
      ui.recording = { recorder, stream, chunks };
      recorder.start();
      renderFocus();
      toast('开始录音，说完点“停止”');
      clearTimeout(ui.recordingTimer);
      ui.recordingTimer = setTimeout(() => stopRecording(), 90000);
    } catch (err) {
      toast('无法访问麦克风，请检查浏览器权限', 'error');
    }
  }

  function stopRecording(silent) {
    clearTimeout(ui.recordingTimer);
    if (!ui.recording) return;
    try { ui.recording.recorder.stop(); } catch (err) { /* ignore */ }
    if (silent) {
      ui.recording = null;
    }
  }

  /* ============================== Modal / toast ============================== */

  function openModal(html) {
    const layer = $('#modal-layer');
    const card = $('#modal-card');
    if (!layer || !card) return;
    card.innerHTML = html;
    layer.hidden = false;
  }

  function closeModal() {
    const layer = $('#modal-layer');
    if (layer) layer.hidden = true;
  }

  function toast(message, type) {
    const region = $('#toast-region');
    if (!region) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = icon(type === 'success' ? 'check' : (type === 'error' ? 'close' : 'spark')) + '<span>' + escapeHTML(message) + '</span>';
    region.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'all .25s';
      setTimeout(() => el.remove(), 280);
    }, 3200);
  }

  /* ============================== Events ============================== */

  function onClick(event) {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      const sidebar = $('.sidebar');
      if (sidebar) sidebar.classList.remove('open');
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      if (event.target.id === 'modal-layer') closeModal();
      return;
    }
    const action = actionEl.dataset.action;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'start-focus') requestFocus();
    else if (action === 'play-episode') {
      const ws = $('#workspace');
      if (ws) ws.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(playEpisodeFromStart, 260);
    } else if (action === 'toggle-play') togglePlay();
    else if (action === 'seek-back') seekBy(-5);
    else if (action === 'seek-fwd') seekBy(5);
    else if (action === 'toggle-loop') {
      ui.loopSegment = !ui.loopSegment;
      const btn = $('[data-action="toggle-loop"]');
      if (btn) btn.classList.toggle('on', ui.loopSegment);
      toast(ui.loopSegment ? '循环当前句已开启' : '循环当前句已关闭');
    } else if (action === 'cycle-speed') cycleSpeed();
    else if (action === 'cycle-subtitle') cycleSubtitle();
    else if (action === 'fullscreen') requestFullscreen();
    else if (action === 'toggle-full') toggleFullMode();
    else if (action === 'replay') {
      if (activeCueIndex >= 0) playCue(activeCueIndex);
      else playEpisodeFromStart();
    } else if (action === 'set-subtitle') setSubtitleMode(actionEl.dataset.mode);
    else if (action === 'set-media') setMediaMode(actionEl.dataset.mode);
    else if (action === 'set-tab') {
      ui.tab = actionEl.dataset.tab || 'lines';
      renderTab();
    } else if (action === 'toggle-task') toggleTask(actionEl.dataset.task);
    else if (action === 'seek-line') playSegment(Number(actionEl.dataset.index));
    else if (action === 'seek-time') {
      seekTo(Number(actionEl.dataset.time), true);
      const idx = currentEpisode ? currentEpisode.segments.findIndex((s) => Number(actionEl.dataset.time) >= s.start && Number(actionEl.dataset.time) < s.end) : -1;
      if (idx >= 0) setActiveLine(idx, true);
    }
    else if (action === 'star-segment') toggleMastered(actionEl.dataset.index);
    else if (action === 'toggle-autoscroll') {
      state.settings.autoScroll = !state.settings.autoScroll;
      saveState();
      toast(state.settings.autoScroll ? '已开启逐句自动滚动' : '已关闭逐句自动滚动');
    } else if (action === 'font-up' || action === 'font-down') {
      const delta = action === 'font-up' ? 0.5 : -0.5;
      state.settings.fontSize = Math.min(19, Math.max(12, Number(state.settings.fontSize) + delta));
      saveState();
      applyFontSize();
    } else if (action === 'quiz-answer') {
      answerQuiz(Number(actionEl.dataset.q), Number(actionEl.dataset.opt));
    } else if (action === 'speak-word') speak(actionEl.dataset.word);
    else if (action === 'star-word') toggleWord(actionEl.dataset.word);
    else if (action === 'filter-library') {
      ui.filter = actionEl.dataset.filter;
      $$('#filter-row .filter-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.filter === ui.filter));
      const grid = $('#library-grid');
      if (grid) grid.innerHTML = libraryGridHTML();
    } else if (action === 'open-search') {
      // Render the library synchronously inside the tap/click handler, then focus
      // the search box. iOS Safari blocks focus() from a later setTimeout, which
      // made the keyboard never appear on some phones.
      if (ui.view !== 'library') {
        try { history.pushState(null, '', '#library'); } catch (err) { /* file:// may not allow pushState */ }
        closeFocus(true);
        stopMedia();
        ui.view = 'library';
        ui.episodeId = null;
        ui.tab = 'lines';
        render();
        window.scrollTo(0, 0);
      }
      const input = $('#library-search');
      if (input) {
        input.focus();
        input.select();
      }
    } else if (action === 'export-data') exportData();
    else if (action === 'import-data') { const input = $('#import-file'); if (input) input.click(); }
    else if (action === 'reset-data') resetData();
    else if (action === 'confirm-reset') {
      localStorage.removeItem(STORAGE_KEY);
      state = defaultState();
      closeModal();
      location.hash = '#today';
      location.reload();
    } else if (action === 'download-ics') downloadICS();
    else if (action === 'close-modal') closeModal();
    else if (action === 'toggle-sidebar') {
      const sidebar = $('.sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    } else if (action === 'focus-prev') focusPrev();
    else if (action === 'focus-next') focusNext();
    else if (action === 'close-focus') closeFocus();
    else if (action === 'focus-toggle-timer') {
      ui.focusRunning = !ui.focusRunning;
      updateFocusClocks();
    } else if (action === 'focus-replay') {
      if (activeCueIndex >= 0) playCue(activeCueIndex);
      else playEpisodeFromStart();
    } else if (action === 'focus-next-line') {
      const cues = buildSentenceCues(currentEpisode);
      const current = activeCueIndex >= 0 ? activeCueIndex : 0;
      playCue(Math.min(cues.length - 1, current + 1));
    } else if (action === 'record-start') startRecording();
    else if (action === 'record-stop') stopRecording();
    else if (action === 'go-quiz') {
      closeFocus();
      ui.tab = 'quiz';
      renderTab();
      const ws = $('#workspace');
      if (ws) ws.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function onChange(event) {
    const id = event.target.id;
    if (id === 'set-goal') {
      state.settings.dailyGoal = Number(event.target.value) || 25;
      saveState();
      toast('每日目标已设为 ' + state.settings.dailyGoal + ' 分钟');
    } else if (id === 'set-reminder') {
      state.settings.reminder = event.target.value || '07:30';
      saveState();
      toast('提醒时间已保存：每天 ' + state.settings.reminder);
    } else if (id === 'set-subtitle') {
      state.settings.defaultSubtitle = event.target.value;
      setSubtitleMode(event.target.value, false);
      saveState();
      toast('默认字幕已更新');
    } else if (id === 'set-autoscroll') {
      state.settings.autoScroll = event.target.checked;
      saveState();
    } else if (id === 'set-accent') {
      state.settings.accent = event.target.value;
      saveState();
      toast('单词发音口音已更新');
    } else if (id === 'import-file') {
      importData(event.target.files && event.target.files[0]);
      event.target.value = '';
    }
  }

  function onInput(event) {
    const id = event.target.id;
    if (id === 'seek' && media && currentEpisode) {
      const duration = isFinite(media.duration) && media.duration > 0 ? media.duration : currentEpisode.fullDuration;
      const pct = Number(event.target.value) || 0;
      media.currentTime = (pct / 100) * duration;
      updateTimeUI(media.currentTime, duration);
    } else if (id === 'set-font') {
      state.settings.fontSize = Number(event.target.value) || 13;
      saveState();
      applyFontSize();
      const label = $('.range-row b');
      if (label) label.textContent = state.settings.fontSize;
      const copy = event.target.closest('.set-row') && event.target.closest('.set-row').querySelector('.set-copy span');
      if (copy) copy.textContent = '英文 ' + state.settings.fontSize + ' px，中文 ' + Math.max(10, state.settings.fontSize - 2) + ' px。';
    } else if (id === 'focus-note') {
      ui.focusNote = event.target.value;
    }
  }

  function onKey(event) {
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === 'Escape') {
      if (!$('#modal-layer').hidden) { closeModal(); return; }
      if (!$('#focus-layer').hidden) { closeFocus(); return; }
      const sidebar = $('.sidebar');
      if (sidebar) sidebar.classList.remove('open');
      return;
    }
    if (!$('#focus-layer').hidden) return;
    showControls();
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekBy(-5);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekBy(5);
    } else if (event.key.toLowerCase() === 'r') {
      if (activeIndex >= 0) playSegment(activeIndex);
    } else if (event.key.toLowerCase() === 'c') {
      cycleSubtitle();
    }
  }

  /* ============================== Init ============================== */

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    window.addEventListener('beforeunload', savePlayback);
    const menu = $('#mobile-menu');
    if (menu) menu.addEventListener('click', () => {
      const sidebar = $('.sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    });
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    route();
    window.__ECHO_READY__ = true;
    try {
      if (new URLSearchParams(location.search).get('focus') === '1') {
        setTimeout(() => { if ($('#player-shell')) openFocus(); }, 250);
      }
    } catch (err) { /* old browser */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();