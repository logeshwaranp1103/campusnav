"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  RotateCcw,
  Footprints,
  Navigation,
  X,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { DirectionStep } from "@/lib/routing/directions";

interface TurnByTurnBarProps {
  currentStep: DirectionStep | null;
  nextStep: DirectionStep | null;
  totalDistanceMeters: number;
  remainingDistanceMeters: number;
  currentStepIndex: number;
  totalStepsCount: number;
  onEndNavigation: () => void;
  onRecalculate?: () => void;
  isOffRoute?: boolean;
}

export function TurnByTurnBar({
  currentStep,
  nextStep,
  totalDistanceMeters,
  remainingDistanceMeters,
  currentStepIndex,
  totalStepsCount,
  onEndNavigation,
  onRecalculate,
  isOffRoute,
}: TurnByTurnBarProps) {
  if (!currentStep) return null;

  const progressPct = Math.min(
    100,
    Math.max(0, Math.round(((totalDistanceMeters - remainingDistanceMeters) / (totalDistanceMeters || 1)) * 100))
  );

  const etaMinutes = Math.max(1, Math.round(remainingDistanceMeters / 70));

  const renderIcon = (icon: DirectionStep["icon"]) => {
    switch (icon) {
      case "straight":
        return <ArrowUp className="h-6 w-6 text-emerald-400" />;
      case "slight-left":
        return <ArrowUpLeft className="h-6 w-6 text-emerald-400" />;
      case "left":
        return <ArrowLeft className="h-6 w-6 text-emerald-400" />;
      case "sharp-left":
        return <ArrowDownLeft className="h-6 w-6 text-emerald-400" />;
      case "slight-right":
        return <ArrowUpRight className="h-6 w-6 text-emerald-400" />;
      case "right":
        return <ArrowRight className="h-6 w-6 text-emerald-400" />;
      case "sharp-right":
        return <ArrowDownRight className="h-6 w-6 text-emerald-400" />;
      case "u-turn":
        return <RotateCcw className="h-6 w-6 text-amber-400" />;
      case "stairs-up":
      case "stairs-down":
        return <Footprints className="h-6 w-6 text-indigo-400" />;
      case "lift":
        return <Navigation className="h-6 w-6 text-blue-400" />;
      case "arrive":
        return <CheckCircle2 className="h-6 w-6 text-emerald-400" />;
      default:
        return <ArrowUp className="h-6 w-6 text-emerald-400" />;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-lg rounded-2xl border bg-gray-900/95 p-4 shadow-2xl backdrop-blur-md text-white border-gray-800 space-y-3"
      >
        {/* Off-Route Alert */}
        {isOffRoute && (
          <div className="flex items-center justify-between rounded-lg bg-amber-500/20 border border-amber-500/40 p-2 text-xs text-amber-300">
            <span className="font-semibold">⚠️ Off route detected! Recalculating path...</span>
            {onRecalculate && (
              <Button size="sm" onClick={onRecalculate} className="h-6 text-[10px] bg-amber-600 hover:bg-amber-700 text-white">
                Recalculate
              </Button>
            )}
          </div>
        )}

        {/* Primary Instruction Row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30">
              {renderIcon(currentStep.icon)}
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight text-white">{currentStep.text}</h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 font-medium">
                <span>{currentStep.distanceMeters} meters ahead</span>
                <span>•</span>
                <span>Step {currentStepIndex + 1} of {totalStepsCount}</span>
              </div>
            </div>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={onEndNavigation}
            className="h-8 w-8 p-0 rounded-full text-gray-400 hover:bg-gray-800 hover:text-white shrink-0"
            title="End Navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Next Step Preview Banner */}
        {nextStep && (
          <div className="flex items-center gap-2 border-t border-gray-800/80 pt-2 text-xs text-gray-300">
            <span className="font-semibold text-gray-400 uppercase tracking-wider text-[10px]">Next:</span>
            <span className="truncate">{nextStep.text}</span>
            <ChevronRight className="h-3.5 w-3.5 text-gray-500 shrink-0 ml-auto" />
          </div>
        )}

        {/* Route Progress Bar & Remaining Stats */}
        <div className="space-y-1.5 border-t border-gray-800/80 pt-2 text-xs">
          <div className="flex items-center justify-between text-gray-300 font-medium">
            <span className="text-emerald-400 font-bold">{remainingDistanceMeters}m remaining</span>
            <span>~{etaMinutes} min walk</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
