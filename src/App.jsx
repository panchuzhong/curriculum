import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import Layout from './components/Layout';
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
  const token = localStorage.getItem('token');
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
    api.getProfile()
      .then(() => setReady(true))
      .catch(() => {
        clearToken();
        setReady(true);
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
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthInit>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/design" element={<DesignPreview />} />
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
    </ErrorBoundary>
  );
}
