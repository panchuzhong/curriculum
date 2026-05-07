import { useState, useEffect, useLayoutEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clearToken } from '../api';
import { setDarkMode, DarkContext } from '../utils/colors';

const NAV_LINKS = [
  { to: '/', label: '周课表', color: 'bg-blue-500', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
  { to: '/monthly', label: '月课表', color: 'bg-indigo-500', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { to: '/yearly', label: '年课表', color: 'bg-violet-500', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { to: '/classes', label: '班级管理', color: 'bg-emerald-500', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { to: '/students', label: '学生管理', color: 'bg-cyan-500', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { to: '/semesters', label: '学期管理', color: 'bg-amber-500', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { to: '/reports', label: '统计报表', color: 'bg-rose-500', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/settings', label: '设置', color: 'bg-gray-500', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function Layout({ children }) {
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return true;
    const hour = new Date().getHours();
    return hour >= 19 || hour < 7;
  });
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [isTablet, setIsTablet] = useState(() => window.innerWidth >= 768 && window.innerWidth < 1280);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  setDarkMode(dark);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const mobile = w < 768;
      setIsMobile(mobile);
      setIsTablet(!mobile && w < 1280);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const tablet = window.innerWidth >= 768 && window.innerWidth < 1280;
    const key = tablet ? 'sidebarWidthTablet' : 'sidebarWidthDesktop';
    const saved = localStorage.getItem(key) ?? localStorage.getItem('sidebarWidth');
    return saved ? parseInt(saved) : (tablet ? 100 : 224);
  });
  const [resizing, setResizing] = useState(false);

  function sidebarStorageKey() {
    const w = window.innerWidth;
    return w >= 768 && w < 1280 ? 'sidebarWidthTablet' : 'sidebarWidthDesktop';
  }

  function startResize(e) {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = sidebarWidth;
    const key = sidebarStorageKey();
    function onMove(e2) {
      const w = Math.max(80, Math.min(400, startW + e2.clientX - startX));
      setSidebarWidth(w);
      localStorage.setItem(key, w);
    }
    function onUp() {
      setResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResizeTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const startX = touch.clientX;
    const startW = sidebarWidth;
    const key = sidebarStorageKey();
    function onMove(e2) {
      e2.preventDefault();
      const t = e2.touches[0];
      const w = Math.max(80, Math.min(400, startW + t.clientX - startX));
      setSidebarWidth(w);
      localStorage.setItem(key, w);
    }
    function onEnd() {
      setResizing(false);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    }
    setResizing(true);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  const sidebarContent = (
    <>
      <div className={`${isTablet ? 'p-3' : 'p-5'} border-b border-gray-100 dark:border-gray-700 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          {(!isMobile && sidebarWidth > 100 || isMobile) && (
            <h1 className="text-sm font-bold text-gray-900 dark:text-white">课表管理</h1>
          )}
        </div>
        {isMobile && (
          <button onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 p-3 space-y-0.5 overflow-auto thin_scroll">
        {NAV_LINKS.map(l => {
          const active = location.pathname === l.to;
          return (
            <Link key={l.to} to={l.to}
              className={`flex items-center gap-3 pr-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                active
                  ? 'pl-[9px] border-l-[3px] border-blue-500 bg-blue-50 dark:bg-blue-900/20 font-semibold text-blue-700 dark:text-blue-300'
                  : 'pl-3 border-l-[3px] border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title={!isMobile && sidebarWidth <= 100 ? l.label : undefined}>
              <div className={`w-7 h-7 ${l.color} rounded-lg flex items-center justify-center shrink-0 shadow-sm`}>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={l.icon} />
                </svg>
              </div>
              {(isMobile || sidebarWidth > 100) && l.label}
            </Link>
          );
        })}
      </div>

      <div className={`${isTablet ? 'p-2' : 'p-3'} border-t border-gray-100 dark:border-gray-700 space-y-1`}>
        <button onClick={() => setDark(!dark)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
          title={!isMobile && sidebarWidth <= 100 ? (dark ? '日间模式' : '夜间模式') : undefined}>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${dark ? 'bg-amber-400' : 'bg-indigo-500'}`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {dark ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              )}
            </svg>
          </div>
          {(isMobile || sidebarWidth > 100) && (dark ? '日间模式' : '夜间模式')}
        </button>
        <button onClick={() => { clearToken(); window.location.href = `${import.meta.env.BASE_URL}login`; }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-red-600 dark:hover:text-red-400 transition"
          title={!isMobile && sidebarWidth <= 100 ? '退出登录' : undefined}>
          <div className="w-7 h-7 bg-red-500 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </div>
          {(isMobile || sidebarWidth > 100) && '退出登录'}
        </button>
      </div>
    </>
  );

  return (
    <DarkContext.Provider value={dark}>
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden" style={{ height: '100dvh' }}>
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}

      {isMobile ? (
        <nav
          className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 shadow-xl transition-transform duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
          {sidebarContent}
        </nav>
      ) : (
        <nav className="flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 shadow-sm relative"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
          {sidebarContent}
          <div
            className="absolute top-0 right-0 h-full cursor-col-resize group"
            style={{ width: isTablet ? 12 : 4, touchAction: 'none' }}
            onMouseDown={startResize}
            onTouchStart={startResizeTouch}
          >
            <div className={`absolute inset-y-0 right-0 w-1 transition-colors group-hover:bg-blue-400 dark:group-hover:bg-blue-500 ${resizing ? 'bg-blue-500' : ''}`} />
          </div>
        </nav>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {isMobile && (
          <div className="flex items-center h-11 px-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition active:scale-90">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="ml-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
              {NAV_LINKS.find(l => l.to === location.pathname)?.label ?? '课表管理'}
            </span>
          </div>
        )}

        <main className={`flex-1 min-h-0 overflow-auto thin_scroll bg-gray-50 dark:bg-gray-900 ${isMobile ? 'p-2' : isTablet ? 'p-3' : 'p-6'}`}>
          {children}
        </main>
      </div>
    </div>
    </DarkContext.Provider>
  );
}
