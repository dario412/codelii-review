/**
 * Shared app chrome: collapsible sidebar, plan status, and user menu.
 */
window.AppShell = (function () {
  const COLLAPSE_KEY = 'codelii_sidebar_collapsed';
  const LIVE = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete'];

  let planEl = null;
  let menuOpen = false;
  let menuRoot = null;
  let triggerBtn = null;
  let onManageBilling = null;

  function initials(n) {
    return String(n || '?')
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function daysLeft(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
  }

  function isCollapsed() {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  }

  function setCollapsed(collapsed) {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    document.body.classList.toggle('app-sidebar-collapsed', collapsed);
    const btn = document.getElementById('sidebar-collapse');
    if (btn) {
      btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
    closeMenu();
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    if (menuRoot) menuRoot.hidden = true;
    if (triggerBtn) {
      triggerBtn.setAttribute('aria-expanded', 'false');
      triggerBtn.classList.remove('open');
    }
  }

  function openMenu() {
    if (!menuRoot || !triggerBtn) return;
    menuOpen = true;
    menuRoot.hidden = false;
    triggerBtn.setAttribute('aria-expanded', 'true');
    triggerBtn.classList.add('open');
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
  }

  function menuItem(icon, label, onClick, { danger = false } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `app-user-menu-item${danger ? ' danger' : ''}`;
    btn.innerHTML = Icons.svg(icon, 16);
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      // Defer so the menu finishes closing before the action runs.
      setTimeout(() => {
        try {
          onClick();
        } catch (err) {
          console.error('[AppShell] menu action failed', err);
        }
      }, 0);
    });
    return btn;
  }

  function menuSep() {
    const hr = document.createElement('div');
    hr.className = 'app-user-menu-sep';
    hr.setAttribute('role', 'separator');
    return hr;
  }

  function renderUserMenu(user, options = {}) {
    const host = document.getElementById('user-chip');
    if (!host || !user) return;

    host.innerHTML = '';
    host.className = 'dash-user app-user-wrap';

    const wrap = document.createElement('div');
    wrap.className = 'app-user-menu-anchor';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'user-chip app-user-trigger';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Account menu');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(user.name);

    const text = document.createElement('div');
    text.className = 'who';
    const name = document.createElement('strong');
    name.textContent = user.name || 'Account';
    const email = document.createElement('span');
    email.textContent = user.email || '';
    text.append(name, email);

    const chevron = document.createElement('span');
    chevron.className = 'app-user-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = Icons.svg('chevronDown', 14);

    btn.append(avatar, text, chevron);
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleMenu();
    };

    const menu = document.createElement('div');
    menu.className = 'app-user-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    if (user.guest !== true) {
      const goAccount = typeof options.onAccount === 'function'
        ? options.onAccount
        : () => { window.location.href = '/account.html'; };
      menu.appendChild(menuItem('settings', 'Account settings', goAccount));
      menu.appendChild(menuSep());
    }
    menu.appendChild(
      menuItem('signOut', 'Log out', () => ReviewAuth.logout(), { danger: true }),
    );

    wrap.append(menu, btn);
    host.appendChild(wrap);

    menuRoot = menu;
    triggerBtn = btn;
    onManageBilling = options.onAccount || onManageBilling;
  }

  let menuOptions = {};

  function setMenuOptions(options = {}) {
    menuOptions = { ...menuOptions, ...options };
    const user = menuOptions.user || ReviewAuth.getUser();
    if (user) renderUserMenu(user, menuOptions);
  }

  function paintPlan(billing, options = {}) {
    if (!planEl) planEl = document.getElementById('sidebar-plan');
    if (!planEl) return;

    const guest = options.guest === true || ReviewAuth.getUser()?.guest === true;
    if (guest || !billing || billing.configured === false) {
      planEl.hidden = true;
      planEl.innerHTML = '';
      return;
    }

    const status = billing.status || 'none';
    const manage = () => {
      if (typeof options.onManage === 'function') options.onManage(billing);
      else if (typeof onManageBilling === 'function') onManageBilling();
    };

    planEl.className = 'app-sidebar-plan';
    planEl.hidden = false;
    planEl.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'app-sidebar-plan-row';

    const label = document.createElement('span');
    label.className = 'app-sidebar-plan-label';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'app-sidebar-plan-action';

    const bar = document.createElement('div');
    bar.className = 'app-sidebar-plan-bar';
    const fill = document.createElement('span');
    fill.className = 'app-sidebar-plan-fill';
    bar.appendChild(fill);

    let showBar = false;

    switch (status) {
      case 'trialing': {
        const total = Math.max(1, Number(billing.trialDays) || 7);
        const left = daysLeft(billing.trialEnd);
        label.textContent = left === 1 ? '1 trial day left' : `${left} trial days left`;
        action.textContent = 'Upgrade';
        fill.style.width = `${Math.max(4, Math.min(100, (left / total) * 100))}%`;
        showBar = true;
        planEl.classList.add('trial');
        break;
      }
      case 'active':
        if (billing.agency && !billing.hasCustomer) {
          label.textContent = 'Agency plan';
          action.hidden = true;
          fill.style.width = '100%';
          showBar = true;
          planEl.classList.add('active');
          break;
        }
        label.textContent = billing.cancelAtPeriodEnd ? 'Cancels soon' : 'Pro plan';
        action.textContent = 'Manage';
        fill.style.width = '100%';
        showBar = true;
        planEl.classList.add('active');
        break;
      case 'past_due':
      case 'unpaid':
      case 'incomplete':
        label.textContent = 'Payment issue';
        action.textContent = 'Fix';
        fill.style.width = '100%';
        showBar = true;
        planEl.classList.add('alert');
        break;
      case 'canceled':
      case 'incomplete_expired':
      case 'paused':
        label.textContent = 'No active plan';
        action.textContent = 'Subscribe';
        break;
      default:
        if (!billing.hasCustomer) {
          planEl.hidden = true;
          planEl.innerHTML = '';
          return;
        }
        label.textContent = 'Billing';
        action.textContent = 'Manage';
    }

    action.onclick = manage;
    row.append(label, action);
    planEl.appendChild(row);
    if (showBar) planEl.appendChild(bar);
  }

  function initCollapse() {
    const btn = document.getElementById('sidebar-collapse');
    if (!btn) return;
    btn.innerHTML = Icons.svg('sidebar', 16);
    btn.onclick = () => setCollapsed(!isCollapsed());
    setCollapsed(isCollapsed());

    document.querySelectorAll('.app-sidebar-nav a').forEach((a) => {
      const label = a.querySelector('.app-sidebar-nav-label');
      if (label && !a.title) a.title = label.textContent.trim();
    });
  }

  function init(options = {}) {
    initCollapse();
    menuOptions = {
      user: options.user || ReviewAuth.getUser(),
      onAccount: options.onAccount,
      onHelp: options.onHelp,
    };
    if (menuOptions.user) {
      renderUserMenu(menuOptions.user, menuOptions);
    }
    onManageBilling = options.onManageBilling || options.onAccount || null;
    if (options.billing) {
      paintPlan(options.billing, {
        guest: menuOptions.user?.guest === true,
        onManage: options.onManageBilling,
      });
    }

    document.addEventListener('click', (e) => {
      if (!menuOpen) return;
      if (menuRoot?.contains(e.target) || triggerBtn?.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  return {
    init,
    paintPlan,
    setMenuOptions,
    setCollapsed,
    isCollapsed,
    closeMenu,
    LIVE,
  };
})();
