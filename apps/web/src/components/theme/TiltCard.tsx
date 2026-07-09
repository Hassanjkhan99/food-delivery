"use client";

// Pointer-tracked 3D tilt (the `tilt3d` card style). Falls back to flat under
// prefers-reduced-motion or when disabled.
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import type { ReactNode } from "react";

export function TiltCard({
  children,
  className,
  enabled = true,
  onClick,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const active = enabled && !reduced && !disabled;

  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(my, [0, 1], [7, -7]), { stiffness: 250, damping: 25 });
  const rotateY = useSpring(useTransform(mx, [0, 1], [-7, 7]), { stiffness: 250, damping: 25 });

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={
        active
          ? { rotateX, rotateY, transformStyle: "preserve-3d", perspective: 800 }
          : undefined
      }
      onPointerMove={(e) => {
        if (!active) return;
        const rect = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - rect.left) / rect.width);
        my.set((e.clientY - rect.top) / rect.height);
      }}
      onPointerLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
      whileHover={active ? { scale: 1.02, boxShadow: "0 16px 32px rgba(0,0,0,0.18)" } : undefined}
      whileTap={active ? { scale: 0.98 } : undefined}
    >
      {children}
    </motion.button>
  );
}
