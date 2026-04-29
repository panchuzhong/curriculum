import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import LoginPage from './auth/LoginPage';
import RegisterPage from './auth/RegisterPage';
import WeeklySchedule from './schedule/WeeklySchedule';
import MonthlySchedule from './schedule/MonthlySchedule';
import YearlySchedule from './schedule/YearlySchedule';
import ClassList from './classes/ClassList';
import PricingTierManager from './pricing/PricingTierManager';
import { clearToken } from './api';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

function Layout({ children }) {
  const location = useLocation();
  const links = [
    { to: '/', label: '周课表' },
    { to: '/monthly', label: '月课表' },
    { to: '/yearly', label: '年课表' },
    { to: '/classes', label: '班级管理' },
    { to: '/pricing', label: '定价阶梯' },
  ];

  return (
    <div className="flex h-screen">
      <nav className="w-48 bg-gray-800 p-4 flex flex-col">
        <h1 className="text-lg font-bold mb-6">课表管理</h1>
        {links.map(l => (
          <Link key={l.to} to={l.to}
            className={`p-2 rounded mb-1 ${location.pathname === l.to ? 'bg-blue-600' : 'hover:bg-gray-700'}`}>
            {l.label}
          </Link>
        ))}
        <div className="mt-auto">
          <button onClick={() => { clearToken(); window.location.href = '/login'; }}
            className="w-full p-2 text-gray-400 hover:text-white">退出登录</button>
        </div>
      </nav>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/*" element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<WeeklySchedule />} />
                <Route path="/monthly" element={<MonthlySchedule />} />
                <Route path="/yearly" element={<YearlySchedule />} />
                <Route path="/classes" element={<ClassList />} />
                <Route path="/pricing" element={<PricingTierManager />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
