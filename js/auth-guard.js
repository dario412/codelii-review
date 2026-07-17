(function () {
  const LOGIN_PATH = '/login.html';
  const TOKEN_KEY = 'review_token';
  const USER_KEY = 'review_user';

  const path = window.location.pathname;
  const isPublic =
    path === '/' ||
    path.endsWith('/index.html') ||
    path.endsWith('login.html') ||
    path.endsWith('/login') ||
    path.endsWith('join.html');

  const token = localStorage.getItem(TOKEN_KEY);
  const user = localStorage.getItem(USER_KEY);

  window.ReviewAuth = {
    getToken() {
      return localStorage.getItem(TOKEN_KEY);
    },
    getUser() {
      try {
        return JSON.parse(localStorage.getItem(USER_KEY));
      } catch {
        return null;
      }
    },
    setSession(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    async logout() {
      try {
        await fetch('/api/auth/login', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${window.ReviewAuth.getToken()}` },
        });
      } catch {
        /* ignore */
      }
      window.ReviewAuth.clear();
      window.location.href = LOGIN_PATH;
    },
    headers() {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.ReviewAuth.getToken()}`,
      };
    },
    isLoggedIn() {
      return Boolean(localStorage.getItem(TOKEN_KEY) && localStorage.getItem(USER_KEY));
    },
  };

  if (isPublic) return;

  if (!token || !user) {
    const redirect = encodeURIComponent(path + window.location.search + window.location.hash);
    window.location.replace(`${LOGIN_PATH}?redirect=${redirect}`);
  }
})();
