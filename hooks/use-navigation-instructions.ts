import { useEffect, useRef, useState } from "react";
import { speak } from "@/lib/speech";

// steps: assumed to be Mapbox step objects with maneuver and geometry
export function useNavigationInstructions(steps: any[] | undefined, currentPosition: { lat: number; lng: number } | null, speakEnabled = true) {
  const [nextInstruction, setNextInstruction] = useState<string | null>(null);
  const currentStepIdx = useRef(0);

  // compute distance to a point (approx meters) using haversine
  const distanceMeters = (p1: { lat: number; lng: number }, p2: { lat: number; lng: number }) => {
    const R = 6371000; // m
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lng - p1.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  useEffect(() => {
    if (!steps || steps.length === 0) {
      setNextInstruction(null);
      currentStepIdx.current = 0;
      return;
    }

    if (!currentPosition) {
      const first = steps[0];
      setNextInstruction(first?.maneuver?.instruction ?? null);
      return;
    }

    // find the first step whose end is ahead of current position
    let idx = currentStepIdx.current;
    if (idx >= steps.length) idx = 0;

    // Search from current index; if the current step is behind, advance
    for (let i = idx; i < steps.length; i++) {
      const s = steps[i];
      const coords = Array.isArray(s.geometry) ? s.geometry as any[] : [];
      // pick the last point of the step as the maneuver point
      const end = coords && coords.length ? (Array.isArray(coords[0]) ? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] } : coords[coords.length - 1]) : null;
      if (!end) continue;
      const d = distanceMeters(currentPosition, end);
      // if the maneuver point is more than 30m ahead, pick this as next
      if (d > 30) {
        idx = i;
        break;
      }
      // otherwise, loop to next step
    }

    currentStepIdx.current = idx;
    const next = steps[idx];
    const instruction = next?.maneuver?.instruction ?? (next?.name ? `Continue on ${next.name}` : null);
    setNextInstruction(instruction);

    let spoken = false;
    const announce = async () => {
      if (!instruction) return;
      // simple speak-once per step
      if (speakEnabled) {
        try {
          spoken = await speak(instruction);
        } catch (err) {
          console.warn("[nav] speak failed", err);
        }
      }
    };
    announce();
    // Re-run when steps or currentPosition change
  }, [steps, currentPosition, speakEnabled]);

  return {
    nextInstruction,
  };
}
