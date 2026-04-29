import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken } from '../api';

export default function RegisterPage() {
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.register(form);
      setToken(token);
      navigate('/');
    } catch (err) {
      setError(err.message || '注册失败');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg w-96">
        <h1 className="text-2xl mb-6 text-center">注册</h1>
        {error && <p className="text-red-400 mb-4">{error}</p>}
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" placeholder="姓名"
          value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" placeholder="用户名"
          value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" type="password" placeholder="密码"
          value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
        <button className="w-full p-3 bg-blue-600 rounded hover:bg-blue-700" type="submit">注册</button>
        <p className="mt-4 text-center text-gray-400">
          已有账号？<Link to="/login" className="text-blue-400">登录</Link>
        </p>
      </form>
    </div>
  );
}
