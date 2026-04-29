import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken } from '../api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.login({ username, password });
      setToken(token);
      navigate('/');
    } catch {
      setError('用户名或密码错误');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg w-96">
        <h1 className="text-2xl mb-6 text-center">登录</h1>
        {error && <p className="text-red-400 mb-4">{error}</p>}
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" placeholder="用户名"
          value={username} onChange={e => setUsername(e.target.value)} />
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" type="password" placeholder="密码"
          value={password} onChange={e => setPassword(e.target.value)} />
        <button className="w-full p-3 bg-blue-600 rounded hover:bg-blue-700" type="submit">登录</button>
        <p className="mt-4 text-center text-gray-400">
          没有账号？<Link to="/register" className="text-blue-400">注册</Link>
        </p>
      </form>
    </div>
  );
}
