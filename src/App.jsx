import { useState, useEffect } from 'react';
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
import { api, clearToken } from './api';

function PrivateRoute({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  useEffect(() => {
    const update = () => setToken(localStorage.getItem('token'));
    window.addEventListener('storage', update);
    window.addEventListener('token-changed', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('token-changed', update);
    };
  }, []);
  return token ? children : <Navigate to="/login" />;
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
