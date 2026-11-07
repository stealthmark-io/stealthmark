import { ImageResponse } from 'next/og';

export const alt = 'StealthMark: see which AI agents read your site, and decide what they can do';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px',
          background: '#060709',
          color: '#f8fafc',
        }}
      >
        <div style={{ fontSize: 34, color: '#22d3ee', letterSpacing: 4 }}>STEALTHMARK</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.1, marginTop: 28 }}>
          See which AI agents read your site, and decide what they can do.
        </div>
        <div style={{ fontSize: 32, color: '#94a3b8', marginTop: 36 }}>
          Open-source middleware for Next.js, Express and Fastify. Free for 250 agent events a month.
        </div>
      </div>
    ),
    { ...size },
  );
}
