/**
 * Natural-language calendar parser & chat command processor.
 * Runs 100% locally in the browser with zero external dependencies.
 */
(function (global) {
  const MONTHS = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  const WEEKDAYS = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6
  };

  const COLOR_MAP = {
    red: '#c84b31',
    terracotta: '#c84b31',
    orange: '#d97706',
    amber: '#d97706',
    yellow: '#ca8a04',
    green: '#1f7a53',
    sage: '#1f7a53',
    teal: '#0d9488',
    blue: '#2563eb',
    cobalt: '#2563eb',
    purple: '#7c3aed',
    plum: '#7c3aed',
    pink: '#db2777',
    rose: '#e11d48',
    slate: '#475569'
  };

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(base, days) {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  }

  function formatDisplayTime(hhmm) {
    if (!hhmm) return 'Any time';
    const [hStr, mStr] = hhmm.split(':');
    let h = parseInt(hStr, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mStr} ${ampm}`;
  }

  function extractDate(text, now) {
    let working = text;
    let dateObj = null;

    // 1. ISO date: YYYY-MM-DD
    const isoMatch = working.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (isoMatch) {
      dateObj = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      working = working.replace(isoMatch[0], ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    // 2. Numeric MM/DD or MM/DD/YYYY
    const slashMatch = working.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slashMatch) {
      const m = Number(slashMatch[1]) - 1;
      const d = Number(slashMatch[2]);
      let y = slashMatch[3] ? Number(slashMatch[3]) : now.getFullYear();
      if (y < 100) y += 2000;
      dateObj = new Date(y, m, d);
      if (!slashMatch[3] && dateObj < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        dateObj.setFullYear(y + 1);
      }
      working = working.replace(slashMatch[0], ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    // 3. Month Name + Day (e.g., "Nov 24", "November 24th", "on Dec 2")
    const monthNamesPattern = Object.keys(MONTHS).join('|');
    const mdRegex = new RegExp(`\\b(?:on\\s+)?(${monthNamesPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
    const mdMatch = working.match(mdRegex);
    if (mdMatch) {
      const m = MONTHS[mdMatch[1].toLowerCase()];
      const d = Number(mdMatch[2]);
      const y = mdMatch[3] ? Number(mdMatch[3]) : now.getFullYear();
      dateObj = new Date(y, m, d);
      if (!mdMatch[3] && dateObj < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        dateObj.setFullYear(y + 1);
      }
      working = working.replace(mdMatch[0], ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    // 4. Relative: "in X days"
    const inDaysMatch = working.match(/\bin\s+(\d+)\s+days?\b/i);
    if (inDaysMatch) {
      dateObj = addDays(now, Number(inDaysMatch[1]));
      working = working.replace(inDaysMatch[0], ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    // 5. Today / Tomorrow / Tonight
    if (/\b(today|tonight|this morning|this afternoon|this evening)\b/i.test(working)) {
      dateObj = new Date(now);
      working = working.replace(/\b(today)\b/i, ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    if (/\b(tomorrow|tmr|tmrw)\b/i.test(working)) {
      dateObj = addDays(now, 1);
      working = working.replace(/\b(tomorrow|tmr|tmrw)\b/i, ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    // 6. Weekday names: "next Monday", "on Friday", "Friday"
    const dayPattern = Object.keys(WEEKDAYS).join('|');
    const wdRegex = new RegExp(`\\b(?:(next|this|on)\\s+)?(${dayPattern})\\b`, 'i');
    const wdMatch = working.match(wdRegex);
    if (wdMatch) {
      const targetDay = WEEKDAYS[wdMatch[2].toLowerCase()];
      const currentDay = now.getDay();
      let diff = (targetDay - currentDay + 7) % 7;
      if (diff === 0 || (wdMatch[1] && wdMatch[1].toLowerCase() === 'next' && diff <= 7)) {
        diff = diff === 0 ? 7 : diff;
      }
      dateObj = addDays(now, diff);
      working = working.replace(wdMatch[0], ' ');
      return { dateStr: toISODate(dateObj), remaining: working };
    }

    return { dateStr: null, remaining: working };
  }

  function extractTime(text) {
    let working = text;

    // 1. "at noon" / "noon" / "at midnight" / "midnight"
    if (/\b(?:at\s+)?noon\b/i.test(working)) {
      working = working.replace(/\b(?:at\s+)?noon\b/i, ' ');
      return { timeStr: '12:00', remaining: working };
    }
    if (/\b(?:at\s+)?midnight\b/i.test(working)) {
      working = working.replace(/\b(?:at\s+)?midnight\b/i, ' ');
      return { timeStr: '00:00', remaining: working };
    }

    // 2. "at 3:30pm", "3:30 pm", "at 9am", "9 am", "14:30"
    const timeRegex = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+)(\d{1,2}):(\d{2})\b/i;
    const match = working.match(timeRegex);
    if (match) {
      let hours, mins;
      if (match[1] !== undefined) {
        hours = parseInt(match[1], 10);
        mins = match[2] ? parseInt(match[2], 10) : 0;
        const period = match[3].toLowerCase();
        if (period === 'pm' && hours < 12) hours += 12;
        if (period === 'am' && hours === 12) hours = 0;
      } else {
        hours = parseInt(match[4], 10);
        mins = parseInt(match[5], 10);
      }

      if (hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59) {
        const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        working = working.replace(match[0], ' ');
        return { timeStr, remaining: working };
      }
    }

    // 3. Soft time hints
    if (/\bthis morning\b/i.test(working)) {
      working = working.replace(/\bthis morning\b/i, ' ');
      return { timeStr: '09:00', remaining: working };
    }
    if (/\bthis afternoon\b/i.test(working)) {
      working = working.replace(/\bthis afternoon\b/i, ' ');
      return { timeStr: '14:00', remaining: working };
    }
    if (/\b(tonight|this evening)\b/i.test(working)) {
      working = working.replace(/\b(tonight|this evening)\b/i, ' ');
      return { timeStr: '19:00', remaining: working };
    }

    return { timeStr: '', remaining: working };
  }

  function extractCalendar(text, calendars) {
    let working = text;
    let matchedCal = null;

    // 1. Hashtag syntax: #work, #school
    const hashMatch = working.match(/#([a-z0-9_-]+)/i);
    if (hashMatch) {
      const target = hashMatch[1].toLowerCase();
      matchedCal = calendars.find(c => c.name.toLowerCase() === target || c.name.toLowerCase().includes(target));
      if (matchedCal) {
        working = working.replace(hashMatch[0], ' ');
        return { calendar: matchedCal, remaining: working };
      }
    }

    // 2. Preposition + calendar name: "in Work", "to Personal", "under School", "for Fitness"
    const sortedCals = [...calendars].sort((a, b) => b.name.length - a.name.length);
    for (const cal of sortedCals) {
      const escaped = cal.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prepRegex = new RegExp(`\\b(?:in|to|under|for|on)\\s+(?:my\\s+)?${escaped}(?:\\s+calendar)?\\b`, 'i');
      const m = working.match(prepRegex);
      if (m) {
        working = working.replace(m[0], ' ');
        return { calendar: cal, remaining: working };
      }
    }

    return { calendar: null, remaining: working };
  }

  function cleanTitle(text) {
    let s = text.trim();

    // Strip leading conversational filler & command verbs iteratively
    const leadingPatterns = [
      /^(?:hey|hi|hello|yo|ok|okay|please|pls|can you|could you|would you|will you|do this|help me)\b[\s,:-]*/i,
      /^(?:add|schedule|create|put|set|plan|book|log|make|remind me to|remind me|note down|write down|enter|configure)\b[\s,:-]*/i,
      /^(?:there is|there's|theres|i have got|i've got|ive got|i have|i've|we have|i need to|i gotta|i want to|i'm going to|im going to|got)\b[\s,:-]*/i,
      /^(?:a|an|the|that|to|for|on|at|in)\b[\s,:-]*/i
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const rx of leadingPatterns) {
        const next = s.replace(rx, '');
        if (next !== s) {
          s = next.trim();
          changed = true;
        }
      }
    }

    // Strip trailing dangling prepositions/politeness
    const trailingPatterns = [
      /[\s,:-]*\b(?:at|on|for|in|to|from|by|around|about|please|pls|thanks|thank you)\s*[?.!]*$/i,
      /[?.!]+$/
    ];

    changed = true;
    while (changed) {
      changed = false;
      for (const rx of trailingPatterns) {
        const next = s.replace(rx, '');
        if (next !== s) {
          s = next.trim();
          changed = true;
        }
      }
    }

    s = s.replace(/\s{2,}/g, ' ').trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Main entry point: takes user chat text and current app state,
   * returns { type, actions, replyText, items? }
   */
  function parseChatCommand(rawInput, state) {
    const input = rawInput.trim();
    const now = new Date();
    const calendars = state.calendars || [];
    const defaultCal = calendars.find(c => c.id === state.focusedCalendarId) || calendars[0];

    if (!input) {
      return { type: 'noop', replyText: 'Type something like "Tomorrow at 3pm Dentist in Personal".' };
    }

    // 1. Help command
    if (/^(help|\?|what can you do)$/i.test(input)) {
      return {
        type: 'info',
        replyText:
          'You can talk to me naturally to configure your calendar:\n' +
          '• "Today at 6pm Gym in Fitness"\n' +
          '• "Nov 25 at 10am Calculus Exam in School"\n' +
          '• "Tomorrow at 2pm Team Sync, at 5pm Groceries"\n' +
          '• "Create calendar Side Project in purple"\n' +
          '• "What do I have today?" or "Mark gym as done"'
      };
    }

    // 2. Create Checklist command
    const createClMatch = input.match(/^(?:create|add|new|make)\s+(?:a\s+)?(?:study\s+)?checklist\s+(?:called\s+|named\s+|for\s+)?["']?([a-z0-9\s_-]+?)["']?$/i);
    if (createClMatch) {
      const title = createClMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());
      return {
        type: 'create_checklist',
        title,
        replyText: `Created a new checklist "${title}".`
      };
    }

    // 2b. Add item to a Checklist: "add X to <Name> checklist" or "add X to <existing checklist name>"
    const checklists = state.checklists || [];
    const clExplicitMatch = input.match(/^(?:add|put|include|note)\s+(.+?)\s+(?:to|in|into|on|under)\s+(?:my\s+)?(.+?)\s+checklist$/i);
    if (clExplicitMatch) {
      const itemText = cleanTitle(clExplicitMatch[1]);
      const targetName = clExplicitMatch[2].trim();
      if (itemText) {
        return {
          type: 'add_checklist_item',
          itemText,
          checklistName: targetName,
          replyText: `Added "${itemText}" to checklist "${targetName}".`
        };
      }
    }

    for (const cl of checklists) {
      const escaped = cl.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const clMatch = input.match(new RegExp(`^(?:add|put|include|note)\\s+(.+?)\\s+(?:to|in|into|on|under)\\s+(?:my\\s+)?${escaped}$`, 'i'));
      if (clMatch) {
        const itemText = cleanTitle(clMatch[1]);
        if (itemText) {
          return {
            type: 'add_checklist_item',
            itemText,
            checklistId: cl.id,
            checklistName: cl.title,
            replyText: `Added "${itemText}" to checklist "${cl.title}".`
          };
        }
      }
    }

    // 2c. Query checklists: "show checklists", "what's in my checklists"
    if (/^(?:show|list|what(?:'s| is) in)\s+(?:my\s+)?checklists?\??$/i.test(input)) {
      return { type: 'query_checklists' };
    }

    // 3. Create Calendar command
    const createCalMatch = input.match(/^(?:create|add|new|make)\s+(?:a\s+)?calendar\s+(?:called\s+|named\s+)?["']?([a-z0-9\s_-]+?)["']?(?:\s+(?:with|in)\s+(?:color\s+)?([a-z]+))?$/i);
    if (createCalMatch) {
      const name = createCalMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());
      const colorWord = createCalMatch[2] ? createCalMatch[2].toLowerCase() : null;
      const color = (colorWord && COLOR_MAP[colorWord]) || '#2563eb';
      return {
        type: 'create_calendar',
        calendarName: name,
        color,
        replyText: `Created a new "${name}" calendar.`
      };
    }

    // 3. Query schedule: "what do I have today?", "schedule for tomorrow", "show Friday"
    if (/^(?:what(?:'s| is| do i have)|show|list|check)\b/i.test(input)) {
      const { dateStr } = extractDate(input, now);
      const targetDate = dateStr || toISODate(now);
      return {
        type: 'query_date',
        date: targetDate
      };
    }

    // 4. Mark complete: "mark X as done", "complete X", "check off X"
    const completeMatch = input.match(/^(?:mark|check\s+off|complete|finish|done\s+with)\s+(.+?)(?:\s+as\s+(?:done|completed?))?$/i);
    if (completeMatch) {
      return {
        type: 'complete_item',
        query: completeMatch[1].trim(),
        replyText: ''
      };
    }

    // 5. Delete item: "delete X", "remove X", "cancel X"
    const deleteMatch = input.match(/^(?:delete|remove|cancel)\s+(.+)$/i);
    if (deleteMatch) {
      return {
        type: 'delete_item',
        query: deleteMatch[1].trim(),
        replyText: ''
      };
    }

    // 6. Add one or more events/tasks (split on ", " or "; " or " and then ")
    const segments = input
      .split(/\s*(?:;|\n|,\s*(?=(?:at\s+\d|today|tomorrow|tmr|on\s+|next\s+|\d{1,2}\/|add|schedule))|\band\s+then\b)\s*/i)
      .map(s => s.trim())
      .filter(Boolean);

    const parsedItems = [];
    let inheritedDate = null;
    let inheritedCal = null;

    for (const seg of segments) {
      let step = seg;
      const calRes = extractCalendar(step, calendars);
      step = calRes.remaining;

      const dateRes = extractDate(step, now);
      step = dateRes.remaining;

      const timeRes = extractTime(step);
      step = timeRes.remaining;

      const title = cleanTitle(step);
      if (!title) continue;

      if (dateRes.dateStr) inheritedDate = dateRes.dateStr;
      if (calRes.calendar) inheritedCal = calRes.calendar;

      const finalDate = dateRes.dateStr || inheritedDate || toISODate(now);
      const finalCal = calRes.calendar || inheritedCal || defaultCal;

      parsedItems.push({
        title,
        date: finalDate,
        time: timeRes.timeStr,
        calendarId: finalCal ? finalCal.id : 'personal',
        calendarName: finalCal ? finalCal.name : 'Personal',
        calendarColor: finalCal ? finalCal.color : '#c84b31'
      });
    }

    if (parsedItems.length === 0) {
      return {
        type: 'info',
        replyText: 'I could not find an event title in that message. Try: "Tomorrow at 3pm Dentist in Personal".'
      };
    }

    return {
      type: 'add_items',
      items: parsedItems,
      replyText:
        parsedItems.length === 1
          ? `Added "${parsedItems[0].title}" to ${parsedItems[0].calendarName} on ${parsedItems[0].date} (${formatDisplayTime(parsedItems[0].time)}).`
          : `Added ${parsedItems.length} items to your calendar.`
    };
  }

  global.DaybookNLP = {
    parseChatCommand,
    formatDisplayTime,
    toISODate
  };
})(window);
