export function renderArchitecture(host) {
  host.innerHTML = `
    <section class="bk-card">
      <h2 style="margin-top:0">Architecture</h2>
      <p class="small">AI Trainer Level 3 Lab runs as a local FastAPI app with SQLite persistence and static Vue pages.</p>
      <ul class="small" style="line-height:1.8">
        <li>Backend: FastAPI routers under <code>app/</code></li>
        <li>Frontend: static Vue modules under <code>static/assets/</code></li>
        <li>Data: JSON question metadata and per-operation files under <code>data/</code></li>
        <li>Execution: Jupyter kernels are started per operation session</li>
        <li>Persistence: SQLite database generated at runtime</li>
      </ul>
    </section>
  `;
}
