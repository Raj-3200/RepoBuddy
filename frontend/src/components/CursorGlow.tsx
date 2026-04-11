import { useEffect, useRef } from "react";

/**
 * Soft radial glow that follows the cursor across the page.
 * Renders a canvas overlay with pointer-events: none.
 * Uses requestAnimationFrame for 60 fps smoothness with lerp trailing.
 */
export function CursorGlow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let mouseX = -200;
    let mouseY = -200;
    let currentX = -200;
    let currentY = -200;
    let frame = 0;
    let visible = false;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onMouseMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!visible) visible = true;
    }

    function onMouseLeave() {
      visible = false;
    }

    function draw() {
      frame = requestAnimationFrame(draw);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      if (!visible) return;

      // Smooth trailing — lerp toward target
      const lerp = 0.09;
      currentX += (mouseX - currentX) * lerp;
      currentY += (mouseY - currentY) * lerp;

      // Draw radial gradient glow
      const r = 320;
      const gradient = ctx!.createRadialGradient(
        currentX,
        currentY,
        0,
        currentX,
        currentY,
        r,
      );
      gradient.addColorStop(0, "rgba(45, 212, 191, 0.035)");
      gradient.addColorStop(0.45, "rgba(45, 212, 191, 0.012)");
      gradient.addColorStop(1, "rgba(45, 212, 191, 0)");

      ctx!.fillStyle = gradient;
      ctx!.fillRect(currentX - r, currentY - r, r * 2, r * 2);
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-40"
      aria-hidden="true"
    />
  );
}
