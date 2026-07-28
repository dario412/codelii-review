(function () {
  if (!window.ReviewAuth) return;

  const project = window.__REVIEW_PROJECT__;
  if (!project || !project.id) {
    console.error('[review] Missing project context');
    return;
  }

  const state = {
    commentMode: false,
    sidebarOpen: true,
    comments: [],
    users: [],
    notifications: [],
    unreadCount: 0,
    onlineUsers: [],
    notificationsOpen: false,
    activeBubble: null,
    pendingPin: null,
    highlightId: null,
    viewingCommentId: null,
    selectedIds: new Set(),
    liveSyncTimer: null,
    hasSyncedOnce: false,
    sidebarTab: 'open',
    screenshotUrls: new Map(),
  };

  const page = currentPage();
  const projectId = project.id;
  const viewPrefix = (project.viewPrefix || '').replace(/\/$/, '');

  /* Phosphor Icons (bold, 256x256) — inlined so the overlay stays dependency-free */
  const PHOSPHOR_PATHS = {
    reply: 'M236,200a12,12,0,0,1-24,0,84.09,84.09,0,0,0-84-84H61l27.52,27.51a12,12,0,0,1-17,17l-48-48a12,12,0,0,1,0-17l48-48a12,12,0,0,1,17,17L61,92h67A108.12,108.12,0,0,1,236,200Z',
    copy: 'M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z',
    sparkle: 'M199,125.31l-49.88-18.39L130.69,57a19.92,19.92,0,0,0-37.38,0L74.92,106.92,25,125.31a19.92,19.92,0,0,0,0,37.38l49.88,18.39L93.31,231a19.92,19.92,0,0,0,37.38,0l18.39-49.88L199,162.69a19.92,19.92,0,0,0,0-37.38Zm-63.38,35.16a12,12,0,0,0-7.11,7.11L112,212.28l-16.47-44.7a12,12,0,0,0-7.11-7.11L43.72,144l44.7-16.47a12,12,0,0,0,7.11-7.11L112,75.72l16.47,44.7a12,12,0,0,0,7.11,7.11L180.28,144ZM140,40a12,12,0,0,1,12-12h12V16a12,12,0,0,1,24,0V28h12a12,12,0,0,1,0,24H188V64a12,12,0,0,1-24,0V52H152A12,12,0,0,1,140,40ZM252,88a12,12,0,0,1-12,12h-4v4a12,12,0,0,1-24,0v-4h-4a12,12,0,0,1,0-24h4V72a12,12,0,0,1,24,0v4h4A12,12,0,0,1,252,88Z',
    checkCircle: 'M176.49,95.51a12,12,0,0,1,0,17l-56,56a12,12,0,0,1-17,0l-24-24a12,12,0,1,1,17-17L112,143l47.51-47.52A12,12,0,0,1,176.49,95.51ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z',
    reopen: 'M228,128a100,100,0,0,1-98.66,100H128a99.39,99.39,0,0,1-68.62-27.29,12,12,0,0,1,16.48-17.45,76,76,0,1,0-1.57-109c-.13.13-.25.25-.39.37L54.89,92H72a12,12,0,0,1,0,24H24a12,12,0,0,1-12-12V56a12,12,0,0,1,24,0V76.72L57.48,57.06A100,100,0,0,1,228,128Z',
    trash: 'M216,48H180V36A28,28,0,0,0,152,8H104A28,28,0,0,0,76,36V48H40a12,12,0,0,0,0,24h4V208a20,20,0,0,0,20,20H192a20,20,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM100,36a4,4,0,0,1,4-4h48a4,4,0,0,1,4,4V48H100Zm88,168H68V72H188ZM116,104v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm48,0v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z',
    x: 'M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.51a12,12,0,0,1,17,17L145,128Z',
    check: 'M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z',
    list: 'M80,64a12,12,0,0,1,12-12H216a12,12,0,0,1,0,24H92A12,12,0,0,1,80,64Zm136,52H92a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H92a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,80A16,16,0,1,0,28,64,16,16,0,0,0,44,80Zm0,64a16,16,0,1,0-16-16A16,16,0,0,0,44,144Zm0,64a16,16,0,1,0-16-16A16,16,0,0,0,44,208Z',
    arrowLeft: 'M228,128a12,12,0,0,1-12,12H69l51.52,51.51a12,12,0,0,1-17,17l-72-72a12,12,0,0,1,0-17l72-72a12,12,0,0,1,17,17L69,116H216A12,12,0,0,1,228,128Z',
    plus: 'M224,128a12,12,0,0,1-12,12H140v72a12,12,0,0,1-24,0V140H44a12,12,0,0,1,0-24h72V44a12,12,0,0,1,24,0v72h72A12,12,0,0,1,224,128Z',
    bell: 'M224,184h-8.36l-8.21-131.3a28,28,0,0,0-27.86-26.7H160a32,32,0,0,0-64,0H76.43a28,28,0,0,0-27.86,26.7L40.36,184H32a12,12,0,0,0,0,24H224a12,12,0,0,0,0-24ZM96,56a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm-31.64,128,7.71-123.28A4,4,0,0,1,76.43,56H88v8a12,12,0,0,0,12,12h56a12,12,0,0,0,12-12V56h11.57a4,4,0,0,1,4.36,4.72L181.64,184ZM156,228a28,28,0,0,1-56,0Z',
    signOut: 'M120,216a12,12,0,0,1-12,12H48a20,20,0,0,1-20-20V48A20,20,0,0,1,48,28h60a12,12,0,0,1,0,24H52V204h56A12,12,0,0,1,120,216Zm108.49-96.49-40-40a12,12,0,0,0-17,17L191,116H104a12,12,0,0,0,0,24h87l-19.52,19.51a12,12,0,0,0,17,17l40-40A12,12,0,0,0,228.49,119.51Z',
    chat: 'M132,24A100.14,100.14,0,0,0,32,124v84a12,12,0,0,0,12,12h88a100,100,0,0,0,0-200ZM132,200H56V124a76,76,0,1,1,76,76Z',
    camera: 'M208,56H180.28L166.65,35.56A12,12,0,0,0,156.72,28H99.28a12,12,0,0,0-9.93,7.56L75.72,56H48A28,28,0,0,0,20,84V192a28,28,0,0,0,28,28H208a28,28,0,0,0,28-28V84A28,28,0,0,0,208,56Zm4,136a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V84a4,4,0,0,1,4-4H80a12,12,0,0,0,9.93-7.56L103.56,52h48.88l13.63,20.44A12,12,0,0,0,176,80h32a4,4,0,0,1,4,4ZM128,88a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,88Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,152Z',
    users: 'M125.18,156.94a64,64,0,1,0-66.36,0,100.23,100.23,0,0,0-39.55,32.42,12,12,0,0,0,19.46,14.08,76,76,0,0,1,106.54,0,12,12,0,0,0,19.46-14.08A100.23,100.23,0,0,0,125.18,156.94ZM92,140a40,40,0,1,1,40-40A40,40,0,0,1,92,140Zm88-4a12,12,0,0,1,0-24,24,24,0,1,0-23.79-27.86,12,12,0,1,1-23.06-6.66A48.05,48.05,0,0,1,196,136a48.46,48.46,0,0,1-6.55.45,12,12,0,0,1-2.64-23.72A24.09,24.09,0,0,0,180,136Zm27.89,54.51a12,12,0,0,1-16.62,17.3,75.32,75.32,0,0,0-32.09-15.55,12,12,0,0,1,5.64-23.32,99.14,99.14,0,0,1,43.07,20.57Z',
    house: 'M222.14,105.85l-80-80a20,20,0,0,0-28.28,0l-80,80A19.86,19.86,0,0,0,28,120v92a12,12,0,0,0,12,12H216a12,12,0,0,0,12-12V120A19.86,19.86,0,0,0,222.14,105.85ZM204,200H160V144a12,12,0,0,0-12-12H108a12,12,0,0,0-12,12v56H52V122.49l76-76,76,76Z',
  };

  function icon(name, size = 17) {
    const wrap = el('span', { class: 'review-icon', 'aria-hidden': 'true' });
    wrap.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="0 0 256 256" fill="currentColor"><path d="${PHOSPHOR_PATHS[name]}"/></svg>`;
    return wrap;
  }

  function btnContent(iconName, label, iconSize = 16) {
    return [icon(iconName, iconSize), el('span', { 'data-btn-label': '' }, [label])];
  }

  function setButtonContent(btn, iconName, label, iconSize = 16) {
    if (!btn) return;
    btn.replaceChildren(...btnContent(iconName, label, iconSize));
  }

  init();

  function currentPage() {
    const path = window.location.pathname;
    const prefix = (window.__REVIEW_PROJECT__?.viewPrefix || '').replace(/\/$/, '');
    let rel = path;
    if (prefix && path.startsWith(prefix)) {
      rel = path.slice(prefix.length) || '/';
    }
    rel = rel.replace(/^\//, '');
    if (!rel || rel.endsWith('/')) rel = `${rel}index.html`.replace(/^\//, '');
    return rel || 'index.html';
  }

  function samePage(a, b) {
    const norm = (p) => {
      let x = !p || p === '/' ? 'index.html' : String(p).replace(/^\//, '');
      if (x.endsWith('/')) x += 'index.html';
      return x;
    };
    return norm(a) === norm(b);
  }

  function pageHref(pagePath, query) {
    const clean = String(pagePath || '').replace(/^\//, '');
    const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
    return `${viewPrefix}/${clean}${q}`;
  }

  function withProject(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}projectId=${encodeURIComponent(projectId)}`;
  }

  async function init() {
    buildUI();
    await loadUsers();
    await loadComments();
    await loadNotifications();
    await loadPresence();
    sendHeartbeat();
    renderPins();
    renderSidebar();
    renderOnlineUsers();
    renderNotificationBadge();
    handleDeepLink();
    startLiveSync();

    document.addEventListener('visibilitychange', () => {
      startLiveSync();
      if (!document.hidden) runLiveSync();
    });

    setInterval(sendHeartbeat, 30000);
  }

  function startLiveSync() {
    if (state.liveSyncTimer) clearInterval(state.liveSyncTimer);
    const ms = document.hidden ? 10000 : 2500;
    state.liveSyncTimer = setInterval(runLiveSync, ms);
  }

  async function runLiveSync() {
    const prevComments = state.comments.map((c) => ({
      ...c,
      replies: [...(c.replies || [])],
    }));
    const prevUnread = state.unreadCount;
    const prevFingerprint = commentsFingerprint(prevComments);

    await Promise.all([
      loadComments(),
      loadUsers(),
      loadNotifications(),
      loadPresence(),
    ]);

    const nextFingerprint = commentsFingerprint(state.comments);
    const commentsChanged = prevFingerprint !== nextFingerprint;

    if (commentsChanged) {
      renderPins();
      renderSidebar();
    }

    const me = ReviewAuth.getUser()?.id;
    if (state.hasSyncedOnce && commentsChanged) {
      const events = detectLiveEvents(prevComments, state.comments, me);
      events.forEach(showLiveToast);
    } else if (!state.hasSyncedOnce) {
      state.hasSyncedOnce = true;
    }

    if (state.unreadCount !== prevUnread) {
      renderNotificationBadge();
      if (state.notificationsOpen) renderNotificationsPanel();
    }

    renderOnlineUsers();
  }

  function commentsFingerprint(comments) {
    return comments
      .map((c) => {
        const replies = (c.replies || [])
          .map((r) => `${r.id}:${r.createdAt}`)
          .join(',');
        return `${c.id}:${c.resolved}:${c.screenshot}:${c.createdAt}:${replies}`;
      })
      .join('|');
  }

  function detectLiveEvents(prev, next, myId) {
    const events = [];
    const prevMap = new Map(prev.map((c) => [c.id, c]));

    for (const comment of next) {
      const old = prevMap.get(comment.id);
      if (!old) {
        if (comment.authorId !== myId) {
          events.push({ type: 'new', comment });
        }
        continue;
      }

      const oldReplyIds = new Set((old.replies || []).map((r) => r.id));
      for (const reply of comment.replies || []) {
        if (!oldReplyIds.has(reply.id) && reply.authorId !== myId) {
          events.push({ type: 'reply', comment, reply });
        }
      }
    }

    return events;
  }

  function showLiveToast(event) {
    let container = document.getElementById('review-live-toasts');
    if (!container) {
      container = el('div', { class: 'review-live-toasts', id: 'review-live-toasts' });
      document.body.appendChild(container);
    }

    const text = event.type === 'new'
      ? `${event.comment.authorName} left a comment`
      : `${event.reply.authorName} replied on a thread`;

    const toast = el('div', {
      class: 'review-live-toast',
      onclick: () => {
        toast.remove();
        navigateToComment(event.comment);
      },
    }, [
      el('span', { class: 'review-live-toast-dot' }),
      el('div', { class: 'review-live-toast-body' }, [
        el('strong', {}, [text]),
        el('span', {}, [truncate(event.type === 'new' ? event.comment.text : event.reply.text, 72)]),
      ]),
    ]);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  function truncate(str, len) {
    const s = (str || '').trim();
    return s.length > len ? `${s.slice(0, len)}…` : s;
  }

  function getCommentViewportCoords(comment) {
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    const pinDocX = (comment.x / 100) * docW;
    const pinDocY = (comment.y / 100) * docH;
    return {
      clientX: pinDocX - window.scrollX,
      clientY: pinDocY - window.scrollY,
    };
  }

  function positionBubbleNearComment(bubble, comment) {
    const { clientX, clientY } = getCommentViewportCoords(comment);
    positionBubble(bubble, clientX + 18, clientY - 12);
  }

  function buildUI() {
    const user = ReviewAuth.getUser();

    const toolbar = el('div', { class: 'review-toolbar', id: 'review-toolbar' }, [
      el('div', { class: 'review-toolbar-left' }, [
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-toolbar',
          id: 'review-toggle-sidebar',
          title: 'Toggle comments sidebar',
          onclick: toggleSidebar,
        }, btnContent('list', 'Comments')),
        el('a', {
          class: 'review-btn review-btn-toolbar review-btn-quiet',
          href: '/dashboard.html',
          title: 'Back to dashboard',
        }, btnContent('house', 'Dashboard')),
        el('div', { class: 'review-toolbar-divider' }),
        el('div', { class: 'review-logo' }, [
          el('span', { class: 'review-logo-name' }, [project.name || 'Project']),
          el('span', { class: 'review-logo-badge' }, ['Review']),
        ]),
        el('div', { class: 'review-online-wrap', id: 'review-online-wrap' }),
      ]),
      el('div', { class: 'review-toolbar-right' }, [
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-primary',
          id: 'review-toggle-mode',
          title: 'Click anywhere on the page to leave a comment',
          onclick: toggleCommentMode,
        }, btnContent('plus', 'Add comment')),
        el('div', { class: 'review-notifications-wrap', id: 'review-notifications-wrap' }, [
          el('button', {
            type: 'button',
            class: 'review-btn review-btn-icon',
            id: 'review-notifications-btn',
            title: 'Notifications',
            'aria-label': 'Notifications',
            onclick: toggleNotifications,
          }, [
            icon('bell', 18),
            el('span', { class: 'review-notifications-badge', id: 'review-notifications-badge' }, ['']),
          ]),
          el('div', { class: 'review-notifications-panel', id: 'review-notifications-panel' }),
        ]),
        el('div', { class: 'review-user', title: user.email || user.name }, [
          el('div', { class: 'review-avatar' }, [initials(user.name)]),
          el('span', { class: 'review-user-name' }, [user.name]),
        ]),
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-icon',
          title: 'Sign out',
          'aria-label': 'Sign out',
          onclick: () => ReviewAuth.logout(),
        }, [icon('signOut', 17)]),
      ]),
    ]);

    const sidebar = el('div', { class: 'review-sidebar open', id: 'review-sidebar' }, [
      el('div', { class: 'review-sidebar-header' }, [
        el('div', { class: 'review-sidebar-title' }, [
          icon('chat', 18),
          el('h2', {}, ['Comments']),
        ]),
        el('span', { class: 'review-sidebar-count', id: 'review-count' }, ['0']),
      ]),
      el('div', { class: 'review-sidebar-prompts', id: 'review-sidebar-prompts' }, [
        el('p', { class: 'review-sidebar-prompts-label' }, ['Cursor actions']),
        el('div', { class: 'review-sidebar-prompt-row' }, [
          el('button', {
            type: 'button',
            class: 'review-btn review-btn-prompt',
            id: 'review-copy-all-prompts',
            title: 'Copy Cursor prompts for all open comments',
            onclick: (e) => {
              e.stopPropagation();
              copyAllOpenPrompts();
            },
          }, btnContent('copy', 'Copy prompts')),
          el('button', {
            type: 'button',
            class: 'review-btn review-btn-fix',
            id: 'review-fix-all',
            title: 'Start a Cursor agent for all open comments',
            onclick: (e) => {
              e.stopPropagation();
              fixAllOpenWithCursor(e.currentTarget);
            },
          }, btnContent('sparkle', 'Fix all')),
        ]),
      ]),
      el('div', { class: 'review-sidebar-tabs', id: 'review-sidebar-tabs' }, [
        el('button', {
          type: 'button',
          class: 'review-sidebar-tab active',
          id: 'review-tab-open',
          onclick: () => setSidebarTab('open'),
        }, [
          el('span', { 'data-tab-label': '' }, ['Open']),
          el('span', { class: 'review-sidebar-tab-count', id: 'review-tab-open-count' }, ['0']),
        ]),
        el('button', {
          type: 'button',
          class: 'review-sidebar-tab',
          id: 'review-tab-resolved',
          onclick: () => setSidebarTab('resolved'),
        }, [
          el('span', { 'data-tab-label': '' }, ['Resolved']),
          el('span', { class: 'review-sidebar-tab-count', id: 'review-tab-resolved-count' }, ['0']),
        ]),
      ]),
      el('div', { class: 'review-sidebar-list', id: 'review-sidebar-list' }),
    ]);

    const pinsLayer = el('div', { class: 'review-pins-layer', id: 'review-pins-layer' });

    document.body.classList.add('review-active', 'review-sidebar-open');
    document.body.appendChild(toolbar);
    document.body.appendChild(sidebar);
    document.body.appendChild(pinsLayer);
    ensureCursorFixModal();
    ensureSelectionBar();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCursorFixModal();
        closeBubble();
        closeNotifications();
        if (state.selectedIds.size) clearSelection();
        else if (state.commentMode) toggleCommentMode();
      }
    });

    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('review-notifications-wrap');
      if (wrap && !wrap.contains(e.target)) closeNotifications();
    });
  }

  function toggleNotifications() {
    state.notificationsOpen = !state.notificationsOpen;
    const panel = document.getElementById('review-notifications-panel');
    if (state.notificationsOpen) {
      panel.classList.add('open');
      renderNotificationsPanel();
    } else {
      panel.classList.remove('open');
    }
  }

  function closeNotifications() {
    state.notificationsOpen = false;
    const panel = document.getElementById('review-notifications-panel');
    if (panel) panel.classList.remove('open');
  }

  async function sendHeartbeat() {
    try {
      await fetch('/api/presence', {
        method: 'POST',
        headers: ReviewAuth.headers(),
        body: JSON.stringify({ projectId }),
      });
    } catch {
      /* ignore */
    }
  }

  async function loadPresence() {
    try {
      const res = await fetch(withProject('/api/presence'), { headers: ReviewAuth.headers() });
      if (!res.ok) return;
      const data = await res.json();
      state.onlineUsers = data.online || [];
    } catch {
      /* ignore */
    }
  }

  async function loadNotifications() {
    try {
      const res = await fetch(withProject('/api/notifications'), { headers: ReviewAuth.headers() });
      if (!res.ok) return;
      const data = await res.json();
      state.notifications = data.notifications || [];
      state.unreadCount = data.unread || 0;
    } catch {
      /* ignore */
    }
  }

  function renderOnlineUsers() {
    const wrap = document.getElementById('review-online-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!state.onlineUsers.length) {
      wrap.appendChild(el('div', { class: 'review-online-empty' }, [
        icon('users', 14),
        el('span', {}, ['Just you']),
      ]));
      return;
    }

    wrap.appendChild(el('div', { class: 'review-online-label' }, [
      icon('users', 14),
      el('span', {}, [`${state.onlineUsers.length} online`]),
    ]));

    const faces = el('div', { class: 'review-online-faces' });
    state.onlineUsers.slice(0, 4).forEach((u) => {
      faces.appendChild(el('div', {
        class: 'review-online-face',
        title: `${u.name} · ${u.email || ''}`,
      }, [initials(u.name)]));
    });
    if (state.onlineUsers.length > 4) {
      faces.appendChild(el('div', {
        class: 'review-online-face review-online-face-more',
        title: state.onlineUsers.slice(4).map((u) => u.name).join(', '),
      }, [`+${state.onlineUsers.length - 4}`]));
    }
    wrap.appendChild(faces);
  }

  function renderNotificationBadge() {
    const badge = document.getElementById('review-notifications-badge');
    if (!badge) return;
    if (state.unreadCount > 0) {
      badge.textContent = String(state.unreadCount > 9 ? '9+' : state.unreadCount);
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  function notificationLabel(n) {
    if (n.type === 'tag') return `${n.fromName} tagged you`;
    if (n.type === 'reply') return `${n.fromName} replied to your comment`;
    if (n.type === 'reply_tagged') return `${n.fromName} replied on a thread you're in`;
    return `${n.fromName} notified you`;
  }

  function renderNotificationsPanel() {
    const panel = document.getElementById('review-notifications-panel');
    if (!panel) return;
    panel.innerHTML = '';

    panel.appendChild(el('div', { class: 'review-notifications-header' }, [
      el('strong', {}, ['Notifications']),
      state.unreadCount
        ? el('button', {
          type: 'button',
          class: 'review-notifications-mark-all',
          onclick: markAllNotificationsRead,
        }, ['Mark all read'])
        : null,
    ].filter(Boolean)));

    if (!state.notifications.length) {
      panel.appendChild(el('div', { class: 'review-notifications-empty' }, ['No notifications yet']));
      return;
    }

    const list = el('div', { class: 'review-notifications-list' });
    state.notifications.slice(0, 30).forEach((n) => {
      list.appendChild(el('button', {
        type: 'button',
        class: `review-notification-item${n.read ? '' : ' unread'}`,
        onclick: () => openNotification(n),
      }, [
        el('span', { class: 'review-notification-title' }, [notificationLabel(n)]),
        el('span', { class: 'review-notification-text' }, [n.message]),
        el('span', { class: 'review-notification-time' }, [formatTime(n.createdAt)]),
      ]));
    });
    panel.appendChild(list);
  }

  async function markAllNotificationsRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: ReviewAuth.headers(),
      body: JSON.stringify({ markAllRead: true, projectId }),
    });
    await loadNotifications();
    renderNotificationBadge();
    renderNotificationsPanel();
  }

  async function openNotification(n) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: ReviewAuth.headers(),
      body: JSON.stringify({ id: n.id, projectId }),
    });
    closeNotifications();
    await loadNotifications();
    renderNotificationBadge();

    const comment = state.comments.find((c) => c.id === n.commentId);
    if (comment) {
      if (comment.resolved) {
        if (samePage(comment.page, page)) {
          state.sidebarTab = 'resolved';
          setSidebarTab('resolved');
          openViewBubble(comment, false, true);
        } else {
          window.location.href = pageHref(comment.page, `comment=${comment.id}&resolved=1`);
        }
        return;
      }
      if (samePage(comment.page, page)) {
        scrollToComment(comment);
      } else {
        window.location.href = pageHref(comment.page, `comment=${comment.id}`);
      }
    } else {
      window.location.href = pageHref(n.page, `comment=${n.commentId}`);
    }
  }

  function setSidebarTab(tab) {
    state.sidebarTab = tab;
    document.getElementById('review-tab-open')?.classList.toggle('active', tab === 'open');
    document.getElementById('review-tab-resolved')?.classList.toggle('active', tab === 'resolved');
    renderSidebar();
  }

  function openComments() {
    return state.comments.filter((c) => !c.resolved);
  }

  function resolvedComments() {
    return state.comments.filter((c) => c.resolved);
  }

  function sidebarComments() {
    return state.sidebarTab === 'resolved' ? resolvedComments() : openComments();
  }

  let html2canvasPromise;

  function getHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (!html2canvasPromise) {
      html2canvasPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = () => resolve(window.html2canvas);
        script.onerror = () => reject(new Error('Failed to load screenshot library'));
        document.head.appendChild(script);
      });
    }
    return html2canvasPromise;
  }

  async function captureViewportScreenshot() {
    const html2canvas = await getHtml2Canvas();
    const reviewNodes = document.querySelectorAll(
      '.review-toolbar, .review-sidebar, .review-pins-layer, .review-bubble, .review-click-shield, .review-live-toasts, .review-mention-dropdown, .review-selection-bar, .review-cursor-fix-backdrop'
    );

    reviewNodes.forEach((node) => {
      node.dataset.reviewPrevVisibility = node.style.visibility;
      node.style.visibility = 'hidden';
    });

    try {
      const canvas = await html2canvas(document.documentElement, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: window.innerHeight,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        ignoreElements: (node) => {
          if (!node?.classList) return false;
          return [
            'review-toolbar',
            'review-sidebar',
            'review-pins-layer',
            'review-bubble',
            'review-click-shield',
            'review-live-toasts',
            'review-mention-dropdown',
          ].some((cls) => node.classList.contains(cls));
        },
      });

      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
      });
    } finally {
      reviewNodes.forEach((node) => {
        node.style.visibility = node.dataset.reviewPrevVisibility || '';
        delete node.dataset.reviewPrevVisibility;
      });
    }
  }

  async function uploadScreenshot(commentId, blob) {
    if (!blob) return;
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    await fetch('/api/screenshots', {
      method: 'POST',
      headers: ReviewAuth.headers(),
      body: JSON.stringify({ commentId, projectId, image: base64 }),
    });
  }

  async function loadScreenshotUrl(commentId) {
    if (state.screenshotUrls.has(commentId)) return state.screenshotUrls.get(commentId);

    try {
      const res = await fetch(
        `/api/screenshots?commentId=${encodeURIComponent(commentId)}&projectId=${encodeURIComponent(projectId)}`,
        { headers: ReviewAuth.headers() }
      );
      if (!res.ok) return null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      state.screenshotUrls.set(commentId, url);
      return url;
    } catch {
      return null;
    }
  }

  function appendFormattedCommentText(parent, text, tags, dark = false) {
    if (!text) return;

    if (!tags?.length) {
      parent.appendChild(document.createTextNode(text));
      return;
    }

    const sorted = [...tags].sort((a, b) => b.name.length - a.name.length);
    let segments = [{ type: 'text', value: text }];

    for (const tag of sorted) {
      const escaped = tag.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`@${escaped}`, 'gi');
      const next = [];

      for (const seg of segments) {
        if (seg.type !== 'text') {
          next.push(seg);
          continue;
        }

        let last = 0;
        let match;
        const str = seg.value;
        re.lastIndex = 0;
        while ((match = re.exec(str)) !== null) {
          if (match.index > last) {
            next.push({ type: 'text', value: str.slice(last, match.index) });
          }
          next.push({ type: 'mention', value: match[0] });
          last = match.index + match[0].length;
        }
        if (last < str.length) next.push({ type: 'text', value: str.slice(last) });
      }

      segments = next;
    }

    for (const seg of segments) {
      if (seg.type === 'mention') {
        parent.appendChild(el('span', {
          class: `review-mention-highlight${dark ? ' review-mention-highlight-dark' : ''}`,
        }, [seg.value]));
      } else {
        parent.appendChild(document.createTextNode(seg.value));
      }
    }
  }

  function buildCommentTextEl(text, tags, className = 'review-bubble-text', dark = false) {
    const wrap = el('div', { class: className });
    appendFormattedCommentText(wrap, text, tags, dark);
    return wrap;
  }

  function attachScreenshotBlock(container, comment) {
    if (!comment.screenshot) return;

    const wrap = el('div', { class: 'review-screenshot-wrap' });
    wrap.appendChild(el('div', { class: 'review-screenshot-label' }, ['Snapshot when commented']));
    const loading = el('div', { class: 'review-screenshot-loading' }, ['Loading snapshot…']);
    const img = el('img', {
      class: 'review-screenshot-img',
      alt: 'Page snapshot at time of comment',
    });

    wrap.appendChild(loading);
    wrap.appendChild(img);
    container.appendChild(wrap);

    loadScreenshotUrl(comment.id).then((url) => {
      if (!url) {
        wrap.remove();
        return;
      }
      img.src = url;
      img.onload = () => {
        loading.remove();
        img.classList.add('loaded');
      };
      img.onclick = (e) => {
        e.stopPropagation();
        openScreenshotLightbox(url);
      };
    });
  }

  function openScreenshotLightbox(url) {
    const existing = document.getElementById('review-screenshot-lightbox');
    if (existing) existing.remove();

    const box = el('div', {
      class: 'review-screenshot-lightbox',
      id: 'review-screenshot-lightbox',
      onclick: () => box.remove(),
    }, [
      el('img', { src: url, alt: 'Full page snapshot' }),
    ]);
    document.body.appendChild(box);
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    const sidebar = document.getElementById('review-sidebar');
    sidebar.classList.toggle('open', state.sidebarOpen);
    document.body.classList.toggle('review-sidebar-open', state.sidebarOpen);
  }

  function toggleCommentMode() {
    state.commentMode = !state.commentMode;
    const btn = document.getElementById('review-toggle-mode');
    document.body.classList.toggle('review-comment-mode', state.commentMode);
    btn.classList.toggle('review-btn-active', state.commentMode);
    btn.classList.toggle('review-btn-primary', !state.commentMode);
    setButtonContent(
      btn,
      state.commentMode ? 'x' : 'plus',
      state.commentMode ? 'Cancel' : 'Add comment'
    );
    btn.title = state.commentMode
      ? 'Cancel commenting'
      : 'Click anywhere on the page to leave a comment';

    let shield = document.getElementById('review-click-shield');
    if (state.commentMode) {
      if (!shield) {
        shield = el('div', {
          class: 'review-click-shield',
          id: 'review-click-shield',
          onclick: onPageClick,
        });
        document.body.appendChild(shield);
      }
    } else if (shield) {
      shield.remove();
      state.pendingPin = null;
      closeBubble();
    }
  }

  function onPageClick(e) {
    if (!state.commentMode) return;
    e.preventDefault();
    e.stopPropagation();

    const docX = e.clientX + window.scrollX;
    const docY = e.clientY + window.scrollY;
    const x = (docX / document.documentElement.scrollWidth) * 100;
    const y = (docY / document.documentElement.scrollHeight) * 100;

    state.pendingPin = { x, y, scrollY: window.scrollY };
    openNewCommentBubble(e.clientX, e.clientY).catch(() => {});
  }

  function getMentionableUsers() {
    const me = ReviewAuth.getUser()?.email?.toLowerCase();
    return state.users.filter((u) => u.email.toLowerCase() !== me);
  }

  async function openNewCommentBubble(clientX, clientY) {
    await loadUsers();
    const pin = state.pendingPin;
    closeBubble();
    state.pendingPin = pin;

    const user = ReviewAuth.getUser();
    const bubble = el('div', { class: 'review-bubble review-bubble-new', id: 'review-active-bubble' });

    bubble.appendChild(buildBubbleHeader({
      authorName: user.name,
      title: 'New comment',
      trailing: el('span', { class: 'review-bubble-hint' }, ['@ to tag']),
    }));

    const textarea = el('textarea', {
      class: 'review-textarea',
      placeholder: 'What should change here? Type @ to tag a teammate…',
    });

    const tagPreview = el('div', { class: 'review-tag-preview', id: 'review-tag-preview' });

    const form = el('div', { class: 'review-bubble-form' }, [
      textarea,
      tagPreview,
      el('div', { class: 'review-bubble-actions' }, [
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-ghost',
          onclick: (e) => {
            e.stopPropagation();
            state.pendingPin = null;
            closeBubble();
            toggleCommentMode();
          },
        }, btnContent('x', 'Cancel', 14)),
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-primary',
          id: 'review-post-btn',
          onclick: (e) => {
            e.stopPropagation();
            submitComment(textarea);
          },
        }, btnContent('check', 'Post comment', 14)),
      ]),
    ]);

    bubble.appendChild(form);
    bubble.addEventListener('click', (e) => e.stopPropagation());
    bubble.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(bubble);
    enableBubbleDrag(bubble);
    positionBubble(bubble, clientX, clientY);
    setupMentions(textarea, tagPreview);
    textarea.addEventListener('input', () => updateTagPreview(textarea, tagPreview));
    textarea.focus();
    state.activeBubble = bubble;
  }

  function updateTagPreview(textarea, previewEl) {
    if (!previewEl) return;
    const tags = parseTags(textarea.value);
    if (!tags.length) {
      previewEl.innerHTML = '';
      previewEl.style.display = 'none';
      return;
    }
    previewEl.style.display = 'flex';
    previewEl.innerHTML = '';
    previewEl.appendChild(el('span', { class: 'review-tag-preview-label' }, ['Will notify:']));
    tags.forEach((t) => {
      previewEl.appendChild(el('span', { class: 'review-tag' }, [`@${t.name}`]));
    });
  }

  async function submitComment(textarea) {
    const text = textarea.value.trim();
    if (!text) {
      alert('Please enter a comment before posting.');
      return;
    }
    if (!state.pendingPin) {
      alert('Comment position was lost. Click Add comment and try again.');
      return;
    }

    const btn = document.getElementById('review-post-btn');
    if (btn) {
      btn.disabled = true;
      setButtonContent(btn, 'check', 'Posting…', 14);
    }

    const tags = parseTags(text);

    try {
      if (btn) setButtonContent(btn, 'camera', 'Capturing…', 14);
      const screenshotBlob = await captureViewportScreenshot().catch(() => null);

      if (btn) setButtonContent(btn, 'check', 'Posting…', 14);

      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: ReviewAuth.headers(),
        body: JSON.stringify({
          projectId,
          page,
          text,
          x: state.pendingPin.x,
          y: state.pendingPin.y,
          scrollY: state.pendingPin.scrollY,
          tags,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post comment');
      }

      const data = await res.json();
      if (screenshotBlob && data.comment?.id) {
        if (btn) btn.textContent = 'Saving snapshot…';
        await uploadScreenshot(data.comment.id, screenshotBlob).catch(() => {});
      }

      state.pendingPin = null;
      closeBubble();
      toggleCommentMode();
      await loadComments();
      await loadUsers();
      await loadNotifications();
      renderPins();
      renderSidebar();
      renderNotificationBadge();
    } catch (err) {
      alert(err.message || 'Failed to post comment');
      if (btn) {
        btn.disabled = false;
        setButtonContent(btn, 'check', 'Post comment', 14);
      }
    }
  }

  function parseTags(text) {
    const tags = [];
    const used = new Set();
    const sorted = [...state.users].sort((a, b) => b.name.length - a.name.length);

    for (const user of sorted) {
      const escaped = user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`@${escaped}(?=\\s|,|\\.|!|\\?|$)`, 'i');
      if (pattern.test(text) && !used.has(user.email)) {
        used.add(user.email);
        tags.push({ email: user.email, name: user.name });
      }
    }

    for (const user of sorted) {
      const local = user.email.split('@')[0];
      const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`@${escaped}(?=\\s|,|\\.|!|\\?|$|@)`, 'i');
      if (pattern.test(text) && !used.has(user.email)) {
        used.add(user.email);
        tags.push({ email: user.email, name: user.name });
      }
    }

    return tags;
  }

  function setupMentions(textarea, tagPreview) {
    let dropdown = null;
    let selectedIdx = 0;

    function getMatches(query) {
      const q = query.toLowerCase();
      return getMentionableUsers()
        .filter(
          (u) =>
            !q ||
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.name.toLowerCase().startsWith(q)
        )
        .slice(0, 6);
    }

    textarea.addEventListener('input', () => {
      const val = textarea.value;
      const pos = textarea.selectionStart;
      const before = val.slice(0, pos);
      const atIdx = before.lastIndexOf('@');

      if (atIdx === -1) {
        removeDropdown();
        return;
      }

      const query = before.slice(atIdx + 1);
      if (query.includes('\n')) {
        removeDropdown();
        return;
      }

      const matches = getMatches(query);
      if (!matches.length) {
        removeDropdown();
        return;
      }

      removeDropdown();
      selectedIdx = 0;
      dropdown = el('div', { class: 'review-mention-dropdown', id: 'review-mention-dropdown' });

      matches.forEach((u, i) => {
        dropdown.appendChild(el('div', {
          class: `review-mention-item${i === 0 ? ' selected' : ''}`,
          onclick: (e) => {
            e.stopPropagation();
            insertMention(u, atIdx);
          },
        }, [
          el('div', { class: 'review-mention-avatar' }, [initials(u.name)]),
          el('div', {}, [
            el('strong', {}, [u.name]),
            el('span', {}, [u.email]),
          ]),
        ]));
      });

      document.body.appendChild(dropdown);
      const rect = textarea.getBoundingClientRect();
      dropdown.style.left = `${Math.max(8, rect.left)}px`;
      dropdown.style.top = `${rect.bottom + 6}px`;

      function insertMention(user, startAt) {
        const after = val.slice(pos);
        textarea.value = `${val.slice(0, startAt)}@${user.name} ${after}`;
        const newPos = startAt + user.name.length + 2;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
        removeDropdown();
        updateTagPreview(textarea, tagPreview);
      }

      dropdown._insert = (user) => insertMention(user, atIdx);
    });

    textarea.addEventListener('keydown', (e) => {
      if (!dropdown) return;
      const items = dropdown.querySelectorAll('.review-mention-item');
      const before = textarea.value.slice(0, textarea.selectionStart);
      const atIdx = before.lastIndexOf('@');
      const query = atIdx >= 0 ? before.slice(atIdx + 1) : '';
      const matches = getMatches(query);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
        items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
        items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
      } else if (e.key === 'Enter' && dropdown) {
        e.preventDefault();
        const u = matches[selectedIdx];
        if (u && dropdown._insert) dropdown._insert(u);
      } else if (e.key === 'Tab' && dropdown) {
        e.preventDefault();
        const u = matches[selectedIdx];
        if (u && dropdown._insert) dropdown._insert(u);
      } else if (e.key === 'Escape') {
        removeDropdown();
      }
    });

    function removeDropdown() {
      document.querySelectorAll('.review-mention-dropdown').forEach((d) => d.remove());
      dropdown = null;
    }
  }

  async function loadComments() {
    try {
      const res = await fetch(withProject('/api/comments'), { headers: ReviewAuth.headers() });
      if (!res.ok) return;
      const data = await res.json();
      state.comments = data.comments || [];
    } catch {
      /* ignore */
    }
  }

  async function loadUsers() {
    try {
      const res = await fetch(withProject('/api/users'), { headers: ReviewAuth.headers() });
      if (!res.ok) return;
      const data = await res.json();
      state.users = data.users || [];
    } catch {
      /* ignore */
    }
  }

  function pageComments() {
    return state.comments.filter((c) => samePage(c.page, page) && !c.resolved);
  }

  function renderPins() {
    const layer = document.getElementById('review-pins-layer');
    layer.innerHTML = '';
    layer.style.height = `${document.documentElement.scrollHeight}px`;

    // Drop selections that no longer exist / are resolved
    const openIds = new Set(pageComments().map((c) => c.id));
    [...state.selectedIds].forEach((id) => {
      if (!openIds.has(id)) state.selectedIds.delete(id);
    });

    const comments = pageComments();
    comments.forEach((c, i) => {
      const docW = document.documentElement.scrollWidth;
      const docH = document.documentElement.scrollHeight;
      const left = (c.x / 100) * docW;
      const top = (c.y / 100) * docH;
      const isSelected = state.selectedIds.has(c.id);

      const selectBtn = el('button', {
        type: 'button',
        class: `review-pin-select${isSelected ? ' is-on' : ''}`,
        title: isSelected ? 'Deselect' : 'Select for Fix with Cursor',
        'aria-label': isSelected ? 'Deselect comment' : 'Select comment',
        'aria-pressed': isSelected ? 'true' : 'false',
        onclick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          toggleCommentSelected(c.id);
        },
      }, [isSelected ? icon('check', 12) : null].filter(Boolean));

      const pin = el('div', {
        class: [
          'review-pin',
          state.highlightId === c.id ? 'highlight' : '',
          isSelected ? 'selected' : '',
        ].filter(Boolean).join(' '),
        style: `left:${left}px;top:${top}px`,
        onclick: (e) => {
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey || e.shiftKey) {
            toggleCommentSelected(c.id);
            return;
          }
          openViewBubble(c);
        },
        'data-id': c.id,
      }, [
        selectBtn,
        el('div', { class: 'review-pin-dot' }, [
          el('span', { class: 'review-pin-number' }, [String(i + 1)]),
        ]),
        (c.replies?.length)
          ? el('span', { class: 'review-pin-replies' }, [String(c.replies.length)])
          : null,
      ].filter(Boolean));

      layer.appendChild(pin);
    });

    renderSelectionBar();
  }

  function toggleCommentSelected(id) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    renderPins();
  }

  function clearSelection() {
    state.selectedIds.clear();
    renderPins();
  }

  function getSelectedComments() {
    return state.comments.filter((c) => state.selectedIds.has(c.id) && !c.resolved);
  }

  function ensureSelectionBar() {
    if (document.getElementById('review-selection-bar')) return;

    const bar = el('div', { class: 'review-selection-bar', id: 'review-selection-bar' }, [
      el('span', { class: 'review-selection-count', id: 'review-selection-count' }, ['0 selected']),
      el('div', { class: 'review-selection-actions' }, [
        el('button', {
          type: 'button',
          class: 'review-btn',
          onclick: (e) => {
            e.stopPropagation();
            clearSelection();
          },
        }, btnContent('x', 'Clear', 14)),
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-fix',
          id: 'review-fix-selected',
          onclick: (e) => {
            e.stopPropagation();
            fixSelectedWithCursor(e.currentTarget);
          },
        }, btnContent('sparkle', 'Fix selected', 14)),
      ]),
    ]);
    document.body.appendChild(bar);
  }

  function renderSelectionBar() {
    ensureSelectionBar();
    const bar = document.getElementById('review-selection-bar');
    const count = document.getElementById('review-selection-count');
    const n = getSelectedComments().length;
    if (count) count.textContent = `${n} selected`;
    if (bar) bar.classList.toggle('open', n > 0);
  }

  function buildBubbleHeader({ authorName, title, trailing }) {
    const closeBtn = el('button', {
      type: 'button',
      class: 'review-bubble-close',
      'aria-label': 'Close',
      title: 'Close',
      onclick: (e) => {
        e.stopPropagation();
        closeBubble();
      },
    }, [icon('x', 16)]);

    return el('div', {
      class: 'review-bubble-header review-bubble-header-brand review-bubble-drag-handle',
    }, [
      el('div', { class: 'review-bubble-header-left' }, [
        el('div', { class: 'review-avatar review-avatar-sm' }, [initials(authorName)]),
        el('span', { class: 'review-bubble-author' }, [title || authorName]),
      ]),
      el('div', { class: 'review-bubble-header-right' }, [
        trailing || null,
        closeBtn,
      ].filter(Boolean)),
    ]);
  }

  function enableBubbleDrag(bubble) {
    const handle = bubble.querySelector('.review-bubble-drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, textarea, .review-bubble-close')) return;

      const rect = bubble.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = rect.left;
      const origTop = rect.top;
      bubble.classList.add('is-dragging');
      e.preventDefault();

      const onMove = (ev) => {
        const pad = 8;
        let left = origLeft + (ev.clientX - startX);
        let top = origTop + (ev.clientY - startY);
        const maxLeft = Math.max(pad, window.innerWidth - bubble.offsetWidth - pad);
        const maxTop = Math.max(pad, window.innerHeight - 48);
        left = Math.min(Math.max(pad, left), maxLeft);
        top = Math.min(Math.max(pad, top), maxTop);
        bubble.style.left = `${left}px`;
        bubble.style.top = `${top}px`;
      };

      const onUp = () => {
        bubble.classList.remove('is-dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function openViewBubble(comment, showReplyForm = false, resolvedPanel = false) {
    closeBubble();
    loadUsers();

    const fresh = state.comments.find((c) => c.id === comment.id) || comment;
    state.viewingCommentId = fresh.id;
    const replies = fresh.replies || [];

    const bubble = el('div', {
      class: `review-bubble review-bubble-thread${resolvedPanel ? ' review-bubble-resolved' : ''}`,
      id: 'review-active-bubble',
    });

    bubble.appendChild(buildBubbleHeader({
      authorName: fresh.authorName,
      title: fresh.authorName,
      trailing: el('span', { class: 'review-bubble-time review-bubble-time-on-dark' }, [
        resolvedPanel ? 'Resolved · ' : '',
        formatTime(fresh.createdAt),
      ]),
    }));

    const body = el('div', { class: 'review-bubble-body' });
    body.appendChild(buildCommentTextEl(fresh.text, fresh.tags));
    attachScreenshotBlock(body, fresh);
    bubble.appendChild(body);

    if (replies.length) {
      const repliesSection = el('div', { class: 'review-replies' }, [
        el('div', { class: 'review-replies-header' }, [
          `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`,
        ]),
        el('div', { class: 'review-replies-list' }, replies.map((r) => {
          const replyEl = el('div', { class: 'review-reply' }, [
            el('div', { class: 'review-reply-header' }, [
              el('span', { class: 'review-reply-author' }, [r.authorName]),
              el('span', { class: 'review-reply-time' }, [formatTime(r.createdAt)]),
            ]),
          ]);
          replyEl.appendChild(buildCommentTextEl(r.text, r.tags, 'review-reply-text'));
          return replyEl;
        })),
      ]);
      bubble.appendChild(repliesSection);
    }

    const replyFormWrap = el('div', { class: 'review-reply-form', id: 'review-reply-form-wrap' });
    const replyTagPreview = el('div', { class: 'review-tag-preview', id: 'review-reply-tag-preview' });
    const replyTextarea = el('textarea', {
      class: 'review-textarea',
      placeholder: 'Write a reply… Type @ to tag someone',
    });

    replyFormWrap.appendChild(replyTextarea);
    replyFormWrap.appendChild(replyTagPreview);
    replyFormWrap.appendChild(el('div', { class: 'review-bubble-actions' }, [
      el('button', {
        type: 'button',
        class: 'review-btn review-btn-primary',
        id: 'review-reply-btn',
        onclick: (e) => {
          e.stopPropagation();
          submitReply(fresh.id, replyTextarea);
        },
      }, btnContent('reply', 'Post reply', 14)),
    ]));

    const canReply = !showReplyForm && !replies.length;
    if (!canReply) bubble.appendChild(replyFormWrap);
    bubble.appendChild(buildThreadActions(fresh, canReply));

    bubble.addEventListener('click', (e) => e.stopPropagation());
    bubble.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(bubble);
    enableBubbleDrag(bubble);

    if (resolvedPanel) {
      positionBubbleResolved(bubble);
    } else {
      positionBubbleNearComment(bubble, fresh);
    }

    setupMentions(replyTextarea, replyTagPreview);
    replyTextarea.addEventListener('input', () => updateTagPreview(replyTextarea, replyTagPreview));
    if (showReplyForm || replies.length) replyTextarea.focus();
    state.activeBubble = bubble;
  }

  function buildThreadActions(comment, showReplyButton) {
    const isAuthor = comment.authorId === ReviewAuth.getUser()?.id;

    const fixBtn = el('button', {
      type: 'button',
      class: 'review-action review-action-primary',
      'data-tip': 'Start a Cursor agent to implement this',
      onclick: (e) => {
        e.stopPropagation();
        fixCommentWithCursor(comment, e.currentTarget);
      },
    }, [icon('sparkle'), el('span', { 'data-btn-label': '' }, ['Fix with Cursor'])]);

    const promptBtn = el('button', {
      type: 'button',
      class: 'review-action review-action-icon',
      'data-icon-only': '',
      'data-tip': 'Copy Cursor prompt',
      'data-tip-align': 'end',
      'aria-label': 'Copy Cursor prompt',
      onclick: (e) => {
        e.stopPropagation();
        copyCommentPrompt(comment, e.currentTarget);
      },
    }, [icon('copy')]);

    const resolveBtn = el('button', {
      type: 'button',
      class: 'review-action review-action-ghost review-action-resolve',
      onclick: (e) => {
        e.stopPropagation();
        toggleResolved(comment);
      },
    }, [
      icon(comment.resolved ? 'reopen' : 'checkCircle'),
      el('span', {}, [comment.resolved ? 'Reopen' : 'Resolve']),
    ]);

    const secondary = el('div', { class: 'review-action-row' }, [
      showReplyButton
        ? el('button', {
          type: 'button',
          class: 'review-action review-action-ghost',
          onclick: (e) => {
            e.stopPropagation();
            openViewBubble(comment, true);
          },
        }, [icon('reply'), el('span', {}, ['Reply'])])
        : null,
      resolveBtn,
      isAuthor
        ? el('button', {
          type: 'button',
          class: 'review-action review-action-icon review-action-danger',
          'data-tip': 'Delete comment',
          'data-tip-align': 'end',
          'aria-label': 'Delete comment',
          onclick: (e) => {
            e.stopPropagation();
            deleteComment(comment.id);
          },
        }, [icon('trash')])
        : null,
    ].filter(Boolean));

    return el('div', {
      class: `review-bubble-resolve${comment.resolved ? ' review-bubble-resolve-done' : ''}`,
    }, [
      el('div', { class: 'review-action-row' }, [fixBtn, promptBtn]),
      secondary,
    ]);
  }

  async function submitReply(parentId, textarea) {
    const text = textarea.value.trim();
    if (!text) {
      alert('Please enter a reply before posting.');
      return;
    }

    const btn = document.getElementById('review-reply-btn');
    if (btn) {
      btn.disabled = true;
      setButtonContent(btn, 'reply', 'Posting…', 14);
    }

    const tags = parseTags(text);

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: ReviewAuth.headers(),
        body: JSON.stringify({ projectId, parentId, text, tags }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post reply');
      }

      await loadComments();
      await loadNotifications();
      renderPins();
      renderSidebar();
      renderNotificationBadge();

      const updated = state.comments.find((c) => c.id === parentId);
      if (updated) openViewBubble(updated, true);
    } catch (err) {
      alert(err.message || 'Failed to post reply');
      if (btn) {
        btn.disabled = false;
        setButtonContent(btn, 'reply', 'Post reply', 14);
      }
    }
  }

  async function toggleResolved(comment) {
    const wasResolved = comment.resolved;
    await fetch('/api/comments', {
      method: 'PATCH',
      headers: ReviewAuth.headers(),
      body: JSON.stringify({ id: comment.id, projectId, resolved: !comment.resolved }),
    });
    closeBubble();
    await loadComments();
    if (!wasResolved) {
      state.sidebarTab = 'resolved';
      setSidebarTab('resolved');
    } else {
      state.sidebarTab = 'open';
      setSidebarTab('open');
    }
    renderPins();
    renderSidebar();
  }

  async function deleteComment(id) {
    if (!confirm('Delete this comment?')) return;
    await fetch(
      `/api/comments?id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(projectId)}`,
      {
        method: 'DELETE',
        headers: ReviewAuth.headers(),
      }
    );
    closeBubble();
    await loadComments();
    renderPins();
    renderSidebar();
  }

  function renderSidebar() {
    const list = document.getElementById('review-sidebar-list');
    const count = document.getElementById('review-count');
    if (!list) return;

    const openItems = openComments();
    const resolvedItems = resolvedComments();
    const items = sidebarComments();
    if (count) count.textContent = String(items.length);

    const openCountEl = document.getElementById('review-tab-open-count');
    const resolvedCountEl = document.getElementById('review-tab-resolved-count');
    if (openCountEl) openCountEl.textContent = String(openItems.length);
    if (resolvedCountEl) resolvedCountEl.textContent = String(resolvedItems.length);

    if (!items.length) {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'review-sidebar-empty' }, [
        icon(state.sidebarTab === 'resolved' ? 'checkCircle' : 'chat', 28),
        el('p', {}, [
          state.sidebarTab === 'resolved'
            ? 'No resolved comments yet.'
            : 'No open comments yet.',
        ]),
        el('span', {}, [
          state.sidebarTab === 'resolved'
            ? 'Resolve a thread to archive it here.'
            : 'Use Add comment, then click anywhere on the page.',
        ]),
      ]));
      updateSidebarActionButtons(openItems.length);
      return;
    }

    list.innerHTML = '';
    items.forEach((c) => {
      const replyCount = c.replies?.length || 0;
      const textEl = el('div', { class: 'review-sidebar-item-text' });
      appendFormattedCommentText(textEl, c.text, c.tags, true);

      const badges = el('div', { class: 'review-sidebar-item-badges' });
      if (c.screenshot) {
        badges.appendChild(el('span', { class: 'review-sidebar-chip' }, [
          icon('camera', 12),
          el('span', {}, ['Snapshot']),
        ]));
      }
      if (replyCount) {
        badges.appendChild(el('span', { class: 'review-sidebar-chip' }, [
          icon('reply', 12),
          el('span', {}, [`${replyCount}`]),
        ]));
      }

      const actions = el('div', {
        class: 'review-sidebar-item-actions',
        onclick: (e) => e.stopPropagation(),
      }, [
        el('button', {
          type: 'button',
          class: 'review-sidebar-prompt-btn',
          title: 'Copy Cursor prompt',
          onclick: (e) => {
            e.stopPropagation();
            copyCommentPrompt(c, e.currentTarget);
          },
        }, btnContent('copy', 'Prompt', 14)),
        el('button', {
          type: 'button',
          class: 'review-sidebar-fix-btn',
          title: 'Fix with Cursor agent',
          onclick: (e) => {
            e.stopPropagation();
            fixCommentWithCursor(c, e.currentTarget);
          },
        }, btnContent('sparkle', 'Fix', 14)),
      ]);

      const item = el('div', {
        class: `review-sidebar-item${state.highlightId === c.id ? ' active' : ''}${state.selectedIds.has(c.id) ? ' selected' : ''}`,
        onclick: () => navigateToComment(c),
      }, [
        el('div', { class: 'review-sidebar-item-top' }, [
          el('div', { class: 'review-sidebar-item-page' }, [formatPage(c.page)]),
          el('span', { class: 'review-sidebar-item-time' }, [formatTime(c.createdAt)]),
        ]),
        textEl,
        badges.childNodes.length ? badges : null,
        el('div', { class: 'review-sidebar-item-meta' }, [
          el('span', { class: 'review-sidebar-item-author' }, [c.authorName]),
        ]),
        !c.resolved ? actions : null,
      ].filter(Boolean));
      list.appendChild(item);
    });

    updateSidebarActionButtons(openItems.length);
  }

  function updateSidebarActionButtons(openCount) {
    const canFix = Boolean(project.repoUrl || project.localPath || project.type === 'github');
    const copyAllBtn = document.getElementById('review-copy-all-prompts');
    const fixAllBtn = document.getElementById('review-fix-all');

    if (copyAllBtn) {
      copyAllBtn.disabled = openCount === 0;
      setButtonContent(
        copyAllBtn,
        'copy',
        openCount === 0 ? 'No prompts' : `Copy ${openCount}`
      );
      copyAllBtn.title =
        openCount === 0
          ? 'No open comments to copy'
          : `Copy Cursor prompts for ${openCount} open comment${openCount === 1 ? '' : 's'}`;
    }

    if (fixAllBtn) {
      fixAllBtn.disabled = openCount === 0 || !canFix;
      setButtonContent(
        fixAllBtn,
        'sparkle',
        !canFix ? 'Set repo' : openCount === 0 ? 'Nothing to fix' : `Fix ${openCount}`
      );
      fixAllBtn.title = !canFix
        ? 'Add a GitHub repo in project Settings to enable Fix with Cursor'
        : openCount === 0
          ? 'No open comments to fix'
          : `Start a Cursor agent for ${openCount} open comment${openCount === 1 ? '' : 's'}`;
    }
  }

  async function copyCommentPrompt(comment, btn) {
    if (!window.ReviewPrompts) {
      alert('Prompt helper failed to load');
      return;
    }
    const text = ReviewPrompts.buildCursorPrompt(comment, project);
    try {
      await ReviewPrompts.copyText(text);
      flashCopied(btn, 'Copied');
      showPromptToast('Cursor prompt copied — paste it into Cursor Agent');
    } catch (err) {
      alert(err.message || 'Could not copy');
    }
  }

  async function copyAllOpenPrompts() {
    if (!window.ReviewPrompts) {
      alert('Prompt helper failed to load');
      return;
    }
    const text = ReviewPrompts.buildAllOpenPrompts(state.comments, project);
    if (!text) {
      showPromptToast('No open comments to copy');
      return;
    }
    try {
      await ReviewPrompts.copyText(text);
      const btn = document.getElementById('review-copy-all-prompts');
      flashCopied(btn, 'Copied to clipboard');
      showPromptToast('All open comments copied as Cursor prompts');
    } catch (err) {
      alert(err.message || 'Could not copy');
    }
  }

  function preferredFixMode() {
    if (project.localPath && !(project.repoUrl || project.type === 'github')) return 'local';
    return 'cloud';
  }

  const cursorFixDraft = {
    commentId: null,
    commentIds: null,
    scope: 'comment',
    triggerBtn: null,
  };

  function ensureCursorFixModal() {
    if (document.getElementById('review-cursor-fix-modal')) return;

    const backdrop = el('div', {
      class: 'review-cursor-fix-backdrop',
      id: 'review-cursor-fix-modal',
      onclick: (e) => {
        if (e.target.id === 'review-cursor-fix-modal') closeCursorFixModal();
      },
    });

    const panel = el('div', { class: 'review-cursor-fix-panel' }, [
      el('div', { class: 'review-cursor-fix-header' }, [
        el('h3', { id: 'review-cursor-fix-title' }, ['Fix with Cursor']),
        el('button', {
          type: 'button',
          class: 'review-cursor-fix-close',
          'aria-label': 'Close',
          onclick: closeCursorFixModal,
        }, [icon('x', 16)]),
      ]),
      el('p', { class: 'review-cursor-fix-sub', id: 'review-cursor-fix-sub' }, [
        'Review and edit the prompt before sending it to Cursor.',
      ]),
      el('label', { class: 'review-cursor-fix-label', for: 'review-cursor-fix-text' }, ['Prompt']),
      el('textarea', {
        class: 'review-cursor-fix-text',
        id: 'review-cursor-fix-text',
        rows: 14,
      }),
      el('div', { class: 'review-cursor-fix-delivery', id: 'review-cursor-fix-delivery' }, [
        el('p', { class: 'review-cursor-fix-label' }, ['When the agent finishes']),
        el('label', { class: 'review-cursor-fix-radio' }, [
          el('input', {
            type: 'radio',
            name: 'cursor-delivery',
            value: 'pr',
            id: 'cursor-delivery-pr',
            checked: true,
          }),
          el('span', {}, [
            el('strong', {}, ['Open a pull request']),
            ' — recommended; review changes before merging',
          ]),
        ]),
        el('label', { class: 'review-cursor-fix-radio' }, [
          el('input', {
            type: 'radio',
            name: 'cursor-delivery',
            value: 'main',
            id: 'cursor-delivery-main',
          }),
          el('span', {}, [
            el('strong', {}, ['Push to main']),
            ` — commits go directly to ${project.repoRef || 'main'}`,
          ]),
        ]),
      ]),
      el('p', { class: 'review-cursor-fix-note', id: 'review-cursor-fix-local-note', hidden: true }, [
        'Local agents apply changes in your project folder on this machine. Delivery options apply to cloud agents only.',
      ]),
      el('div', { class: 'review-cursor-fix-error', id: 'review-cursor-fix-error' }),
      el('div', { class: 'review-cursor-fix-actions' }, [
        el('button', {
          type: 'button',
          class: 'review-btn',
          onclick: closeCursorFixModal,
        }, btnContent('x', 'Cancel', 14)),
        el('button', {
          type: 'button',
          class: 'review-btn review-btn-fix',
          id: 'review-cursor-fix-send',
          onclick: submitCursorFixFromModal,
        }, btnContent('sparkle', 'Send to Cursor', 14)),
      ]),
    ]);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  function closeCursorFixModal() {
    const modal = document.getElementById('review-cursor-fix-modal');
    if (modal) modal.classList.remove('open');
    cursorFixDraft.commentId = null;
    cursorFixDraft.commentIds = null;
    cursorFixDraft.scope = 'comment';
    cursorFixDraft.triggerBtn = null;
    const err = document.getElementById('review-cursor-fix-error');
    if (err) {
      err.textContent = '';
      err.classList.remove('show');
    }
  }

  function openCursorFixModal({ comment, scope, commentIds }) {
    ensureCursorFixModal();
    if (!window.ReviewPrompts) {
      alert('Prompt helper failed to load');
      return;
    }

    cursorFixDraft.commentId = comment?.id || null;
    cursorFixDraft.commentIds = commentIds || null;
    cursorFixDraft.scope = scope || (commentIds?.length ? 'selected' : comment ? 'comment' : 'all');

    let promptText = '';
    let selectedList = [];
    if (cursorFixDraft.scope === 'all') {
      promptText = ReviewPrompts.buildAllOpenPrompts(state.comments, project);
      if (!promptText) {
        showPromptToast('No open comments to fix');
        return;
      }
    } else if (cursorFixDraft.scope === 'selected') {
      selectedList = (commentIds || [])
        .map((id) => state.comments.find((c) => c.id === id))
        .filter((c) => c && !c.resolved);
      promptText = ReviewPrompts.buildCommentsPrompts(selectedList, project);
      if (!promptText) {
        showPromptToast('No selected comments to fix');
        return;
      }
    } else if (comment) {
      promptText = ReviewPrompts.buildCursorPrompt(comment, project);
    }

    const title = document.getElementById('review-cursor-fix-title');
    const sub = document.getElementById('review-cursor-fix-sub');
    const textarea = document.getElementById('review-cursor-fix-text');
    const delivery = document.getElementById('review-cursor-fix-delivery');
    const localNote = document.getElementById('review-cursor-fix-local-note');
    const isCloud = preferredFixMode() === 'cloud';

    if (title) {
      if (cursorFixDraft.scope === 'all') title.textContent = 'Fix all open comments';
      else if (cursorFixDraft.scope === 'selected') {
        title.textContent = `Fix ${selectedList.length} selected comment${selectedList.length === 1 ? '' : 's'}`;
      } else {
        title.textContent = 'Fix with Cursor';
      }
    }
    if (sub) {
      if (cursorFixDraft.scope === 'all') {
        sub.textContent = 'Edit the combined prompt for all open comments, then send to Cursor.';
      } else if (cursorFixDraft.scope === 'selected') {
        sub.textContent = 'Edit the prompt for your selected comments, then send to Cursor as one agent.';
      } else {
        sub.textContent = 'Review and edit the prompt for this comment before sending it to Cursor.';
      }
    }
    if (textarea) textarea.value = promptText;

    const defaultPr = project.autoCreatePR !== false;
    const prRadio = document.getElementById('cursor-delivery-pr');
    const mainRadio = document.getElementById('cursor-delivery-main');
    if (prRadio) prRadio.checked = defaultPr;
    if (mainRadio) mainRadio.checked = !defaultPr;

    if (delivery) delivery.hidden = !isCloud;
    if (localNote) localNote.hidden = isCloud;

    const modal = document.getElementById('review-cursor-fix-modal');
    if (modal) {
      modal.classList.add('open');
      textarea?.focus();
    }
  }

  function fixCommentWithCursor(comment, btn) {
    cursorFixDraft.triggerBtn = btn || null;
    openCursorFixModal({ comment, scope: 'comment' });
  }

  function fixAllOpenWithCursor(btn) {
    cursorFixDraft.triggerBtn = btn || null;
    openCursorFixModal({ scope: 'all' });
  }

  function fixSelectedWithCursor(btn) {
    const selected = getSelectedComments();
    if (!selected.length) {
      showPromptToast('Select comments on the page first');
      return;
    }
    cursorFixDraft.triggerBtn = btn || null;
    openCursorFixModal({
      scope: 'selected',
      commentIds: selected.map((c) => c.id),
    });
  }

  async function submitCursorFixFromModal() {
    const textarea = document.getElementById('review-cursor-fix-text');
    const errEl = document.getElementById('review-cursor-fix-error');
    const sendBtn = document.getElementById('review-cursor-fix-send');
    const prompt = (textarea?.value || '').trim();

    if (!prompt) {
      if (errEl) {
        errEl.textContent = 'Prompt cannot be empty.';
        errEl.classList.add('show');
      }
      return;
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.remove('show');
    }

    const isCloud = preferredFixMode() === 'cloud';
    const mainRadio = document.getElementById('cursor-delivery-main');
    const pushToMain = isCloud && mainRadio?.checked;
    const autoCreatePR = isCloud && !pushToMain;

    if (sendBtn) {
      sendBtn.disabled = true;
      setButtonContent(sendBtn, 'sparkle', 'Sending…', 14);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);

    try {
      const payload = {
        projectId,
        prompt,
        mode: preferredFixMode(),
        scope: cursorFixDraft.scope,
      };
      if (cursorFixDraft.scope === 'all') {
        payload.scope = 'all';
      } else if (cursorFixDraft.scope === 'selected' && cursorFixDraft.commentIds?.length) {
        payload.scope = 'selected';
        payload.commentIds = cursorFixDraft.commentIds;
      } else if (cursorFixDraft.commentId) {
        payload.commentId = cursorFixDraft.commentId;
      }
      if (isCloud) {
        payload.workOnCurrentBranch = pushToMain;
        payload.autoCreatePR = autoCreatePR;
      }

      const res = await fetch('/api/cursor-fix', {
        method: 'POST',
        headers: ReviewAuth.headers(),
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start agent');

      const triggerBtn = cursorFixDraft.triggerBtn;
      const wasSelected = cursorFixDraft.scope === 'selected';
      closeCursorFixModal();
      if (wasSelected) clearSelection();
      showPromptToast(data.message || 'Cursor agent started');
      if (data.agentUrl) window.open(data.agentUrl, '_blank', 'noopener');

      if (triggerBtn) flashCopied(triggerBtn, 'Started');
    } catch (err) {
      const msg =
        err.name === 'AbortError'
          ? 'Timed out starting the agent. Try again.'
          : err.message || 'Could not start Cursor agent';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.add('show');
      } else {
        alert(msg);
      }
    } finally {
      clearTimeout(timer);
      if (sendBtn) {
        sendBtn.disabled = false;
        setButtonContent(sendBtn, 'sparkle', 'Send to Cursor', 14);
      }
    }
  }

  function flashCopied(btn, label) {
    if (!btn) return;
    btn.classList.add('copied');

    // Icon buttons only flash colour, otherwise the swap would drop their SVG.
    const target = btn.hasAttribute('data-icon-only')
      ? null
      : btn.querySelector('[data-btn-label]') || btn;

    if (target) {
      const prev = target.dataset.label || target.textContent;
      target.dataset.label = prev;
      target.textContent = label || 'Copied';
    }

    setTimeout(() => {
      btn.classList.remove('copied');
      if (target) target.textContent = target.dataset.label;
    }, 1600);
  }

  function showPromptToast(message) {
    let host = document.getElementById('review-live-toasts');
    if (!host) {
      host = el('div', { class: 'review-live-toasts', id: 'review-live-toasts' });
      document.body.appendChild(host);
    }
    const toast = el('div', { class: 'review-live-toast review-prompt-toast' }, [message]);
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function navigateToComment(comment) {
    if (comment.resolved) {
      if (!samePage(comment.page, page)) {
        window.location.href = pageHref(comment.page, `comment=${comment.id}&resolved=1`);
        return;
      }
      openViewBubble(comment, false, true);
      return;
    }

    if (samePage(comment.page, page)) {
      scrollToComment(comment);
    } else {
      window.location.href = pageHref(comment.page, `comment=${comment.id}`);
    }
  }

  function scrollToComment(comment) {
    state.highlightId = comment.id;
    closeBubble();

    const docH = document.documentElement.scrollHeight;
    const pinTop = (comment.y / 100) * docH;
    const targetScroll = Math.max(0, pinTop - window.innerHeight / 3);
    window.scrollTo({ top: targetScroll, behavior: 'smooth' });
    renderPins();
    renderSidebar();

    const openAtPin = () => {
      openViewBubble(comment);
    };

    if (Math.abs(window.scrollY - targetScroll) < 4) {
      openAtPin();
    } else {
      let opened = false;
      const onScroll = () => {
        if (opened) return;
        if (Math.abs(window.scrollY - targetScroll) < 24) {
          opened = true;
          window.removeEventListener('scroll', onScroll);
          openAtPin();
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      setTimeout(() => {
        window.removeEventListener('scroll', onScroll);
        if (!opened) openAtPin();
      }, 700);
    }

    setTimeout(() => {
      state.highlightId = null;
      renderPins();
      renderSidebar();
    }, 3500);
  }

  function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('comment');
    if (!id) return;

    const comment = state.comments.find((c) => c.id === id);
    if (!comment) return;

    if (comment.resolved || params.get('resolved') === '1') {
      state.sidebarTab = 'resolved';
      setSidebarTab('resolved');
      setTimeout(() => openViewBubble(comment, false, true), 300);
      return;
    }

    setTimeout(() => scrollToComment(comment), 300);
  }

  function closeBubble() {
    const bubble = document.getElementById('review-active-bubble');
    if (bubble) bubble.remove();
    document.querySelectorAll('.review-mention-dropdown').forEach((d) => d.remove());
    state.activeBubble = null;
    state.viewingCommentId = null;
  }

  function positionBubble(bubble, clientX, clientY) {
    const pad = 12;
    const rect = bubble.getBoundingClientRect();
    let left = clientX + pad;
    let top = clientY + pad;

    if (left + 360 > window.innerWidth) left = clientX - 360 - pad;
    if (top + rect.height > window.innerHeight) top = clientY - rect.height - pad;

    bubble.style.position = 'fixed';
    bubble.style.left = `${Math.max(pad, left)}px`;
    bubble.style.top = `${Math.max(pad + 48, top)}px`;
  }

  function positionBubbleResolved(bubble) {
    const pad = 16;
    const sidebarW = state.sidebarOpen ? 340 : 0;
    bubble.style.position = 'fixed';
    bubble.style.left = `${sidebarW + pad}px`;
    bubble.style.top = `${64 + pad}px`;
    bubble.style.maxHeight = `calc(100vh - ${64 + pad * 2}px)`;
  }

  function formatPage(p) {
    return p.replace('.html', '').replace(/-/g, ' ') || 'home';
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function initials(name) {
    return (name || '?')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'style') node.setAttribute('style', v);
        else node.setAttribute(k, v);
      });
    }
    const list = children || [];
    list.forEach((child) => {
      if (child == null) return;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    });
    return node;
  }

  window.addEventListener('resize', renderPins);
  window.addEventListener('scroll', () => {
    /* pins are document-positioned, no update needed */
  });
})();
