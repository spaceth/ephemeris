import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

const MOTION = { duration: 320, easing: "cubic-bezier(0.2, 0, 0, 1)" };

/** Animate a box between the sizes of its open and closed layouts. */
export function useBoxMotion(open: boolean, ref: RefObject<HTMLElement | null>) {
  const seen = useRef<{ h: number; w: number } | null>(null);
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || seen.current == null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = running.current
      ? { h: node.getBoundingClientRect().height, w: node.getBoundingClientRect().width }
      : seen.current;
    running.current?.cancel();
    const next = node.getBoundingClientRect();
    const to = { h: next.height, w: next.width };
    seen.current = to;
    if (Math.abs(from.h - to.h) < 1 && Math.abs(from.w - to.w) < 1) return;
    node.style.overflow = "hidden";
    const animation = node.animate(
      [
        { height: `${from.h}px`, width: `${from.w}px` },
        { height: `${to.h}px`, width: `${to.w}px` },
      ],
      MOTION,
    );
    running.current = animation;
    const finish = () => {
      if (running.current !== animation) return;
      running.current = null;
      node.style.overflow = "";
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }, [open, ref]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || running.current) return;
    const rect = node.getBoundingClientRect();
    seen.current = { h: rect.height, w: rect.width };
  });
}
