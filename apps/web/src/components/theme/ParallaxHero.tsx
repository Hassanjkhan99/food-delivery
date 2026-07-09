"use client";

// Scroll-linked parallax hero: the brand layer floats above the backdrop at a
// different scroll speed ('parallax'), or gets a static depth gradient ('depth').
import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

export function ParallaxHero({
  effect,
  heroUrl,
  primaryColor,
  children,
}: {
  effect: "none" | "parallax" | "depth";
  heroUrl?: string | null;
  primaryColor: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, effect === "parallax" && !reduced ? 120 : 0]);
  const fgY = useTransform(scrollY, [0, 400], [0, effect === "parallax" && !reduced ? -40 : 0]);
  const scale = useTransform(scrollY, [0, 400], [1, effect !== "none" && !reduced ? 1.12 : 1]);

  return (
    <div ref={ref} className="relative mb-8 h-56 overflow-hidden rounded-3xl sm:h-72">
      <motion.div
        className="absolute inset-0"
        style={{
          y: bgY,
          scale,
          background: heroUrl
            ? `url(${heroUrl}) center/cover no-repeat`
            : `linear-gradient(135deg, ${primaryColor}, ${primaryColor}66 60%, transparent)`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            effect === "depth"
              ? `radial-gradient(120% 90% at 20% 10%, transparent 30%, var(--brand-bg) 95%)`
              : `linear-gradient(to top, var(--brand-bg) 0%, transparent 55%)`,
        }}
      />
      <motion.div style={{ y: fgY }} className="relative flex h-full items-end p-6">
        {children}
      </motion.div>
    </div>
  );
}
