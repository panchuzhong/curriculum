import { useState, useEffect } from 'react';
import { api } from '../api';

export default function PricingTierManager() {
  const [tiers, setTiers] = useState([]);
  const [form, setForm] = useState({ minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 });

  useEffect(() => { api.getPricingTiers().then(setTiers); }, []);

  async function addTier() {
    await api.createPricingTier(form);
    setForm({ minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 });
    api.getPricingTiers().then(setTiers);
  }

  async function removeTier(id) {
    await api.deletePricingTier(id);
    setTiers(t => t.filter(x => x.id !== id));
  }

  return (
    <div>
      <h2 className="text-xl mb-4">定价阶梯</h2>
      <div className="grid gap-2 mb-4">
        {tiers.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 bg-gray-800 rounded">
            <span>{t.minStudents === t.maxStudents ? `${t.minStudents}人` : `${t.minStudents}-${t.maxStudents}人`}: ¥{t.pricePerStudentPerHour}/人/时</span>
            <button onClick={() => removeTier(t.id)} className="text-red-400 hover:text-red-300">删除</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-end">
        <div>
          <label className="block text-sm text-gray-400 mb-1">最少人数</label>
          <input type="number" min="1" className="w-24 p-2 bg-gray-700 rounded"
            value={form.minStudents} onChange={e => setForm({...form, minStudents: +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">最多人数</label>
          <input type="number" min="1" className="w-24 p-2 bg-gray-700 rounded"
            value={form.maxStudents} onChange={e => setForm({...form, maxStudents: +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">单价 (元/人/时)</label>
          <input type="number" step="0.01" className="w-32 p-2 bg-gray-700 rounded"
            value={form.pricePerStudentPerHour} onChange={e => setForm({...form, pricePerStudentPerHour: +e.target.value})} />
        </div>
        <button onClick={addTier} className="px-4 py-2 bg-green-600 rounded hover:bg-green-700">添加</button>
      </div>
    </div>
  );
}
