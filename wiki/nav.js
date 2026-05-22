// ═══════════════════════════════════════════════════════════════════
// STORYBOOK WIKI — Shared Navigation Component
// ═══════════════════════════════════════════════════════════════════

const NAV_SECTIONS = [
  {
    title: 'Getting Started',
    links: [
      { href: 'index.html', icon: '🏠', label: 'Home' },
      { href: 'architecture.html', icon: '🏗️', label: 'System Architecture' },
    ]
  },
  {
    title: 'Content Pipeline',
    links: [
      { href: 'pipeline-overview.html', icon: '🔄', label: 'Pipeline Overview' },
      { href: 'ideation.html', icon: '💡', label: 'Ideation Stage' },
      { href: 'story.html', icon: '📖', label: 'Story Generation' },
      { href: 'screenplay.html', icon: '🎬', label: 'Screenplay Conversion' },
      { href: 'shots.html', icon: '📸', label: 'Shot Generation' },
      { href: 'audio.html', icon: '🔊', label: 'Audio Studio' },
    ]
  },
  {
    title: 'Intelligence',
    links: [
      { href: 'memory.html', icon: '🧠', label: 'Memory & Continuity' },
      { href: 'prompts.html', icon: '✨', label: 'Prompt Engine' },
      { href: 'llm.html', icon: '🤖', label: 'LLM Integration' },
    ]
  },
  {
    title: 'Infrastructure',
    links: [
      { href: 'infrastructure.html', icon: '☁️', label: 'AWS & Supabase' },
      { href: 'database.html', icon: '🗄️', label: 'Database Schema' },
      { href: 'realtime.html', icon: '⚡', label: 'Real-time & WebSocket' },
    ]
  },
  {
    title: 'Product',
    links: [
      { href: 'user-flows.html', icon: '👤', label: 'User Flows & UI' },
      { href: 'decisions.html', icon: '⚖️', label: 'Product Decisions' },
    ]
  }
];

function getCurrentPage() {
  const path = window.location.pathname;
  const filename = path.split('/').pop() || 'index.html';
  return filename;
}

function renderSidebar() {
  const currentPage = getCurrentPage();
  
  const sidebarHTML = `
    <div class="sidebar-header">
      <a href="index.html" class="sidebar-logo">
        <div class="sidebar-logo-icon">📚</div>
        <div>
          <span class="sidebar-logo-text">Storybook</span>
          <span class="sidebar-logo-sub">Platform Wiki</span>
        </div>
      </a>
    </div>
    <nav class="sidebar-nav">
      ${NAV_SECTIONS.map(section => `
        <div class="nav-section">
          <div class="nav-section-title">${section.title}</div>
          ${section.links.map(link => `
            <a href="${link.href}" class="nav-link ${currentPage === link.href ? 'active' : ''}">
              <span class="nav-icon">${link.icon}</span>
              ${link.label}
            </a>
          `).join('')}
        </div>
      `).join('')}
    </nav>
  `;
  
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.innerHTML = sidebarHTML;
  }
}

function initMobileToggle() {
  const toggle = document.querySelector('.mobile-toggle');
  const sidebar = document.querySelector('.sidebar');
  
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }
}

function initScrollProgress() {
  const bar = document.querySelector('.scroll-progress-bar');
  if (!bar) return;
  
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = progress + '%';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderSidebar();
  initMobileToggle();
  initScrollProgress();
});
