import { useState, useEffect } from 'react';
import { api } from '../api';
import PricingTierManager from '../pricing/PricingTierManager';
import HolidayManager from './HolidayManager';
import { getSubjectColor } from '../utils/colors';

const ALL_SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治', '信息技术', '美术', '音乐', '体育'];

function SubjectSection() {
  const [subjects, setSubjects] = useState([]);
  const [newSubject, setNewSubject] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getProfile().then(p => setSubjects(p.subjects || [])).catch(() => {});
  }, []);

  function moveUp(i) {
    if (i === 0) return;
    const arr = [...subjects];
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    setSubjects(arr);
  }

  function moveDown(i) {
    if (i === subjects.length - 1) return;
    const arr = [...subjects];
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    setSubjects(arr);
  }

  function remove(s) {
    setSubjects(subjects.filter(x => x !== s));
  }

  function add() {
    const s = newSubject.trim();
    if (!s || subjects.includes(s)) return;
    setSubjects([...subjects, s]);
    setNewSubject('');
  }

  function addPreset(s) {
    if (subjects.includes(s)) return;
    setSubjects([...subjects, s]);
  }

  async function save() {
    try {
      await api.updateSubjects(subjects);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('保存失败: ' + (err.message || '未知错误'));
    }
  }

  const presets = ALL_SUBJECTS.filter(s => !subjects.includes(s));

  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
      <h3 className="font-bold mb-3">学科管理</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        设置您教授的学科及顺序，新建班级时只会显示这些学科。
      </p>

      <div className="space-y-1 mb-4">
        {subjects.map((s, i) => (
          <div key={s} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-700 rounded">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: getSubjectColor(s) }} />
            <span className="flex-1">{s}</span>
            <button onClick={() => moveUp(i)} disabled={i === 0}
              className="px-2 py-0.5 text-sm bg-gray-200 dark:bg-gray-600 rounded disabled:opacity-30">↑</button>
            <button onClick={() => moveDown(i)} disabled={i === subjects.length - 1}
              className="px-2 py-0.5 text-sm bg-gray-200 dark:bg-gray-600 rounded disabled:opacity-30">↓</button>
            <button onClick={() => remove(s)}
              className="px-2 py-0.5 text-sm text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">删除</button>
          </div>
        ))}
        {subjects.length === 0 && (
          <p className="text-gray-400 text-sm">暂未添加学科</p>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <input className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
          placeholder="自定义学科名称" value={newSubject}
          onChange={e => setNewSubject(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add}
          className="px-3 py-2 bg-blue-600 text-white rounded text-sm">添加</button>
      </div>

      {presets.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">快速添加：</p>
          <div className="flex flex-wrap gap-1">
            {presets.map(s => (
              <button key={s} onClick={() => addPreset(s)}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={save}
          className={`px-4 py-2 rounded text-sm font-medium ${saved
            ? 'bg-green-600 text-white'
            : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          {saved ? '✓ 已保存' : '保存学科设置'}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">学科设置已更新</span>}
      </div>
    </div>
  );
}

function ApiKeySection() {
  const [profile, setProfile] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
  }, []);

  async function regenerate() {
    if (!confirm('重新生成 API Key 后，旧的 Key 将立即失效。确定继续？')) return;
    try {
      const res = await api.regenerateApiKey();
      setProfile(p => ({ ...p, apiKey: res.apiKey }));
    } catch (e) { alert(e.message || '重新生成失败'); }
  }

  function copyKey() {
    if (!profile?.apiKey) return;
    // Try modern API first, fallback to execCommand
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(profile.apiKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      const textarea = document.createElement('textarea');
      textarea.value = profile.apiKey;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
      document.body.removeChild(textarea);
    }
  }

  if (!profile) return <div className="text-gray-500">加载中...</div>;

  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
      <h3 className="font-bold mb-3">API Key（供 AI Agent 使用）</h3>
      <div className="flex items-center gap-2 mb-3">
        <code className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono break-all">
          {profile.apiKey}
        </code>
        <button onClick={copyKey}
          className="px-3 py-2 bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400 dark:hover:bg-gray-500 text-sm whitespace-nowrap">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        Agent 通过请求头 <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">X-API-Key</code> 访问 API，
        详见 <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">GET /api/agent/help</code>
      </p>
      <button onClick={regenerate}
        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm">
        重新生成 API Key
      </button>
    </div>
  );
}

function PasswordSection() {
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.newPassword !== form.confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (form.newPassword.length < 6) {
      setError('新密码至少6位');
      return;
    }
    try {
      await api.changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
      setSuccess('密码修改成功');
      setForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err.message || '修改失败');
    }
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
      <h3 className="font-bold mb-3">修改密码</h3>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {success && <p className="text-green-500 text-sm">{success}</p>}
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">当前密码</label>
          <input type="password" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.oldPassword} onChange={e => setForm({...form, oldPassword: e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">新密码</label>
          <input type="password" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.newPassword} onChange={e => setForm({...form, newPassword: e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">确认新密码</label>
          <input type="password" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.confirmPassword} onChange={e => setForm({...form, confirmPassword: e.target.value})} />
        </div>
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">修改密码</button>
      </form>
    </div>
  );
}

export default function Settings() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl">设置</h2>
      <SubjectSection />
      <HolidayManager />
      <PasswordSection />
      <ApiKeySection />
      <PricingTierManager />
    </div>
  );
}
