import { useState, useEffect } from 'react';
import { api } from '../api';
import { DATE_MIN, DATE_MAX } from '../utils/constants';
import { isUsableDate, DATE_INVALID_HINT } from '../utils/date';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmDialog';

export default function PricingManager({ classId, onChanged }) {
  const toast = useToast();
  const [confirmAction, confirmDialog] = useConfirm();
  const [records, setRecords] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ studentCount: '', unitPrice: '', discountAmount: '', discountReason: '', effectiveFrom: '' });
  const [saving, setSaving] = useState(false);
  // openAdd 是拿 records[0]（当前定价）预填的。列表还没回来就点「新增定价」的话，
  // records 是空数组，预填就全空——而之后到达的列表只写 records，不会回头补这一次。
  // 用户看到的就是一张空表单，得把人数单价一项项重新敲一遍。
  // 没加载完就不让开：失败也算加载完（真的取不到旧值，该空就空），否则按钮会永远置灰。
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    api.getClassPricing(classId)
      .then(setRecords)
      .catch(e => toast(e.message || '加载定价历史失败'))
      .finally(() => setLoaded(true));
  }, [classId]);

  const current = records[0];

  function openAdd() {
    const latest = records[0] || {};
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setForm({
      studentCount: latest.studentCount ?? '',
      unitPrice: latest.unitPrice ?? '',
      discountAmount: latest.discountAmount ?? '',
      discountReason: latest.discountReason || '',
      effectiveFrom: todayStr,
    });
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(r) {
    setForm({
      studentCount: r.studentCount ?? '',
      unitPrice: r.unitPrice ?? '',
      discountAmount: r.discountAmount ?? '',
      discountReason: r.discountReason || '',
      effectiveFrom: r.effectiveFrom,
    });
    setEditId(r.id);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditId(null);
  }

  async function handleSave() {
    if (saving) return;
    // 空值不能静默返回：点了保存什么都不发生，和页面卡死了没区别。
    if (!form.effectiveFrom) { toast('请先填写生效日期'); return; }
    // min/max 只把越界值标成 :invalid，value 照样提交。生效日期被左移成 0261 之后，
    // 这条定价会排到历史最前面，而且在界面上修不回来。
    if (!isUsableDate(form.effectiveFrom)) { toast(DATE_INVALID_HINT); return; }
    setSaving(true);
    try {
      const data = {
        studentCount: +form.studentCount,
        unitPrice: +form.unitPrice,
        // On update an omitted field keeps its old value, so send explicit
        // empties; on create the server defaults them.
        discountAmount: form.discountAmount !== '' ? +form.discountAmount : (editId ? 0 : undefined),
        discountReason: form.discountReason || (editId ? null : undefined),
        effectiveFrom: form.effectiveFrom,
      };
      if (editId) {
        await api.updateClassPricing(classId, editId, data);
      } else {
        await api.createClassPricing(classId, data);
      }
      setShowForm(false);
      setEditId(null);
      const updated = await api.getClassPricing(classId);
      setRecords(updated);
      onChanged?.();
    } catch (e) {
      toast(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r) {
    if (!(await confirmAction(`确定删除 ${r.effectiveFrom} 起的定价记录？`))) return;
    try {
      await api.deleteClassPricing(classId, r.id);
      const updated = await api.getClassPricing(classId);
      setRecords(updated);
      onChanged?.();
    } catch (e) {
      toast(e.message || '删除失败');
    }
  }

  const inp = 'w-full p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded';

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-sm">定价管理</h4>
        <button onClick={openAdd} disabled={!loaded}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">+ 新增定价</button>
      </div>

      {/* Current pricing summary card */}
      {current && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-3 mb-4">
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">当前定价：</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{current.studentCount}人 × ¥{current.unitPrice}/人/时</span>
            {current.discountAmount > 0 && (
              <span className="text-gray-500 dark:text-gray-400 ml-2">| 优惠 ¥{current.discountAmount}{current.discountReason ? `（${current.discountReason}）` : ''}</span>
            )}
          </div>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">自 {current.effectiveFrom} 起生效</p>
        </div>
      )}

      {records.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无定价记录</p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* w-full 的表格把多出来的宽度加在右对齐列文字的左边，所以「右对齐列 →
                左对齐列」这个交界处的间距永远只有两侧 padding 之和，得给原因列补一段
                左缩进。只在 ≥640px 生效：窄屏各列交界本来就在同一量级（十几到四十几
                像素），单独给一列加 40px 反而成了新的异常，何况窄屏宽度本来就紧张。 */}
            <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
              <th className="text-left p-2 font-medium">生效日期</th>
              <th className="text-right p-2 font-medium">人数</th>
              <th className="text-right p-2 font-medium">单价</th>
              <th className="text-right p-2 font-medium">优惠金额</th>
              <th className="text-left p-2 sm:pl-10 font-medium">原因</th>
              <th className="text-right p-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700">
                <td className="p-2">{r.effectiveFrom}{i === 0 ? <span className="text-blue-600 dark:text-blue-400 font-medium ml-1">当前</span> : ''}</td>
                <td className="text-right p-2">{r.studentCount}</td>
                <td className="text-right p-2">¥{r.unitPrice}</td>
                <td className="text-right p-2">¥{r.discountAmount || 0}</td>
                <td className="p-2 sm:pl-10 text-gray-500 dark:text-gray-400">{r.discountReason || <span className="text-gray-400">—</span>}</td>
                <td className="text-right p-2">
                  <button onClick={() => openEdit(r)} className="text-blue-600 dark:text-blue-400 hover:underline mr-3">编辑</button>
                  {records.length > 1 && (
                    <button onClick={() => handleDelete(r)} className="text-red-500 hover:underline">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {showForm && (
        <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">生效日期</label>
              <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={inp} value={form.effectiveFrom}
                onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">学生人数</label>
              <input type="number" min="1" className={inp} value={form.studentCount}
                onChange={e => setForm({ ...form, studentCount: e.target.value === '' ? '' : +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">单价 (元/人/时)</label>
              <input type="number" min="0" className={inp} value={form.unitPrice}
                onChange={e => setForm({ ...form, unitPrice: e.target.value === '' ? '' : +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">优惠金额</label>
              <input type="number" min="0" step="0.01" className={inp} value={form.discountAmount}
                onChange={e => setForm({ ...form, discountAmount: e.target.value === '' ? '' : +e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">优惠原因</label>
            <input className={inp} value={form.discountReason}
              onChange={e => setForm({ ...form, discountReason: e.target.value })} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? '保存中...' : editId ? '更新' : '添加'}
            </button>
            <button onClick={cancelForm} className="px-3 py-1.5 text-sm bg-gray-300 dark:bg-gray-600 rounded">取消</button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
