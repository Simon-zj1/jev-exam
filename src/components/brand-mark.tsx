/**
 * 图标（与 docs/brand/icon.svg 同一套几何）：
 * 左边三条长短不一的横线＝材料里的要点，长度不一表示内容本身并不均等；
 * 右边三个圆＝一次判定的三种结果：命中（实心）、未命中（空心）、待复核（半实心）。
 * 用内联 SVG 而不是 <img>：顶栏里要跟着文字大小缩放与换色。
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className="brand-mark"
    >
      <defs>
        <linearGradient id="brand-mark-ground" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4B5BFF" />
          <stop offset="100%" stopColor="#17C2A4" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="248" fill="url(#brand-mark-ground)" />
      <g fill="#FFFFFF">
        <rect x="232" y="336" width="312" height="64" rx="32" />
        <rect x="232" y="480" width="248" height="64" rx="32" opacity="0.85" />
        <rect x="232" y="624" width="196" height="64" rx="32" opacity="0.85" />
      </g>
      <g>
        <circle cx="800" cy="368" r="64" fill="#FFFFFF" />
        <circle cx="800" cy="512" r="64" fill="none" stroke="#FFFFFF" strokeWidth="22" />
        <circle cx="800" cy="656" r="64" fill="none" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="20" />
        <path d="M800 592 A64 64 0 0 1 800 720 Z" fill="#FFFFFF" />
      </g>
    </svg>
  );
}
