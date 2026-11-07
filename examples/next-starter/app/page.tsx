export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '2rem', letterSpacing: '-0.03em' }}>StealthMark Next.js Starter</h1>
      <p style={{ color: '#94a3b8' }}>
        You are seeing this page because your browser sent an <code>Accept: text/html</code> request.
      </p>
      <div style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>Test as an AI Agent:</h3>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>
          Open your terminal and run:
        </p>
        <pre style={{ background: '#000', padding: '0.75rem', borderRadius: 8, overflowX: 'auto', fontSize: '0.85rem', color: '#38bdf8' }}>
          curl -H "Accept: application/agent+json" http://localhost:3000
        </pre>
        <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.85rem', color: '#10b981' }}>
          ✨ You will receive the structured <code>agent.json</code> capability manifest instantly with zero HTML overhead!
        </p>
      </div>
    </main>
  );
}
