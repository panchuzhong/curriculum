import { useState, useEffect, Fragment } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import Layout from './components/Layout';
import ToastProvider from './components/ToastProvider';
import LoginPage from './auth/LoginPage';
import RegisterPage from './auth/RegisterPage';
import WeeklySchedule from './schedule/WeeklySchedule';
import MonthlySchedule from './schedule/MonthlySchedule';
import YearlySchedule from './schedule/YearlySchedule';
import ClassList from './classes/ClassList';
import StudentList from './classes/StudentList';
import SemesterManager from './schedule/SemesterManager';
import Reports from './reports/Reports';
import Settings from './settings/Settings';
import DesignPreview from './DesignPreview';
import { api, clearToken, getTokenIdentity } from './api';

function PrivateRoute({ children }) {
  const [identity, setIdentity] = useState(() => getTokenIdentity(localStorage.getItem('token')));
  useEffect(() => {
    // 另一个标签页换账号登录时，光换 token 字符串不够：整棵私有页面树还拿着旧账号的
    // 班级列表、课表数据和表单状态，而新请求已经带上 B 的令牌——在 A 的页面上点
    // 「保存学科设置」就会写进 B 的账号。账号身份变化时把 key 一起换掉，强制整树重挂，
    // 所有 state 和 effect 重新初始化（课表缓存由 api.setToken/clearToken 清）。
    //
    // 比较的是令牌里的账号身份，不是令牌字符串：本标签页改密码会换发新令牌，
    // 那还是同一个人，重挂会把「密码修改成功」的提示和设置页一起冲掉。
    const update = () => setIdentity(getTokenIdentity(localStorage.getItem('token')));
    window.addEventListener('storage', update);
    window.addEventListener('token-changed', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('token-changed', update);
    };
  }, []);
  if (!identity) return <Navigate to="/login" />;
  // Fragment 而不是 div：key 换的只是身份，不想给布局多包一层真实 DOM。
  return <Fragment key={identity}>{children}</Fragment>;
}

function AuthInit({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setReady(true);
      return;
    }
    setReady(true);
    api.getProfile()
      .catch((err) => {
        // Only clear token on explicit auth failure, not network errors
        if (err.message === '登录已过期,请重新登录') {
          clearToken();
        }
      });
  }, []);
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthInit>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {import.meta.env.DEV && (
              <Route path="/design" element={<PrivateRoute><DesignPreview /></PrivateRoute>} />
            )}
            <Route path="/*" element={
              <PrivateRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<WeeklySchedule />} />
                    <Route path="/monthly" element={<MonthlySchedule />} />
                    <Route path="/yearly" element={<YearlySchedule />} />
                    <Route path="/classes" element={<ClassList />} />
                    <Route path="/students" element={<StudentList />} />
                    <Route path="/semesters" element={<SemesterManager />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </Layout>
              </PrivateRoute>
            } />
          </Routes>
        </AuthInit>
      </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
