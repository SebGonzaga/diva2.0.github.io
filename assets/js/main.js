/* =========================================================================
   DIVA — assets/js/main.js
   Shared app-shell rendering (sidebar/topbar/footer), a lightweight demo
   auth guard, toast helper, and the animation initializer dispatcher.
   This is a frontend-only prototype: "auth" is simulated in localStorage
   until the PHP session-based backend (see spec §8) is wired in.
   ========================================================================= */

const DIVA_NAV = {
  resident: [
    { section: "Monitor", links: [
      { href: "dashboard.html", icon: "bi-grid-1x2", label: "Dashboard" },
      { href: "weather.html", icon: "bi-cloud-sun", label: "Weather" },
      { href: "volcano.html", icon: "bi-triangle", label: "Volcano Monitoring" },
    ]},
    { section: "Assistance", links: [
      { href: "virtual-assistance.html", icon: "bi-chat-dots", label: "Virtual Assistance" },
      { href: "emergency.html", icon: "bi-telephone", label: "Emergency" },
      { href: "alerts.html", icon: "bi-bell", label: "Alerts" },
      { href: "report.html", icon: "bi-flag", label: "Report Incident" },
    ]},
    { section: "Account", links: [
      { href: "profile.html", icon: "bi-person-circle", label: "Profile" },
    ]},
  ],
  admin: [
    { section: "Monitor", links: [
      { href: "admin-dashboard.html", icon: "bi-grid-1x2", label: "Dashboard" },
      { href: "weather.html", icon: "bi-cloud-sun", label: "Weather" },
      { href: "volcano.html", icon: "bi-triangle", label: "Volcano Monitoring" },
    ]},
    { section: "Operations", links: [
      { href: "virtual-assistance.html", icon: "bi-chat-dots", label: "Virtual Assistance" },
      { href: "emergency.html", icon: "bi-telephone", label: "Emergency" },
      { href: "admin-alerts.html", icon: "bi-bell", label: "Alerts" },
      { href: "admin-incidents.html", icon: "bi-flag", label: "Incident Reports" },
      { href: "admin-analytics.html", icon: "bi-bar-chart", label: "Analytics" },
    ]},
  ],
};

const DivaAuth = {
  DEMO_ACCOUNTS: {
    "master@diva.gov.ph": { password: "MasterDemo123!", role: "Master Administrator", name: "Master Admin" },
    "admin@diva.gov.ph": { password: "AdminDemo123!", role: "Administrator", name: "LGU Administrator" },
    "resident@diva.gov.ph": { password: "ResidentDemo123!", role: "Community Resident", name: "Juan Dela Cruz" },
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem("diva_user") || "null"); } catch (e) { return null; }
  },
  setUser(user) { localStorage.setItem("diva_user", JSON.stringify(user)); },
  logout() { localStorage.removeItem("diva_user"); window.location.href = "index.html"; },
  requireLogin() {
    const u = this.getUser();
    if (!u) { window.location.href = "login.html"; }
    return u;
  },
  isAdmin(u) { return u && (u.role === "Administrator" || u.role === "Master Administrator"); },
};

function divaToast(message, icon) {
  icon = icon || "bi-check-circle";
  const el = document.createElement("div");
  el.className = "toast-diva";
  el.innerHTML = `<i class="bi ${icon}"></i><span>${message}</span>`;
  document.body.appendChild(el);
  if (window.DivaAnim) DivaAnim.animateToastIn(el);
  setTimeout(() => {
    if (window.DivaAnim) DivaAnim.animateToastOut(el, () => el.remove());
    else el.remove();
  }, 3200);
}

function renderAppShell(activePage, opts) {
  opts = opts || {};
  const user = DivaAuth.requireLogin();
  if (!user) return null;

  const isAdminRole = DivaAuth.isAdmin(user);
  const navGroups = isAdminRole ? DIVA_NAV.admin : DIVA_NAV.resident;
  const initials = (user.name || "U").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const masterExtra = user.role === "Master Administrator"
    ? `<div class="nav-section-label">System</div>
       <a class="sidebar-link" href="admin-users.html"><i class="bi bi-people"></i> User Management</a>`
    : "";

  const navHtml = navGroups.map((g) => `
    <div class="nav-section-label">${g.section}</div>
    ${g.links.map((l) => `<a class="sidebar-link ${activePage === l.href ? "active" : ""}" href="${l.href}"><i class="bi ${l.icon}"></i> ${l.label}</a>`).join("")}
  `).join("") + masterExtra;

  const shell = document.getElementById("app-shell-root");
  shell.innerHTML = `
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="app-sidebar" id="appSidebar">
      <div class="sidebar-brand"><span class="brand-mark">D</span> DIVA</div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <div class="sidebar-user mb-3">
          <div class="avatar">${initials}</div>
          <div>
            <div class="name">${user.name}</div>
            <div class="role">${user.role}</div>
          </div>
        </div>
        <button class="btn btn-diva btn-diva-outline btn-diva-sm w-100" id="logoutBtn" style="border-color:rgba(255,255,255,.2); color:#fff;">
          <i class="bi bi-box-arrow-right"></i> Log out
        </button>
      </div>
    </aside>
    <div class="app-main">
      <div class="offline-banner" id="offlineBanner"><i class="bi bi-wifi-off"></i> You are currently offline. Showing the latest available information.</div>
      <header class="app-topbar">
        <div class="d-flex align-items-center gap-3">
          <button class="sidebar-toggle-btn" id="sidebarToggle" aria-label="Toggle navigation"><i class="bi bi-list"></i></button>
          <div class="topbar-title">${opts.title || ""}</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="eyebrow d-none d-md-inline-flex">Live monitoring</span>
        </div>
      </header>
      <main class="app-content" id="app-content"></main>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => DivaAuth.logout());
  const toggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("appSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (toggle) {
    toggle.addEventListener("click", () => {
      if (sidebar.classList.contains("show")) {
        DivaAnim.animateSidebarClose(sidebar, overlay);
      } else {
        DivaAnim.animateSidebarOpen(sidebar, overlay);
      }
    });
  }
  if (overlay) overlay.addEventListener("click", () => DivaAnim.animateSidebarClose(sidebar, overlay));

  // Offline detection (spec §38)
  const offlineBanner = document.getElementById("offlineBanner");
  function updateOnlineStatus() {
    if (offlineBanner) offlineBanner.classList.toggle("show", !navigator.onLine);
  }
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  return user;
}

function initializeAnimations() {
  if (document.querySelector(".hero-title")) DivaAnim.animatePageEntrance();
  DivaAnim.initScrollReveal(".reveal-on-scroll");
  DivaAnim.initCounters("[data-count-to]");
  document.querySelectorAll(".diva-card, .feature-card").forEach((el) => {
    if (!el.classList.contains("reveal-on-scroll")) el.style.opacity = "1";
  });
  document.querySelectorAll("[data-press]").forEach((btn) => {
    btn.addEventListener("click", () => DivaAnim.pressButton(btn));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("footerYear");
  if (year) year.textContent = new Date().getFullYear();
});
