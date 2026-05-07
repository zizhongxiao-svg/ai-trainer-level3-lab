// 90 天 GitHub 风活跃热图。data: [{date:'YYYY-MM-DD', count:N}] (按时间升序)
// 输出一个 <div> 节点；不依赖 Vue。
export function renderHeatmap(data) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-heatmap';

  if (!data || !data.length) {
    wrap.innerHTML = '<p class="small" style="color:var(--ink-3)">暂无活跃数据</p>';
    return wrap;
  }

  const max = Math.max(1, ...data.map(d => d.count));
  const tier = (c) => {
    if (c <= 0) return 0;
    const p = c / max;
    if (p < 0.25) return 1;
    if (p < 0.5) return 2;
    if (p < 0.75) return 3;
    return 4;
  };
  const colors = ['var(--kbd)', '#dbeec0', '#a3d977', '#5cb85c', '#2b8a3e'];

  // Pad first column so each column starts on Sunday
  const firstDate = new Date(data[0].date + 'T00:00:00');
  const padDays = firstDate.getDay(); // 0..6 (0=Sun)
  const cells = [];
  for (let i = 0; i < padDays; i++) cells.push(null);
  for (const d of data) cells.push(d);

  // Build columns of 7 rows
  const cols = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));

  const sz = 12, gap = 3;
  const w = cols.length * (sz + gap);
  const h = 7 * (sz + gap);

  let svg = `<svg width="${w}" height="${h}" style="display:block">`;
  cols.forEach((col, ci) => {
    col.forEach((cell, ri) => {
      if (!cell) return;
      const x = ci * (sz + gap);
      const y = ri * (sz + gap);
      const t = tier(cell.count);
      svg += `<rect x="${x}" y="${y}" width="${sz}" height="${sz}" rx="2" ry="2"
              fill="${colors[t]}" data-date="${cell.date}" data-count="${cell.count}"></rect>`;
    });
  });
  svg += '</svg>';

  const total = data.reduce((s, d) => s + d.count, 0);
  const activeDays = data.filter(d => d.count > 0).length;

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
      <div class="small" style="color:var(--ink-2)">最近 ${data.length} 天 · 共 ${total} 次答题 · ${activeDays} 天活跃</div>
      <div class="small" style="display:flex;align-items:center;gap:4px">
        <span style="color:var(--ink-3)">少</span>
        ${colors.map(c => `<span style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px"></span>`).join('')}
        <span style="color:var(--ink-3)">多</span>
      </div>
    </div>
    <div style="overflow-x:auto" data-svg-host>${svg}</div>
    <div data-tip class="small"
         style="height:18px;margin-top:6px;color:var(--ink-2)"></div>
  `;

  const tip = wrap.querySelector('[data-tip]');
  wrap.querySelectorAll('rect[data-date]').forEach(rect => {
    rect.style.cursor = 'pointer';
    rect.addEventListener('mouseenter', () => {
      tip.textContent = `${rect.dataset.date} · ${rect.dataset.count} 次`;
    });
    rect.addEventListener('mouseleave', () => { tip.textContent = ''; });
  });

  return wrap;
}
