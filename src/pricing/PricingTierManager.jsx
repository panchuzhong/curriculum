import { useState, useEffect } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';

export default function PricingTierManager() {
  const toast = useToast();
  const [tiers, setTiers] = useState([]);
  const [form, setForm] = useState({ minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 });
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getPricingTiers().then(setTiers).catch(e => toast(e.message || '加载定价阶梯失败')); }, []);

  async function addTier() {
    if (saving) return;
    setSaving(true);
    try {
      await api.createPricingTier({
        minStudents: form.minStudents === '' ? 1 : +form.minStudents,
        maxStudents: form.maxStudents === '' ? 1 : +form.maxStudents,
        pricePerStudentPerHour: form.pricePerStudentPerHour === '' ? 0 : +form.pricePerStudentPerHour,
      });
      setForm({ minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 });
      api.getPricingTiers().then(setTiers).catch(e => toast(e.message || '加载定价阶梯失败'));
    } catch (e) { toast(e.message || '添加失败'); }
    finally { setSaving(false); }
  }

  async function removeTier(id) {
    if (saving) return;
    setSaving(true);
    try {
      await api.deletePricingTier(id);
      setTiers(t => t.filter(x => x.id !== id));
    } catch (e) { toast(e.message || '删除失败'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <h2 className="text-xl mb-4">定价阶梯</h2>
      <div className="grid gap-2 mb-4">
        {tiers.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded">
            <span>{t.minStudents === t.maxStudents ? `${t.minStudents}人` : `${t.minStudents}-${t.maxStudents}人`}: ¥{t.pricePerStudentPerHour}/人/时</span>
            <button onClick={() => removeTier(t.id)} disabled={saving} className="text-red-400 hover:text-red-300 disabled:opacity-50">删除</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-end">
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">最少人数</label>
          <input type="number" min="1" className="w-24 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.minStudents} onChange={e => setForm({...form, minStudents: e.target.value === '' ? '' : +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">最多人数</label>
          <input type="number" min="1" className="w-24 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.maxStudents} onChange={e => setForm({...form, maxStudents: e.target.value === '' ? '' : +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">单价 (元/人/时)</label>
          <input type="number" step="0.01" className="w-32 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.pricePerStudentPerHour} onChange={e => setForm({...form, pricePerStudentPerHour: e.target.value === '' ? '' : +e.target.value})} />
        </div>
        <button onClick={addTier} disabled={saving} className="px-4 py-2 bg-green-600 rounded hover:bg-green-700 disabled:opacity-50">{saving ? '处理中...' : '添加'}</button>
      </div>
    </div>
  );
}
