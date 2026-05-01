import { useState } from 'react';

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_CLASSES = [
  { name: '高三甲', subject: '数学', grade: '高三', isCompetition: false, h: 210, s: 79, time: ['09:00', '11:00'], col: [0, 7] },
  { name: '物理强化', subject: '物理', grade: '高二', isCompetition: false, h: 122, s: 50, time: ['14:00', '16:00'], col: [1, 7] },
  { name: '英语提高', subject: '英语', grade: '初三', isCompetition: false, h: 45, s: 93, time: ['09:00', '11:00'], col: [2, 7] },
  { name: '化学竞赛', subject: '化学', grade: '高一', isCompetition: true, h: 280, s: 62, time: ['15:00', '17:00'], col: [3, 7] },
  { name: '语文阅读', subject: '语文', grade: '初二', isCompetition: false, h: 0, s: 68, time: ['09:00', '10:30'], col: [4, 7] },
  { name: '生物竞赛', subject: '生物', grade: '高二', isCompetition: true, h: 187, s: 100, time: ['14:00', '16:00'], col: [4, 7] },
];

const GRADE_L = { '初一': 75, '初二': 68, '初三': 60, '高一': 52, '高二': 44, '高三': 36, '大学': 28 };

// ─── Color helpers ─────────────────────────────────────────────────────────
function oldColor(cls) {
  const l = GRADE_L[cls.grade] ?? 50;
  return { backgroundColor: `hsl(${cls.h}, ${cls.s}%, ${l}%)`, color: l < 55 ? '#fff' : '#1a1a1a' };
}
function newColorLight(cls) {
  return {
    backgroundColor: `hsl(${cls.h}, ${cls.s}%, 93%)`,
    borderLeft: `3px solid hsl(${cls.h}, ${cls.s}%, 42%)`,
    color: '#1a1a1a',
  };
}
function newColorDark(cls) {
  return {
    backgroundColor: `hsl(${cls.h}, ${cls.s}%, 17%)`,
    borderLeft: `3px solid hsl(${cls.h}, ${cls.s}%, 58%)`,
    color: '#e5e7eb',
  };
}

// ─── Mini schedule grid ────────────────────────────────────────────────────
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const ROW_H = 44;

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function timeToPx(t) { return (toMin(t) - 8 * 60) / 60 * ROW_H; }

function ScheduleBlock({ cls, colorFn, label }) {
  const top = timeToPx(cls.time[0]);
  const height = (toMin(cls.time[1]) - toMin(cls.time[0])) / 60 * ROW_H - 2;
  const style = { ...colorFn(cls), top, height, position: 'absolute', left: 2, right: 2, borderRadius: 6, padding: '3px 6px', overflow: 'hidden', cursor: 'pointer', fontSize: 11 };
  return (
    <div style={style} className="transition-shadow hover:shadow-md">
      <div style={{ fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cls.isCompetition && <span style={{ color: '#f59e0b' }}>★ </span>}{cls.name}
      </div>
      <div style={{ opacity: 0.75, fontSize: 10 }}>{cls.time[0]}–{cls.time[1]}</div>
    </div>
  );
}

function MiniGrid({ colorFn, dark }) {
  const cols = ['周一', '周二', '周三', '周四', '周五'];
  const totalH = HOURS.length * ROW_H;
  const bg = dark ? '#111827' : '#f9fafb';
  const linec = dark ? '#374151' : '#e5e7eb';
  const textc = dark ? '#6b7280' : '#9ca3af';
  const headerBg = dark ? '#1f2937' : '#f3f4f6';

  return (
    <div style={{ border: `1px solid ${linec}`, borderRadius: 10, overflow: 'hidden', background: bg, fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', background: headerBg, borderBottom: `2px solid ${linec}` }}>
        <div style={{ width: 40, flexShrink: 0, padding: '6px 4px', textAlign: 'center', fontSize: 11, color: textc }}>时间</div>
        {cols.map(d => (
          <div key={d} style={{ flex: 1, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: dark ? '#e5e7eb' : '#374151', fontWeight: 500 }}>
            {d === '周三' ? <><span>{d}</span><span style={{ marginLeft: 4, fontSize: 9, background: '#3b82f6', color: '#fff', borderRadius: 99, padding: '1px 5px' }}>今天</span></> : d}
          </div>
        ))}
      </div>
      {/* Body */}
      <div style={{ display: 'flex' }}>
        {/* Time column */}
        <div style={{ width: 40, flexShrink: 0, position: 'relative', height: totalH }}>
          {HOURS.map(h => (
            <div key={h} style={{ position: 'absolute', top: (h - 8) * ROW_H - 7, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: textc }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
          {HOURS.map(h => (
            <div key={h} style={{ position: 'absolute', top: (h - 8) * ROW_H, left: 0, right: 0, borderTop: `1px solid ${linec}` }} />
          ))}
        </div>
        {/* Day cols */}
        {cols.map((d, di) => {
          const dayClasses = MOCK_CLASSES.filter(c => c.col[0] === di);
          const isToday = d === '周三';
          return (
            <div key={d} style={{ flex: 1, position: 'relative', height: totalH, borderLeft: `1px solid ${linec}`, background: isToday ? (dark ? 'rgba(59,130,246,0.07)' : 'rgba(59,130,246,0.04)') : undefined }}>
              {HOURS.map(h => (
                <div key={h} style={{ position: 'absolute', top: (h - 8) * ROW_H, left: 0, right: 0, borderTop: `1px solid ${linec}`, opacity: 0.5 }} />
              ))}
              {dayClasses.map(cls => (
                <ScheduleBlock key={cls.name} cls={cls} colorFn={colorFn} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sidebar demo ──────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { label: '周课表', color: '#3b82f6', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
  { label: '月课表', color: '#6366f1', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { label: '班级管理', color: '#10b981', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { label: '统计报表', color: '#ef4444', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
];

function SidebarItem({ item, active, newStyle, dark }) {
  const bg = dark ? '#1f2937' : '#ffffff';
  const activeBg = dark ? (newStyle ? 'rgba(59,130,246,0.15)' : '#374151') : (newStyle ? 'rgba(59,130,246,0.07)' : '#f3f4f6');
  const textColor = active ? (newStyle ? '#2563eb' : (dark ? '#f9fafb' : '#111827')) : (dark ? '#9ca3af' : '#6b7280');
  const style = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
    borderRadius: newStyle ? 10 : 8,
    marginBottom: 2,
    background: active ? activeBg : 'transparent',
    borderLeft: newStyle && active ? '3px solid #3b82f6' : '3px solid transparent',
    paddingLeft: newStyle ? 8 : 10,
    cursor: 'pointer', color: textColor, fontSize: 13, fontWeight: active ? 600 : 400,
    transition: 'all 0.15s',
  };
  return (
    <div style={style}>
      <div style={{ width: 26, height: 26, background: item.color, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} /></svg>
      </div>
      {item.label}
    </div>
  );
}

function SidebarDemo({ newStyle, dark, label }) {
  const bg = dark ? '#1f2937' : '#ffffff';
  const border = dark ? '#374151' : '#e5e7eb';
  return (
    <div style={{ width: 160, background: bg, borderRadius: 12, padding: 10, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 10, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 8, textAlign: 'center', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {NAV_ITEMS.map((item, i) => (
        <SidebarItem key={item.label} item={item} active={i === 0} newStyle={newStyle} dark={dark} />
      ))}
    </div>
  );
}

// ─── Stat cards ─────────────────────────────────────────────────────────────
function OldStatCard({ label, value, unit, dark }) {
  return (
    <div style={{ padding: 16, borderRadius: 10, background: dark ? '#1f2937' : '#f3f4f6', flex: 1 }}>
      <div style={{ fontSize: 12, color: dark ? '#9ca3af' : '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: dark ? '#f9fafb' : '#111827' }}>
        {value}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 4, color: dark ? '#9ca3af' : '#6b7280' }}>{unit}</span>
      </div>
    </div>
  );
}

function NewStatCard({ label, value, unit, accent, icon, dark }) {
  const bg = dark ? '#1f2937' : '#ffffff';
  const border = dark ? '#374151' : '#e5e7eb';
  return (
    <div style={{ flex: 1, borderRadius: 12, overflow: 'hidden', background: bg, border: `1px solid ${border}`, boxShadow: dark ? 'none' : '0 1px 3px rgba(0,0,0,0.07)' }}>
      <div style={{ height: 4, background: accent }} />
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: dark ? '#9ca3af' : '#6b7280', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: dark ? '#f9fafb' : '#111827' }}>
            {value}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 4, color: dark ? '#9ca3af' : '#6b7280' }}>{unit}</span>
          </div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Buttons demo ────────────────────────────────────────────────────────────
function ButtonsDemo({ dark }) {
  const inputBg = dark ? '#374151' : '#ffffff';
  const inputBorder = dark ? '#4b5563' : '#d1d5db';
  const inputText = dark ? '#f9fafb' : '#111827';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Inputs */}
      <div>
        <div style={{ fontSize: 11, color: dark ? '#9ca3af' : '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>输入框 · 聚焦光晕</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 3 }}>现在（无聚焦样式）</div>
            <input readOnly value="高三甲" style={{ width: '100%', padding: '8px 10px', background: inputBg, border: `1px solid ${inputBorder}`, borderRadius: 6, color: inputText, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 3 }}>新方案（聚焦状态）</div>
            <input readOnly value="高三甲" style={{ width: '100%', padding: '8px 10px', background: inputBg, border: '2px solid #3b82f6', borderRadius: 6, color: inputText, fontSize: 13, outline: 'none', boxShadow: '0 0 0 3px rgba(59,130,246,0.2)', boxSizing: 'border-box' }} />
          </div>
        </div>
      </div>

      {/* Delete buttons */}
      <div>
        <div style={{ fontSize: 11, color: dark ? '#9ca3af' : '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>删除按钮 · Ghost 风格</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 6 }}>现在</div>
            <button style={{ padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>删除</button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 6 }}>新方案（默认）</div>
            <button style={{ padding: '6px 14px', background: 'transparent', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>删除</button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 6 }}>新方案（hover）</div>
            <button style={{ padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>删除</button>
          </div>
        </div>
      </div>

      {/* Scrollbar */}
      <div>
        <div style={{ fontSize: 11, color: dark ? '#9ca3af' : '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>滚动条</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, height: 72, overflowY: 'scroll', background: dark ? '#374151' : '#f9fafb', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: dark ? '#9ca3af' : '#6b7280', border: `1px solid ${dark ? '#4b5563' : '#e5e7eb'}` }}>
            <div style={{ fontSize: 10, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 4 }}>现在（系统默认滚动条）</div>
            {'排课记录列表 '.repeat(12)}
          </div>
          <div style={{ flex: 1, height: 72, overflowY: 'scroll', background: dark ? '#374151' : '#f9fafb', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: dark ? '#9ca3af' : '#6b7280', border: `1px solid ${dark ? '#4b5563' : '#e5e7eb'}` }}
            className="thin-scrollbar">
            <div style={{ fontSize: 10, color: dark ? '#6b7280' : '#9ca3af', marginBottom: 4 }}>新方案（细滚动条）</div>
            {'排课记录列表 '.repeat(12)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal demo ──────────────────────────────────────────────────────────────
function ModalDemo({ dark }) {
  const [show, setShow] = useState(false);
  const bg = dark ? '#1f2937' : '#ffffff';
  const border = dark ? '#374151' : '#e5e7eb';
  const textColor = dark ? '#f9fafb' : '#111827';
  const mutedColor = dark ? '#9ca3af' : '#6b7280';
  const inputBg = dark ? '#374151' : '#f9fafb';
  return (
    <div>
      <button
        onClick={() => setShow(true)}
        style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
        打开排课弹窗
      </button>
      {show && (
        <div
          onClick={() => setShow(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(2px)' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: bg, borderRadius: 16, padding: 24, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: `1px solid ${border}`, color: textColor, animation: 'modalIn 0.18s cubic-bezier(0.34,1.56,0.64,1)' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>新建排课</h3>
                <p style={{ fontSize: 12, color: mutedColor, margin: '2px 0 0' }}>2026-05-06 · 周三</p>
              </div>
              <button onClick={() => setShow(false)} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: dark ? '#374151' : '#f3f4f6', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: mutedColor, fontSize: 16 }}>×</button>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: mutedColor, display: 'block', marginBottom: 4 }}>选择班级</label>
                <select style={{ width: '100%', padding: '9px 10px', background: inputBg, border: `1.5px solid ${dark ? '#4b5563' : '#d1d5db'}`, borderRadius: 8, color: textColor, fontSize: 13, outline: 'none' }}>
                  <option>高三甲 · 数学</option>
                  <option>物理强化 · 物理</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: mutedColor, display: 'block', marginBottom: 4 }}>开始时间</label>
                  <input type="time" defaultValue="09:00" style={{ width: '100%', padding: '9px 10px', background: inputBg, border: `1.5px solid ${dark ? '#4b5563' : '#d1d5db'}`, borderRadius: 8, color: textColor, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: mutedColor, display: 'block', marginBottom: 4 }}>结束时间</label>
                  <input type="time" defaultValue="11:00" style={{ width: '100%', padding: '9px 10px', background: inputBg, border: `1.5px solid ${dark ? '#4b5563' : '#d1d5db'}`, borderRadius: 8, color: textColor, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: mutedColor, display: 'block', marginBottom: 4 }}>上课地点</label>
                <input placeholder="留空则使用班级默认地点" style={{ width: '100%', padding: '9px 10px', background: inputBg, border: `1.5px solid #3b82f6`, borderRadius: 8, color: textColor, fontSize: 13, outline: 'none', boxShadow: '0 0 0 3px rgba(59,130,246,0.15)', boxSizing: 'border-box' }} />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button style={{ flex: 1, padding: '10px 0', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>保存</button>
              <button onClick={() => setShow(false)} style={{ padding: '10px 16px', background: dark ? '#374151' : '#f3f4f6', color: mutedColor, border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty state demo ────────────────────────────────────────────────────────
function EmptyState({ dark }) {
  const textColor = dark ? '#f9fafb' : '#111827';
  const mutedColor = dark ? '#6b7280' : '#9ca3af';
  return (
    <div style={{ textAlign: 'center', padding: '32px 24px', color: textColor }}>
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ margin: '0 auto 12px', display: 'block', opacity: 0.35 }}>
        <rect x="8" y="12" width="40" height="36" rx="4" stroke={dark ? '#9ca3af' : '#6b7280'} strokeWidth="2" fill="none" />
        <path d="M8 20h40" stroke={dark ? '#9ca3af' : '#6b7280'} strokeWidth="2" />
        <path d="M18 8v8M38 8v8" stroke={dark ? '#9ca3af' : '#6b7280'} strokeWidth="2" strokeLinecap="round" />
        <path d="M18 30h8M18 38h12" stroke={dark ? '#9ca3af' : '#6b7280'} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>本周暂无排课</p>
      <p style={{ fontSize: 13, color: mutedColor, marginBottom: 16 }}>点击时间格可快速新建排课</p>
      <button style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>新建排课</button>
    </div>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────
function Section({ title, subtitle, children, dark }) {
  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: dark ? '#f9fafb' : '#111827', margin: '0 0 4px' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: dark ? '#6b7280' : '#9ca3af', margin: 0 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Main preview ────────────────────────────────────────────────────────────
export default function DesignPreview() {
  const [dark, setDark] = useState(false);
  const [gridDark, setGridDark] = useState(false);

  const bg = dark ? '#111827' : '#f8fafc';
  const cardBg = dark ? '#1f2937' : '#ffffff';
  const border = dark ? '#374151' : '#e5e7eb';
  const textColor = dark ? '#f9fafb' : '#111827';
  const mutedColor = dark ? '#6b7280' : '#9ca3af';

  return (
    <>
      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.92) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .thin-scrollbar::-webkit-scrollbar { width: 4px; }
        .thin-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .thin-scrollbar::-webkit-scrollbar-thumb { background: ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}; border-radius: 4px; }
        .thin-scrollbar::-webkit-scrollbar-thumb:hover { background: ${dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}; }
      `}</style>

      <div style={{ minHeight: '100vh', background: bg, color: textColor, fontFamily: 'system-ui, -apple-system, sans-serif', transition: 'background 0.2s' }}>
        {/* Top bar */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: dark ? '#1f2937' : '#ffffff', borderBottom: `1px solid ${border}`, padding: '12px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backdropFilter: 'blur(8px)' }}>
          <div>
            <span style={{ fontWeight: 800, fontSize: 16, color: textColor }}>设计预览</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: mutedColor }}>课表管理系统 UI 改进方案</span>
          </div>
          <button onClick={() => setDark(!dark)} style={{ padding: '6px 14px', background: dark ? '#374151' : '#f3f4f6', color: textColor, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {dark ? '☀ 切换日间' : '☽ 切换夜间'}
          </button>
        </div>

        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 40px 80px' }}>

          {/* ── 1. 课程块 ───────────────────────────────────────────── */}
          <Section title="1. 课程块样式" subtitle="最核心的视觉元素 — 左侧竖条 + 浅色背景，区分学科与年级更直观" dark={dark}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              {/* Old blocks */}
              <div>
                <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />现在
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {MOCK_CLASSES.slice(0, 5).map(cls => (
                    <div key={cls.name} style={{ ...oldColor(cls), borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                      <div style={{ fontWeight: 700 }}>{cls.isCompetition ? '★ ' : ''}{cls.name}</div>
                      <div style={{ opacity: 0.75, fontSize: 11 }}>{cls.grade} · {cls.subject} · {cls.time[0]}–{cls.time[1]}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* New blocks */}
              <div>
                <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />新方案
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {MOCK_CLASSES.slice(0, 5).map(cls => {
                    const s = dark ? newColorDark(cls) : newColorLight(cls);
                    return (
                      <div key={cls.name} style={{ ...s, borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer', transition: 'box-shadow 0.15s' }}>
                        <div style={{ fontWeight: 700 }}>
                          {cls.isCompetition && <span style={{ color: '#f59e0b', marginRight: 2 }}>★</span>}{cls.name}
                        </div>
                        <div style={{ opacity: 0.6, fontSize: 11 }}>{cls.grade} · {cls.subject} · {cls.time[0]}–{cls.time[1]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Mini grid comparison */}
            <div style={{ background: cardBg, borderRadius: 12, padding: 20, border: `1px solid ${border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>周课表实景对比</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: mutedColor }}>网格主题</span>
                  <button onClick={() => setGridDark(!gridDark)} style={{ padding: '4px 10px', background: gridDark ? '#374151' : '#f3f4f6', color: gridDark ? '#e5e7eb' : '#374151', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                    {gridDark ? '夜间' : '日间'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: mutedColor, marginBottom: 6, textAlign: 'center' }}>现在 · 纯色填充</div>
                  <MiniGrid colorFn={oldColor} dark={gridDark} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: mutedColor, marginBottom: 6, textAlign: 'center' }}>新方案 · 竖条 + 浅色背景</div>
                  <MiniGrid colorFn={gridDark ? newColorDark : newColorLight} dark={gridDark} />
                </div>
              </div>
            </div>
          </Section>

          {/* ── 2. 侧边栏 ───────────────────────────────────────────── */}
          <Section title="2. 侧边栏激活态" subtitle="蓝色左竖线明确标记当前位置，替代不明显的灰色背景" dark={dark}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8, textAlign: 'center' }}>现在</div>
                <SidebarDemo newStyle={false} dark={dark} label="" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8, textAlign: 'center' }}>新方案</div>
                <SidebarDemo newStyle={true} dark={dark} label="" />
              </div>
              <div style={{ flex: 1, padding: 16, background: cardBg, borderRadius: 12, border: `1px solid ${border}`, fontSize: 13, color: dark ? '#d1d5db' : '#374151', alignSelf: 'center' }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>改动说明</p>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2, color: mutedColor }}>
                  <li>激活项左侧加 <strong style={{ color: '#3b82f6' }}>3px 蓝色竖线</strong></li>
                  <li>激活项文字变蓝，增强辨识度</li>
                  <li>背景色从纯灰改为蓝色调淡底</li>
                  <li>代码改动：仅调整一个 className</li>
                </ul>
              </div>
            </div>
          </Section>

          {/* ── 3. 统计卡片 ──────────────────────────────────────────── */}
          <Section title="3. 统计卡片" subtitle="顶部彩色横条 + 图标，区分三个指标，提升层次感" dark={dark}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8 }}>现在</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <OldStatCard label="排课次数" value="28" unit="次" dark={dark} />
                <OldStatCard label="教学时长" value="56.0" unit="小时" dark={dark} />
                <OldStatCard label="预估收入" value="¥25,200" dark={dark} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8 }}>新方案</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <NewStatCard label="排课次数" value="28" unit="次" accent="#3b82f6" icon="📅" dark={dark} />
                <NewStatCard label="教学时长" value="56.0" unit="小时" accent="#8b5cf6" icon="⏱" dark={dark} />
                <NewStatCard label="预估收入" value="¥25,200" accent="#22c55e" icon="💰" dark={dark} />
              </div>
            </div>
          </Section>

          {/* ── 4. 表单 & 按钮 ──────────────────────────────────────── */}
          <Section title="4. 表单元素 & 按钮" subtitle="聚焦光晕、Ghost 删除按钮、细滚动条" dark={dark}>
            <div style={{ background: cardBg, borderRadius: 12, padding: 20, border: `1px solid ${border}` }}>
              <ButtonsDemo dark={dark} />
            </div>
          </Section>

          {/* ── 5. 弹窗 ─────────────────────────────────────────────── */}
          <Section title="5. 排课弹窗" subtitle="淡入 + 弹簧动画入场，磨砂玻璃遮罩，更大圆角" dark={dark}>
            <div style={{ background: cardBg, borderRadius: 12, padding: 20, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 20 }}>
              <ModalDemo dark={dark} />
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 2.2, color: mutedColor }}>
                <li>遮罩层加 <code style={{ fontSize: 11, background: dark ? '#374151' : '#f3f4f6', padding: '1px 4px', borderRadius: 4 }}>backdrop-filter: blur(2px)</code></li>
                <li>弹窗圆角 12px → 16px</li>
                <li>入场动画：scale(0.92)+translateY(12px) → scale(1)</li>
                <li>关闭按钮改为右上角 ×，不占底部空间</li>
                <li>日期显示在标题下方，减少视觉重复</li>
              </ul>
            </div>
          </Section>

          {/* ── 6. 空状态 ─────────────────────────────────────────────── */}
          <Section title="6. 空状态占位" subtitle="引导用户行动，减少空白页面的困惑感" dark={dark}>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1, background: cardBg, borderRadius: 12, border: `1px solid ${border}` }}>
                <div style={{ fontSize: 12, color: mutedColor, padding: '12px 16px 0', textAlign: 'center' }}>现在</div>
                <div style={{ textAlign: 'center', padding: 32, color: mutedColor, fontSize: 14 }}>该时段无排课记录</div>
              </div>
              <div style={{ flex: 1, background: cardBg, borderRadius: 12, border: `1px solid ${border}` }}>
                <div style={{ fontSize: 12, color: mutedColor, padding: '12px 16px 0', textAlign: 'center' }}>新方案</div>
                <EmptyState dark={dark} />
              </div>
            </div>
          </Section>

        </div>
      </div>
    </>
  );
}
