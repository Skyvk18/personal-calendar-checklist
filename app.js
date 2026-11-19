(function () {
  const STORAGE_KEY = 'daybook_planner_v2';
  const THEME_KEY = 'daybook_theme_v1';

  const SWATCH_COLORS = [
    '#c84b31', // Terracotta
    '#2563eb', // Cobalt
    '#1f7a53', // Sage
    '#7c3aed', // Plum
    '#d97706', // Amber
    '#0d9488', // Teal
    '#e11d48', // Rose
    '#475569'  // Slate
  ];

  const todayISO = () => window.DaybookNLP.toISODate(new Date());

  function offsetISO(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return window.DaybookNLP.toISODate(d);
  }

  function createDefaultState() {
    return {
      calendars: [
        { id: 'personal', name: 'My Calendar', color: '#c84b31', visible: true }
      ],
      focusedCalendarId: null, // null = combined mode
      events: [],
      checklists: [],
      chatHistory: [
        {
          id: 'msg-welcome',
          role: 'assistant',
          text: 'Your calendar is a blank slate. Tell me what you have coming up—like "Today there is tennis practice at 5pm" or "Tomorrow at 3pm Dentist"—and I will add only the relevant event to your schedule.'
        }
      ]
    };
  }

  let state = loadState();
  let activeTab = 'today'; // 'today' | 'calendar'
  let calViewMode = 'month'; // 'month' | 'week'
  let calCursorDate = new Date();
  let selectedDayISO = null;
  let todayStatusFilter = 'all'; // 'all' | 'pending' | 'done'

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seed = createDefaultState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
        return seed;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.checklists)) parsed.checklists = [];
      return parsed;
    } catch {
      return createDefaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Theme
  const THEMES = ['light', 'dark', 'forest'];

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    const valid = THEMES.includes(saved) ? saved : 'light';
    document.documentElement.setAttribute('data-theme', valid);
    updateThemeButton(valid);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeButton(next);
  }

  function updateThemeButton(theme) {
    const lbl = document.getElementById('theme-label');
    if (!lbl) return;
    if (theme === 'dark') lbl.textContent = 'Midnight Red';
    else if (theme === 'forest') lbl.textContent = 'Red & Forest';
    else lbl.textContent = 'Crimson & Navy';
  }

  // Helpers
  function getCalendar(id) {
    return state.calendars.find(c => c.id === id) || state.calendars[0];
  }

  function getVisibleCalendarIds() {
    if (state.focusedCalendarId) {
      return new Set([state.focusedCalendarId]);
    }
    return new Set(state.calendars.filter(c => c.visible).map(c => c.id));
  }

  function getEventsForDate(dateISO, ignoreFilter = false) {
    const visibleIds = getVisibleCalendarIds();
    return state.events
      .filter(ev => ev.date === dateISO && (ignoreFilter || visibleIds.has(ev.calendarId)))
      .sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time && !b.time) return -1;
        if (!a.time && b.time) return 1;
        return a.title.localeCompare(b.title);
      });
  }

  function formatLongDate(dateISO) {
    const [y, m, d] = dateISO.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Navigation
  window.switchView = function (viewName) {
    activeTab = viewName;
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.querySelectorAll('.view-panel').forEach(p => {
      p.classList.toggle('active', p.id === `view-${viewName}`);
    });
    closeMobileMenus();
    render();
  };

  window.toggleMobileSidebar = function () {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  };

  window.toggleMobileChat = function () {
    document.getElementById('chat-panel').classList.toggle('mobile-open');
  };

  function closeMobileMenus() {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }

  // Sidebar & Calendar Management
  function renderSidebar() {
    const now = new Date();
    document.getElementById('brand-day-num').textContent = now.getDate();

    const todayEvents = getEventsForDate(todayISO());
    const remainingToday = todayEvents.filter(e => !e.completed).length;
    const badge = document.getElementById('today-nav-badge');
    badge.textContent = remainingToday;
    badge.style.display = remainingToday > 0 ? 'inline-block' : 'none';

    const openChecklistItems = (state.checklists || []).reduce(
      (sum, cl) => sum + cl.items.filter(i => !i.completed).length,
      0
    );
    const clBadge = document.getElementById('checklists-nav-badge');
    if (clBadge) {
      clBadge.textContent = openChecklistItems;
      clBadge.style.display = openChecklistItems > 0 ? 'inline-block' : 'none';
    }

    const combinedBtn = document.getElementById('btn-mode-combined');
    combinedBtn.classList.toggle('active', state.focusedCalendarId === null);

    const listEl = document.getElementById('calendar-list');
    listEl.innerHTML = '';

    state.calendars.forEach(cal => {
      const count = state.events.filter(e => e.calendarId === cal.id && !e.completed).length;
      const isFocused = state.focusedCalendarId === cal.id;

      const row = document.createElement('div');
      row.className = `cal-list-item ${isFocused ? 'focused' : ''}`;

      row.innerHTML = `
        <div class="cal-list-left" onclick="focusCalendar('${cal.id}')">
          <button type="button" class="cal-check"
            style="color:${cal.color}; background:${cal.visible ? cal.color : 'transparent'}"
            onclick="event.stopPropagation(); toggleCalendarVisibility('${cal.id}')"
            title="Toggle visibility in combined view">
            ${cal.visible ? '✓' : ''}
          </button>
          <span class="cal-name-text">${escapeHtml(cal.name)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.35rem;">
          <span class="cal-count">${count}</span>
          <div class="cal-actions">
            <button type="button" class="icon-btn-sm" title="Rename calendar" onclick="event.stopPropagation(); renameCalendar('${cal.id}')">✎</button>
            ${
              state.calendars.length > 1
                ? `<button type="button" class="icon-btn-sm" title="Delete calendar" onclick="event.stopPropagation(); deleteCalendar('${cal.id}')">×</button>`
                : ''
            }
          </div>
        </div>
      `;
      listEl.appendChild(row);
    });

    // Update calendar dropdowns in forms
    const selects = [
      document.getElementById('quick-cal-select'),
      document.getElementById('drawer-cal-select'),
      document.getElementById('edit-ev-cal')
    ];
    selects.forEach(sel => {
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = state.calendars
        .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join('');
      if (prev && state.calendars.some(c => c.id === prev)) {
        sel.value = prev;
      } else if (state.focusedCalendarId) {
        sel.value = state.focusedCalendarId;
      }
    });
  }

  window.setCombinedMode = function () {
    state.focusedCalendarId = null;
    state.calendars.forEach(c => (c.visible = true));
    saveState();
    render();
  };

  window.focusCalendar = function (calId) {
    state.focusedCalendarId = state.focusedCalendarId === calId ? null : calId;
    saveState();
    render();
  };

  window.toggleCalendarVisibility = function (calId) {
    state.focusedCalendarId = null;
    const cal = getCalendar(calId);
    if (cal) cal.visible = !cal.visible;
    saveState();
    render();
  };

  window.renameCalendar = function (calId) {
    const cal = getCalendar(calId);
    if (!cal) return;
    const nextName = prompt('Rename calendar:', cal.name);
    if (nextName && nextName.trim()) {
      cal.name = nextName.trim();
      saveState();
      render();
    }
  };

  window.deleteCalendar = function (calId) {
    if (state.calendars.length <= 1) return;
    state.calendars = state.calendars.filter(c => c.id !== calId);
    state.events = state.events.filter(e => e.calendarId !== calId);
    if (state.focusedCalendarId === calId) state.focusedCalendarId = null;
    saveState();
    render();
  };

  // New Calendar Modal
  let chosenSwatch = SWATCH_COLORS[0];

  window.openNewCalendarModal = function () {
    chosenSwatch = SWATCH_COLORS[Math.floor(Math.random() * SWATCH_COLORS.length)];
    document.getElementById('new-cal-name').value = '';
    renderSwatches();
    document.getElementById('new-cal-modal').classList.add('open');
    setTimeout(() => document.getElementById('new-cal-name').focus(), 50);
  };

  window.closeNewCalendarModal = function () {
    document.getElementById('new-cal-modal').classList.remove('open');
  };

  function renderSwatches() {
    const container = document.getElementById('cal-swatches');
    container.innerHTML = SWATCH_COLORS.map(
      hex => `<button type="button" class="swatch ${hex === chosenSwatch ? 'selected' : ''}" style="background:${hex}" onclick="selectSwatch('${hex}')"></button>`
    ).join('');
  }

  window.selectSwatch = function (hex) {
    chosenSwatch = hex;
    renderSwatches();
  };

  window.handleCreateCalendar = function (e) {
    e.preventDefault();
    const name = document.getElementById('new-cal-name').value.trim();
    if (!name) return;
    const id = 'cal-' + Date.now();
    state.calendars.push({ id, name, color: chosenSwatch, visible: true });
    saveState();
    closeNewCalendarModal();
    render();
  };

  // Today ("Lock In") View
  function renderTodayView() {
    const tISO = todayISO();
    const now = new Date();
    document.getElementById('today-date-heading').textContent = formatLongDate(tISO);
    document.getElementById('today-eyebrow').textContent =
      state.focusedCalendarId
        ? `LOCK IN • ${getCalendar(state.focusedCalendarId).name.toUpperCase()}`
        : 'LOCK IN • ALL CALENDARS';

    const allToday = getEventsForDate(tISO);
    const doneCount = allToday.filter(e => e.completed).length;
    const totalCount = allToday.length;
    const pct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

    document.getElementById('today-progress-text').textContent = `${doneCount} of ${totalCount} done`;
    document.getElementById('today-progress-pct').textContent = `${pct}%`;
    document.getElementById('today-progress-fill').style.width = `${pct}%`;

    // Filter pills
    const calPills = document.getElementById('today-cal-pills');
    calPills.innerHTML = `
      <button type="button" class="pill ${state.focusedCalendarId === null ? 'active' : ''}" onclick="setCombinedMode()">
        All Calendars
      </button>
      ${state.calendars
        .map(
          c => `<button type="button" class="pill ${state.focusedCalendarId === c.id ? 'active' : ''}" onclick="focusCalendar('${c.id}')">
            <span class="dot" style="background:${c.color}"></span>
            ${escapeHtml(c.name)}
          </button>`
        )
        .join('')}
    `;

    let filtered = allToday;
    if (todayStatusFilter === 'pending') filtered = allToday.filter(e => !e.completed);
    if (todayStatusFilter === 'done') filtered = allToday.filter(e => e.completed);

    const timed = filtered.filter(e => Boolean(e.time));
    const anytime = filtered.filter(e => !e.time);

    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const nextTimed = timed.find(e => !e.completed && e.time >= nowHHMM);

    const timedContainer = document.getElementById('today-timed-list');
    const anytimeContainer = document.getElementById('today-anytime-list');

    if (timed.length === 0 && anytime.length === 0) {
      timedContainer.innerHTML = `
        <div class="empty-state">
          <strong>Nothing scheduled for today yet.</strong>
          <p>Add a task above, click a day in the Calendar, or tell the chat assistant what you need to do.</p>
        </div>`;
      anytimeContainer.innerHTML = '';
      document.getElementById('anytime-section').style.display = 'none';
      return;
    }

    timedContainer.innerHTML = timed.length
      ? timed.map(ev => renderAgendaCard(ev, nextTimed && nextTimed.id === ev.id)).join('')
      : `<div class="empty-state" style="padding:1.25rem;"><strong>No timed events</strong><p>Use the quick bar above or chat to schedule a specific time.</p></div>`;

    const anytimeSec = document.getElementById('anytime-section');
    if (anytime.length > 0) {
      anytimeSec.style.display = 'block';
      anytimeContainer.innerHTML = anytime.map(ev => renderAgendaCard(ev, false)).join('');
    } else {
      anytimeSec.style.display = 'none';
    }
  }

  function renderAgendaCard(ev, isNext) {
    const cal = getCalendar(ev.calendarId);
    const timeLabel = ev.time ? window.DaybookNLP.formatDisplayTime(ev.time) : 'Any time';

    return `
      <div class="agenda-card ${ev.completed ? 'completed' : ''} ${isNext ? 'is-next' : ''}" style="--cal-color:${cal.color}">
        <div class="agenda-left">
          <button type="button" class="task-checkbox" onclick="toggleEventComplete('${ev.id}')" aria-label="Toggle complete">
            ${ev.completed ? '✓' : ''}
          </button>
          <span class="time-badge">${timeLabel}</span>
          <div class="agenda-info">
            <div class="agenda-title">${escapeHtml(ev.title)}</div>
            <div class="agenda-meta">
              <span class="cal-tag"><span class="dot" style="background:${cal.color}"></span>${escapeHtml(cal.name)}</span>
              ${isNext ? '<span class="up-next-tag">Up Next</span>' : ''}
              ${ev.notes ? `<span>• ${escapeHtml(ev.notes)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="agenda-actions">
          <button type="button" class="icon-btn-sm" title="Edit" onclick="openEditEventModal('${ev.id}')">✎</button>
          <button type="button" class="icon-btn-sm" title="Delete" onclick="deleteEvent('${ev.id}')">×</button>
        </div>
      </div>
    `;
  }

  window.setTodayStatusFilter = function (mode, btn) {
    todayStatusFilter = mode;
    document.querySelectorAll('.status-filter-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderTodayView();
  };

  window.handleTodayQuickAdd = function (e) {
    e.preventDefault();
    const titleEl = document.getElementById('quick-title');
    const timeEl = document.getElementById('quick-time');
    const calEl = document.getElementById('quick-cal-select');
    const title = titleEl.value.trim();
    if (!title) return;

    state.events.push({
      id: 'ev-' + Date.now(),
      title,
      date: todayISO(),
      time: timeEl.value || '',
      calendarId: calEl.value || state.calendars[0].id,
      notes: '',
      completed: false
    });
    saveState();
    titleEl.value = '';
    timeEl.value = '';
    render();
  };

  window.toggleEventComplete = function (evId) {
    const ev = state.events.find(x => x.id === evId);
    if (ev) {
      ev.completed = !ev.completed;
      saveState();
      render();
      if (selectedDayISO) renderDayDrawer();
    }
  };

  window.deleteEvent = function (evId) {
    state.events = state.events.filter(x => x.id !== evId);
    saveState();
    render();
    if (selectedDayISO) renderDayDrawer();
  };

  // Calendar View (Month & Week)
  window.setCalViewMode = function (mode) {
    calViewMode = mode;
    document.getElementById('btn-cal-month').classList.toggle('active', mode === 'month');
    document.getElementById('btn-cal-week').classList.toggle('active', mode === 'week');
    renderCalendarView();
  };

  window.stepCalendar = function (delta) {
    if (calViewMode === 'month') {
      calCursorDate.setMonth(calCursorDate.getMonth() + delta);
    } else {
      calCursorDate.setDate(calCursorDate.getDate() + delta * 7);
    }
    renderCalendarView();
  };

  window.jumpCalendarToday = function () {
    calCursorDate = new Date();
    renderCalendarView();
  };

  function renderCalendarView() {
    const year = calCursorDate.getFullYear();
    const month = calCursorDate.getMonth();
    const heading = calCursorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('cal-heading').textContent = heading;

    const gridEl = document.getElementById('calendar-grid-container');
    const tISO = todayISO();

    if (calViewMode === 'month') {
      const firstDay = new Date(year, month, 1);
      const startOffset = firstDay.getDay();
      const startDate = new Date(year, month, 1 - startOffset);

      let cellsHtml = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dISO = window.DaybookNLP.toISODate(d);
        const isOther = d.getMonth() !== month;
        const isToday = dISO === tISO;
        const isSel = dISO === selectedDayISO;
        const dayEvents = getEventsForDate(dISO);

        const maxShow = 3;
        const chips = dayEvents.slice(0, maxShow).map(ev => {
          const cal = getCalendar(ev.calendarId);
          const shortTime = ev.time ? window.DaybookNLP.formatDisplayTime(ev.time).replace(':00 ', '').replace(' ', '').toLowerCase() : '';
          return `
            <div class="day-chip ${ev.completed ? 'completed' : ''}" style="--cal-color:${cal.color}">
              ${shortTime ? `<span class="day-chip-time">${shortTime}</span>` : ''}
              <span>${escapeHtml(ev.title)}</span>
            </div>
          `;
        }).join('');

        const moreHtml = dayEvents.length > maxShow ? `<div class="day-more">+${dayEvents.length - maxShow} more</div>` : '';

        cellsHtml += `
          <div class="day-cell ${isOther ? 'other-month' : ''} ${isToday ? 'is-today' : ''} ${isSel ? 'selected' : ''}"
               onclick="openDayDrawer('${dISO}')">
            <div class="day-num-row">
              <span class="day-num">${d.getDate()}</span>
            </div>
            ${chips}
            ${moreHtml}
          </div>
        `;
      }

      gridEl.innerHTML = `
        <div class="month-weekdays">
          <div class="weekday-cell">Sun</div><div class="weekday-cell">Mon</div>
          <div class="weekday-cell">Tue</div><div class="weekday-cell">Wed</div>
          <div class="weekday-cell">Thu</div><div class="weekday-cell">Fri</div>
          <div class="weekday-cell">Sat</div>
        </div>
        <div class="month-grid">${cellsHtml}</div>
      `;
    } else {
      // Week view
      const startOfWeek = new Date(calCursorDate);
      startOfWeek.setDate(calCursorDate.getDate() - calCursorDate.getDay());

      let colsHtml = '';
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const dISO = window.DaybookNLP.toISODate(d);
        const isToday = dISO === tISO;
        const dayEvents = getEventsForDate(dISO);
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

        const itemsHtml = dayEvents.length
          ? dayEvents.map(ev => {
              const cal = getCalendar(ev.calendarId);
              const tLabel = ev.time ? window.DaybookNLP.formatDisplayTime(ev.time) : 'Any time';
              return `
                <div class="day-chip ${ev.completed ? 'completed' : ''}" style="--cal-color:${cal.color}; flex-direction:column; align-items:flex-start; white-space:normal; padding:0.35rem 0.45rem;">
                  <span class="day-chip-time">${tLabel}</span>
                  <span style="font-weight:600;">${escapeHtml(ev.title)}</span>
                </div>
              `;
            }).join('')
          : `<span style="font-size:0.75rem; color:var(--text-muted); text-align:center; margin-top:1rem;">Free</span>`;

        colsHtml += `
          <div class="week-col">
            <div class="week-col-header ${isToday ? 'is-today' : ''}" onclick="openDayDrawer('${dISO}')">
              <div style="font-size:0.72rem; text-transform:uppercase; color:var(--text-muted); font-family:var(--font-mono);">${dayName}</div>
              <div style="font-size:1.15rem; font-weight:700; margin-top:0.1rem;">${d.getDate()}</div>
            </div>
            <div class="week-col-body" onclick="openDayDrawer('${dISO}')">
              ${itemsHtml}
            </div>
          </div>
        `;
      }
      gridEl.innerHTML = `<div class="week-grid">${colsHtml}</div>`;
    }
  }

  // Day Detail Drawer
  window.openDayDrawer = function (dateISO) {
    selectedDayISO = dateISO;
    renderCalendarView();
    renderDayDrawer();
    document.getElementById('day-drawer-backdrop').classList.add('open');
  };

  window.closeDayDrawer = function (e) {
    if (e && e.target !== document.getElementById('day-drawer-backdrop')) return;
    document.getElementById('day-drawer-backdrop').classList.remove('open');
    selectedDayISO = null;
    renderCalendarView();
  };

  function renderDayDrawer() {
    if (!selectedDayISO) return;
    document.getElementById('drawer-date-title').textContent = formatLongDate(selectedDayISO);

    const events = getEventsForDate(selectedDayISO);
    const listEl = document.getElementById('drawer-events-list');

    if (events.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:1.5rem;">
          <strong>Nothing scheduled for this day</strong>
          <p>Use the form below or chat to schedule something at a specific time.</p>
        </div>
      `;
    } else {
      listEl.innerHTML = events
        .map(ev => {
          const cal = getCalendar(ev.calendarId);
          const atText = ev.time ? `At ${window.DaybookNLP.formatDisplayTime(ev.time)}` : 'Any time';
          return `
            <div class="agenda-card ${ev.completed ? 'completed' : ''}" style="--cal-color:${cal.color}">
              <div class="agenda-left">
                <button type="button" class="task-checkbox" onclick="toggleEventComplete('${ev.id}')">
                  ${ev.completed ? '✓' : ''}
                </button>
                <div class="agenda-info">
                  <div style="font-family:var(--font-mono); font-size:0.74rem; color:var(--accent); font-weight:600;">${atText}</div>
                  <div class="agenda-title">${escapeHtml(ev.title)}</div>
                  <div class="agenda-meta">
                    <span class="cal-tag"><span class="dot" style="background:${cal.color}"></span>${escapeHtml(cal.name)}</span>
                    ${ev.notes ? `<span>• ${escapeHtml(ev.notes)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="agenda-actions">
                <button type="button" class="icon-btn-sm" title="Edit" onclick="openEditEventModal('${ev.id}')">✎</button>
                <button type="button" class="icon-btn-sm" title="Delete" onclick="deleteEvent('${ev.id}')">×</button>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  window.handleDrawerAdd = function (e) {
    e.preventDefault();
    if (!selectedDayISO) return;
    const title = document.getElementById('drawer-title').value.trim();
    const time = document.getElementById('drawer-time').value;
    const calId = document.getElementById('drawer-cal-select').value;
    const notes = document.getElementById('drawer-notes').value.trim();
    if (!title) return;

    state.events.push({
      id: 'ev-' + Date.now(),
      title,
      date: selectedDayISO,
      time: time || '',
      calendarId: calId || state.calendars[0].id,
      notes,
      completed: false
    });
    saveState();
    document.getElementById('drawer-add-form').reset();
    render();
    renderDayDrawer();
  };

  // Chat Assistant
  function renderChat() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = state.chatHistory
      .map(msg => {
        let cardHtml = '';
        if (msg.cards && msg.cards.length) {
          cardHtml = msg.cards
            .map(
              c => `
            <div class="chat-action-card" style="--cal-color:${c.color || '#c84b31'}">
              <strong>${escapeHtml(c.title)}</strong>
              <span style="color:var(--text-secondary)">${escapeHtml(c.subtitle)}</span>
              <div class="chat-action-footer">
                ${c.date ? `<button type="button" class="chat-link-btn" onclick="openDayDrawer('${c.date}')">Open day →</button>` : '<span></span>'}
                ${c.undoId ? `<button type="button" class="chat-link-btn" onclick="undoAddedEvent('${c.undoId}')">Undo</button>` : ''}
              </div>
            </div>
          `
            )
            .join('');
        }
        return `
          <div class="chat-msg ${msg.role}">
            <div style="white-space:pre-line;">${escapeHtml(msg.text)}</div>
            ${cardHtml}
          </div>
        `;
      })
      .join('');

    container.scrollTop = container.scrollHeight;
  }

  window.undoAddedEvent = function (evId) {
    const existed = state.events.some(e => e.id === evId);
    if (!existed) return;
    state.events = state.events.filter(e => e.id !== evId);
    state.chatHistory.push({
      id: 'msg-' + Date.now(),
      role: 'assistant',
      text: 'Removed that item from your calendar.'
    });
    saveState();
    render();
  };

  window.sendSuggestion = function (text) {
    const input = document.getElementById('chat-input');
    input.value = text;
    handleChatSubmit();
  };

  window.handleChatKey = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  };

  window.handleChatSubmit = function () {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    state.chatHistory.push({
      id: 'msg-' + Date.now(),
      role: 'user',
      text
    });

    const result = window.DaybookNLP.parseChatCommand(text, state);

    if (result.type === 'add_items') {
      const cards = [];
      result.items.forEach((item, idx) => {
        const id = 'ev-' + (Date.now() + idx);
        state.events.push({
          id,
          title: item.title,
          date: item.date,
          time: item.time,
          calendarId: item.calendarId,
          notes: '',
          completed: false
        });
        cards.push({
          title: item.title,
          subtitle: `${item.date} • ${window.DaybookNLP.formatDisplayTime(item.time)} • ${item.calendarName}`,
          color: item.calendarColor,
          date: item.date,
          undoId: id
        });
      });

      state.chatHistory.push({
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        text: result.replyText,
        cards
      });
    } else if (result.type === 'create_checklist') {
      const id = 'cl-' + Date.now();
      state.checklists.push({
        id,
        title: result.title,
        label: 'Study / Prep',
        items: []
      });
      state.chatHistory.push({
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        text: result.replyText,
        cards: [
          {
            title: result.title,
            subtitle: 'New checklist created — open Checklists tab to view',
            color: '#c81e1e'
          }
        ]
      });
    } else if (result.type === 'add_checklist_item') {
      let cl = result.checklistId
        ? state.checklists.find(c => c.id === result.checklistId)
        : state.checklists.find(c => c.title.toLowerCase() === result.checklistName.toLowerCase());
      if (!cl) {
        cl = {
          id: 'cl-' + Date.now(),
          title: result.checklistName.replace(/\b\w/g, c => c.toUpperCase()),
          label: 'Study / Prep',
          items: []
        };
        state.checklists.push(cl);
      }
      cl.items.push({
        id: 'cli-' + Date.now(),
        text: result.itemText,
        dueDate: result.dueDate || '',
        completed: false
      });
      state.chatHistory.push({
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        text: `Added "${result.itemText}"${result.dueDate ? ` (${result.dueDate})` : ''} to "${cl.title}" checklist.`,
        cards: [
          {
            title: result.itemText,
            subtitle: `Checklist: ${cl.title}${result.dueDate ? ` • Due ${result.dueDate}` : ''}`,
            color: '#1d3557'
          }
        ]
      });
    } else if (result.type === 'query_checklists') {
      if (!state.checklists || state.checklists.length === 0) {
        state.chatHistory.push({
          id: 'msg-' + (Date.now() + 1),
          role: 'assistant',
          text: 'You have no checklists yet. Say "Create checklist USACO Prep" to start one.'
        });
      } else {
        const lines = state.checklists.map(cl => {
          const done = cl.items.filter(i => i.completed).length;
          return `• ${cl.title} (${done}/${cl.items.length} done)`;
        });
        state.chatHistory.push({
          id: 'msg-' + (Date.now() + 1),
          role: 'assistant',
          text: `Your checklists:\n${lines.join('\n')}`
        });
      }
    } else if (result.type === 'create_calendar') {
      const id = 'cal-' + Date.now();
      state.calendars.push({
        id,
        name: result.calendarName,
        color: result.color,
        visible: true
      });
      state.chatHistory.push({
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        text: result.replyText,
        cards: [
          {
            title: result.calendarName,
            subtitle: 'New labeled calendar ready to use',
            color: result.color
          }
        ]
      });
    } else if (result.type === 'query_date') {
      const dayEvents = getEventsForDate(result.date, true);
      if (dayEvents.length === 0) {
        state.chatHistory.push({
          id: 'msg-' + (Date.now() + 1),
          role: 'assistant',
          text: `You have nothing scheduled on ${formatLongDate(result.date)}.`
        });
      } else {
        const lines = dayEvents.map(ev => {
          const cal = getCalendar(ev.calendarId);
          const t = ev.time ? window.DaybookNLP.formatDisplayTime(ev.time) : 'Any time';
          return `• ${t} — ${ev.title} (${cal.name})${ev.completed ? ' ✓' : ''}`;
        });
        state.chatHistory.push({
          id: 'msg-' + (Date.now() + 1),
          role: 'assistant',
          text: `Schedule for ${formatLongDate(result.date)}:\n${lines.join('\n')}`,
          cards: [
            {
              title: `${dayEvents.length} item(s)`,
              subtitle: formatLongDate(result.date),
              date: result.date
            }
          ]
        });
      }
    } else if (result.type === 'complete_item') {
      const q = result.query.toLowerCase();
      const target = state.events.find(e => !e.completed && e.title.toLowerCase().includes(q));
      if (target) {
        target.completed = true;
        state.chatHistory.push({
          id: 'msg-' + (Date.now() + 1),
          role: 'assistant',
          text: `Marked "${target.title}" as completed.`
        });
      } else {
        let clItemMatch = null;
        let clOwner = null;
        for (const cl of state.checklists || []) {
          const found = cl.items.find(i => !i.completed && i.text.toLowerCase().includes(q));
          if (found) {
            clItemMatch = found;
            clOwner = cl;
            break;
          }
        }
        if (clItemMatch) {
          clItemMatch.completed = true;
          state.chatHistory.push({
            id: 'msg-' + (Date.now() + 1),
            role: 'assistant',
            text: `Checked off "${clItemMatch.text}" in "${clOwner.title}".`
          });
        } else {
          state.chatHistory.push({
            id: 'msg-' + (Date.now() + 1),
            role: 'assistant',
            text: `Could not find an open task or checklist item matching "${result.query}".`
          });
        }
      }
    } else if (result.type === 'delete_item') {
      const q = result.query.toLowerCase();
      const target = state.events.find(e => e.title.toLowerCase().includes(q));
      if (target) {
        state.events = state.events.filter(e => e.id !== target.id);
        state.chatHistory.push({
          id: 'msg-' + (Date.now() + 1),
          role: 'assistant',
          text: `Removed "${target.title}" from your calendar.`
        });
      } else {
        let removedText = null;
        for (const cl of state.checklists || []) {
          const idx = cl.items.findIndex(i => i.text.toLowerCase().includes(q));
          if (idx !== -1) {
            removedText = cl.items[idx].text;
            cl.items.splice(idx, 1);
            break;
          }
        }
        if (removedText) {
          state.chatHistory.push({
            id: 'msg-' + (Date.now() + 1),
            role: 'assistant',
            text: `Removed "${removedText}" from your checklist.`
          });
        } else {
          state.chatHistory.push({
            id: 'msg-' + (Date.now() + 1),
            role: 'assistant',
            text: `Could not find an item matching "${result.query}".`
          });
        }
      }
    } else {
      state.chatHistory.push({
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        text: result.replyText
      });
    }

    // Keep chat history bounded
    if (state.chatHistory.length > 60) {
      state.chatHistory = state.chatHistory.slice(-60);
    }

    saveState();
    render();
    if (selectedDayISO) renderDayDrawer();
  };

  window.clearChatHistory = function () {
    state.chatHistory = [
      {
        id: 'msg-welcome',
        role: 'assistant',
        text: 'Chat cleared. Tell me what you want to schedule or ask what is on your calendar.'
      }
    ];
    saveState();
    renderChat();
  };

  window.openHowItWorksModal = function () {
    document.getElementById('how-modal').classList.add('open');
  };

  window.closeHowItWorksModal = function () {
    document.getElementById('how-modal').classList.remove('open');
  };

  window.openEditEventModal = function (evId) {
    const ev = state.events.find(x => x.id === evId);
    if (!ev) return;
    document.getElementById('edit-ev-id').value = ev.id;
    document.getElementById('edit-ev-title').value = ev.title;
    document.getElementById('edit-ev-date').value = ev.date;
    document.getElementById('edit-ev-time').value = ev.time || '';
    document.getElementById('edit-ev-cal').value = ev.calendarId;
    document.getElementById('edit-ev-notes').value = ev.notes || '';
    document.getElementById('edit-event-modal').classList.add('open');
    setTimeout(() => document.getElementById('edit-ev-title').focus(), 50);
  };

  window.closeEditEventModal = function () {
    document.getElementById('edit-event-modal').classList.remove('open');
  };

  window.handleSaveEditEvent = function (e) {
    e.preventDefault();
    const id = document.getElementById('edit-ev-id').value;
    const ev = state.events.find(x => x.id === id);
    if (!ev) return;
    const title = document.getElementById('edit-ev-title').value.trim();
    if (!title) return;
    ev.title = title;
    ev.date = document.getElementById('edit-ev-date').value;
    ev.time = document.getElementById('edit-ev-time').value;
    ev.calendarId = document.getElementById('edit-ev-cal').value;
    ev.notes = document.getElementById('edit-ev-notes').value.trim();
    saveState();
    closeEditEventModal();
    render();
    if (selectedDayISO) renderDayDrawer();
  };

  // Checklists (Study & Competition Prep)
  function renderChecklistsView() {
    const grid = document.getElementById('checklists-grid');
    if (!grid) return;
    const lists = state.checklists || [];

    if (lists.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <strong>No checklists yet</strong>
          <p>Create a checklist for a competition, exam, or project (e.g. "USACO Prep", "Biology Olympiad") to track what you need to study.</p>
          <button type="button" class="btn-primary btn-accent" style="margin-top:0.9rem;" onclick="createNewChecklistPrompt()">+ Create First Checklist</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = lists
      .map(cl => {
        const done = cl.items.filter(i => i.completed).length;
        const total = cl.items.length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);

        const itemsHtml = cl.items.length
          ? cl.items
              .map(
                item => `
            <div class="checklist-row ${item.completed ? 'completed' : ''}">
              <div class="checklist-row-left">
                <button type="button" class="task-checkbox" onclick="toggleChecklistItem('${cl.id}', '${item.id}')">
                  ${item.completed ? '✓' : ''}
                </button>
                <span class="checklist-row-text">${escapeHtml(item.text)}</span>
                ${item.dueDate ? `<span class="checklist-date-badge">${escapeHtml(item.dueDate)}</span>` : ''}
              </div>
              <div style="display:flex; gap:0.15rem;">
                <button type="button" class="icon-btn-sm" title="Edit item" onclick="editChecklistItem('${cl.id}', '${item.id}')">✎</button>
                <button type="button" class="icon-btn-sm" title="Delete item" onclick="deleteChecklistItem('${cl.id}', '${item.id}')">×</button>
              </div>
            </div>
          `
              )
              .join('')
          : `<div style="font-size:0.82rem; color:var(--text-muted); padding:0.4rem 0;">No items yet — add one below.</div>`;

        return `
          <div class="checklist-board">
            <div class="checklist-board-header">
              <div>
                <div class="checklist-board-title">${escapeHtml(cl.title)}</div>
                ${cl.label ? `<div class="checklist-board-tag">${escapeHtml(cl.label)}</div>` : ''}
              </div>
              <div style="display:flex; gap:0.2rem;">
                <button type="button" class="icon-btn-sm" title="Edit checklist" onclick="editChecklistBoard('${cl.id}')">✎</button>
                <button type="button" class="icon-btn-sm" title="Delete checklist" onclick="deleteChecklistBoard('${cl.id}')">×</button>
              </div>
            </div>

            <div>
              <div class="progress-label-row" style="margin-bottom:0.25rem;">
                <span>${done} of ${total} done</span>
                <span style="font-family:var(--font-mono);">${pct}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${pct}%"></div>
              </div>
            </div>

            <div class="checklist-items">${itemsHtml}</div>

            <form class="checklist-add-row" onsubmit="addChecklistItem(event, '${cl.id}')">
              <input type="text" id="cl-input-${cl.id}" placeholder="Add study topic or task..." required>
              <input type="date" id="cl-date-${cl.id}" title="Optional due date">
              <button type="submit" class="btn-primary">+</button>
            </form>
          </div>
        `;
      })
      .join('');
  }

  window.createNewChecklistPrompt = function () {
    const title = prompt('Checklist title (e.g., Math Competition, Finals Prep):');
    if (!title || !title.trim()) return;
    const label = prompt('Optional label / category (e.g., Competition, Study, Project):') || '';
    state.checklists.push({
      id: 'cl-' + Date.now(),
      title: title.trim(),
      label: label.trim(),
      items: []
    });
    saveState();
    render();
  };

  window.editChecklistBoard = function (clId) {
    const cl = state.checklists.find(c => c.id === clId);
    if (!cl) return;
    const nextTitle = prompt('Edit checklist title:', cl.title);
    if (nextTitle === null) return;
    const nextLabel = prompt('Edit label / category:', cl.label || '');
    if (nextTitle.trim()) cl.title = nextTitle.trim();
    if (nextLabel !== null) cl.label = nextLabel.trim();
    saveState();
    render();
  };

  window.deleteChecklistBoard = function (clId) {
    state.checklists = state.checklists.filter(c => c.id !== clId);
    saveState();
    render();
  };

  window.addChecklistItem = function (e, clId) {
    e.preventDefault();
    const input = document.getElementById(`cl-input-${clId}`);
    const dateInput = document.getElementById(`cl-date-${clId}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const dueDate = dateInput ? dateInput.value : '';
    const cl = state.checklists.find(c => c.id === clId);
    if (!cl) return;
    cl.items.push({ id: 'cli-' + Date.now(), text, dueDate, completed: false });
    saveState();
    render();
  };

  window.toggleChecklistItem = function (clId, itemId) {
    const cl = state.checklists.find(c => c.id === clId);
    if (!cl) return;
    const item = cl.items.find(i => i.id === itemId);
    if (!item) return;
    item.completed = !item.completed;
    saveState();
    render();
  };

  window.editChecklistItem = function (clId, itemId) {
    const cl = state.checklists.find(c => c.id === clId);
    if (!cl) return;
    const item = cl.items.find(i => i.id === itemId);
    if (!item) return;
    const next = prompt('Edit checklist item:', item.text);
    if (next === null) return;
    const nextDate = prompt('Due date (YYYY-MM-DD, or leave blank):', item.dueDate || '');
    if (next.trim()) item.text = next.trim();
    if (nextDate !== null) item.dueDate = nextDate.trim();
    saveState();
    render();
  };

  window.deleteChecklistItem = function (clId, itemId) {
    const cl = state.checklists.find(c => c.id === clId);
    if (!cl) return;
    cl.items = cl.items.filter(i => i.id !== itemId);
    saveState();
    render();
  };

  // Master Render
  function render() {
    renderSidebar();
    renderTodayView();
    renderCalendarView();
    renderChecklistsView();
    renderChat();
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
    render();
  });
})();
